import type { RoomCoordinator } from "../../types";
import { canonicalMediaPolicy, isAudioOnly, type MediaPolicy } from "../../shared/mediaPolicy";
import { SFUConnectionState, type Streams } from "../types/SFU";
import { VoiceMoveError, type PrepareVoiceMove, type VoiceMoveAuthority } from "../types/VoiceMove";
import { setupPeerConnection } from "./sfuConnectFlow";
import { connectToSfuWebSocket } from "./sfuConnection";
import type { SFUConnectionStateInternal } from "./sfuTypes";
import { snapshotMicrophoneCodec } from "./microphoneCodec";
import { idleMicrophoneCodecState, type MicrophoneCodecProfile, type MicrophoneCodecState } from "../types/MicrophoneCodec";

export interface MoveSource {
  pc: RTCPeerConnection;
  ws: WebSocket;
  channelId: string;
  serverId: string;
  room: RoomCoordinator;
  publicationStream: MediaStream;
  policy: MediaPolicy;
  stunHosts: string[];
  microphoneCodec?: MicrophoneCodecProfile;
}

export interface StagedConnection {
  pc: RTCPeerConnection;
  ws: WebSocket | null;
  sender: RTCRtpSender;
  stream: MediaStream;
  clone: MediaStreamTrack;
  streams: Streams;
  callAloneTimeoutSeconds: number | null;
  microphoneCodecState: MicrophoneCodecState;
}

interface MoveRecord extends StagedConnection {
  request: PrepareVoiceMove;
  fingerprint: string;
  source: MoveSource;
  sourceTrack: MediaStreamTrack;
  authority: VoiceMoveAuthority;
  generation: string;
  policyKey: string;
  preparePromise: Promise<{ requestId: string; streamId: string }>;
  commitPromise?: Promise<void>;
  resumePromise?: Promise<void>;
  status: "preparing" | "ready" | "lost" | "aborted" | "committed";
  invalidated: boolean;
  authorityCommitted: boolean;
  transmissionReleased: boolean;
  timer?: ReturnType<typeof setTimeout>;
  unsubscribe?: () => void;
  disposeSocket?: () => void;
  rejectReady: (error: Error) => void;
}

interface MoveDeps {
  getSource(): MoveSource | null;
  getRoom(): RoomCoordinator | null;
  onPromote(connection: StagedConnection, request: PrepareVoiceMove, recoveryRequired: boolean): void;
  onActiveStreams(streams: Streams): void;
  onActiveState(update: SFUConnectionStateInternal | ((prev: SFUConnectionStateInternal) => SFUConnectionStateInternal)): void;
  onSourceFailure(): void;
  onActiveFailure(): void;
  onTransmissionReleased(stream: MediaStream): void;
  getPublicationBarrier(): { acknowledged: boolean; blocked: boolean; revision: number } | undefined;
  onMicrophoneCodecState?(state: MicrophoneCodecState): void;
}

export function retireMoveTransport(pc: RTCPeerConnection, ws: WebSocket | null): void {
  pc.onicecandidate = pc.oniceconnectionstatechange = pc.onicegatheringstatechange = null;
  pc.onsignalingstatechange = pc.ontrack = pc.onconnectionstatechange = pc.ondatachannel = null;
  pc.onnegotiationneeded = null;
  if (ws) {
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1000, "Voice transfer");
  }
  if (pc.connectionState !== "closed") pc.close();
}

/** One independent pending transport. No capture, active-ref mutation or room announcements. */
export class StagedMoveController {
  private pending: MoveRecord | null = null;
  private promoted: MoveRecord | null = null;
  private records = new Map<string, MoveRecord>();
  private disposed = false;
  private sourceReconciliation = false;
  private reconciliationRequired = false;
  transmissionBlocked = false;
  constructor(private readonly deps: MoveDeps) {}

  get hasPending(): boolean { return this.pending !== null; }
  get blocksRecovery(): boolean { return this.hasPending || this.transmissionBlocked || this.reconciliationRequired; }
  private error(code: string): VoiceMoveError { return new VoiceMoveError(code); }
  private authenticate(record: MoveRecord): void {
    const room = this.deps.getRoom();
    if (this.disposed || record.invalidated || !record.authority.stagingSupported || !record.generation ||
        record.authority.generation !== record.generation || room?.moveAuthority !== record.authority ||
        !room.connected) throw this.error("stale_authority");
  }
  private sourceCurrent(record: MoveRecord): void {
    this.authenticate(record);
    const current = this.deps.getSource();
    if (!current || current.pc !== record.source.pc || current.channelId !== record.request.sourceChannelId ||
        current.serverId !== record.source.serverId || current.publicationStream.getAudioTracks()[0] !== record.sourceTrack ||
        JSON.stringify(canonicalMediaPolicy(current.policy)) !== record.policyKey ||
        JSON.stringify(snapshotMicrophoneCodec(current.microphoneCodec)) !== JSON.stringify(record.source.microphoneCodec)) throw this.error("source_or_policy_changed");
  }
  private closePending(record: MoveRecord, code: string, invalidated = false): void {
    if (record.status === "committed") return;
    if (invalidated) record.invalidated = true;
    if (record.timer) clearTimeout(record.timer);
    record.unsubscribe?.(); record.unsubscribe = undefined;
    record.disposeSocket?.(); record.disposeSocket = undefined;
    retireMoveTransport(record.pc, record.ws);
    record.clone.stop();
    record.status = invalidated ? "aborted" : "lost";
    record.rejectReady(this.error(code));
    if (this.pending === record) this.pending = null;
  }
  private destinationFailed(record: MoveRecord): void {
    if (record.status === "committed") {
      if (this.promoted !== record) return;
      this.transmissionBlocked = true; this.deps.onActiveFailure();
    }
    else this.closePending(record, "destination_disconnected");
  }

  prepare(request: PrepareVoiceMove): Promise<{ requestId: string; streamId: string }> {
    if (this.disposed) return Promise.reject(this.error("disposed"));
    const fingerprint = JSON.stringify(request);
    const existing = this.records.get(request.requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return Promise.reject(this.error("request_conflict"));
      try { this.authenticate(existing); } catch (error) { return Promise.reject(error); }
      return existing.preparePromise;
    }
    const liveSource = this.deps.getSource();
    const source = liveSource ? { ...liveSource } : null, authority = source?.room.moveAuthority;
    if (!source || !authority?.stagingSupported || !authority.generation || typeof authority.onInvalidated !== "function" ||
        typeof authority.confirmCommit !== "function" || typeof authority.isDestinationPolicyApplied !== "function") {
      return Promise.reject(this.error("unsupported"));
    }
    if (!isAudioOnly(source.policy)) return Promise.reject(this.error("unsupported_media_mode"));
    try { source.microphoneCodec = snapshotMicrophoneCodec(source.microphoneCodec); }
    catch { return Promise.reject(this.error("invalid_microphone_codec")); }
    if (!source.room.connected || source.pc.connectionState !== "connected" || source.ws.readyState !== WebSocket.OPEN ||
        source.channelId !== request.sourceChannelId || request.destinationChannelId === request.sourceChannelId) {
      return Promise.reject(this.error("source_changed"));
    }
    const token = request.joinToken as { move_id?: unknown } | null;
    const settings = request.channelSettings;
    if (!request.requestId || token?.move_id !== request.requestId || !request.destinationChannelId ||
        !Array.isArray(request.sfuUrls) || !request.sfuUrls.length || request.sfuUrls.some(url => typeof url !== "string" || !url) ||
        !settings || typeof settings.eSportsMode !== "boolean" || typeof settings.requirePushToTalk !== "boolean" ||
        typeof settings.disableRnnoise !== "boolean" || (settings.maxBitrate !== null && (!Number.isFinite(settings.maxBitrate) || settings.maxBitrate <= 0)) ||
        !Number.isFinite(request.expiresAt) || request.expiresAt <= Date.now() || request.expiresAt > Date.now() + 60_000) {
      return Promise.reject(this.error("invalid_prepare"));
    }
    const sourceTrack = source.publicationStream.getAudioTracks()[0];
    const boundary = this.deps.getPublicationBarrier();
    if (!sourceTrack || sourceTrack.readyState !== "live" || sourceTrack.enabled !== true || typeof sourceTrack.clone !== "function" ||
        !source.pc.getSenders().some(sender => sender.track === sourceTrack) ||
        !boundary?.acknowledged || typeof boundary.blocked !== "boolean" || !Number.isFinite(boundary.revision)) {
      return Promise.reject(this.error("unsupported_publication_boundary"));
    }
    if (this.pending) this.closePending(this.pending, "superseded", true);
    let clone: MediaStreamTrack | undefined;
    let stream: MediaStream;
    try {
      clone = sourceTrack.clone(); clone.enabled = false;
      stream = new MediaStream([clone]);
    } catch (error) { clone?.stop(); return Promise.reject(error); }
    let record: MoveRecord;
    let resolveReady!: () => void, rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    void ready.catch(() => undefined);
    const refs = { peerConnectionRef: { current: null as RTCPeerConnection | null }, sfuWebSocketRef: { current: null as WebSocket | null }, isDisconnectingRef: { current: false } };
    let stageState: SFUConnectionStateInternal = { state: SFUConnectionState.CONNECTING, roomId: request.destinationChannelId, serverId: source.serverId, error: null, callAloneTimeoutSeconds: null };
    const stagePolicy = (): MediaPolicy => ({
      ...(record?.status === "committed" ? this.deps.getSource()?.policy ?? source.policy : source.policy),
      mediaMode: "audio-only",
    });
    let pc: RTCPeerConnection;
    let sender: RTCRtpSender;
    try {
      pc = setupPeerConnection(source.stunHosts, {
        ...refs, connectionTimeoutRef: { current: null },
        getMediaPolicy: stagePolicy,
        setStreams: update => {
          if (!record || record.status === "lost" || record.status === "aborted") return;
          record.streams = typeof update === "function" ? update(record.streams) : update;
          if (record.status === "committed" && this.promoted === record) this.deps.onActiveStreams(record.streams);
        },
        setConnectionState: update => {
          stageState = typeof update === "function" ? update(stageState) : update;
          if (record?.status === "committed" && this.promoted === record) this.deps.onActiveState(update);
          else if (stageState.state === SFUConnectionState.CONNECTED) resolveReady();
        },
        performCleanup: async () => { if (record) this.destinationFailed(record); },
      }, request.channelSettings.eSportsMode);
      refs.peerConnectionRef.current = pc;
      sender = pc.addTrack(clone, stream);
    } catch (error) {
      clone.stop();
      if (refs.peerConnectionRef.current) retireMoveTransport(refs.peerConnectionRef.current, null);
      return Promise.reject(error);
    }
    record = { request: structuredClone(request), fingerprint, source, sourceTrack, authority, generation: authority.generation,
      policyKey: JSON.stringify(canonicalMediaPolicy(source.policy)), pc, ws: null, sender, clone, stream,
      streams: { [stream.id]: { stream, isLocal: true } }, callAloneTimeoutSeconds: null,
      microphoneCodecState: source.microphoneCodec ? { ...idleMicrophoneCodecState(), status: "applying", requested: source.microphoneCodec } : idleMicrophoneCodecState(),
      preparePromise: Promise.resolve({ requestId: request.requestId, streamId: stream.id }), status: "preparing", invalidated: false,
      authorityCommitted: false, transmissionReleased: false, rejectReady };
    this.pending = record; this.records.set(request.requestId, record);
    const unsubscribe = authority.onInvalidated(() => {
      if (record.status === "committed" && this.promoted !== record) return;
      record.invalidated = true;
      this.reconciliationRequired = true;
      if (record.status === "committed") {
        this.transmissionBlocked = true;
        retireMoveTransport(record.pc, record.ws);
        this.deps.onActiveFailure();
      } else this.closePending(record, "authority_invalidated", true);
    });
    if (record.invalidated) unsubscribe(); else record.unsubscribe = unsubscribe;
    record.timer = setTimeout(() => { void this.expire(record); }, request.expiresAt - Date.now());
    record.preparePromise = (async () => {
      try {
        this.sourceCurrent(record);
        if (this.pending !== record || record.invalidated) throw this.error("stale_prepare");
        const ws = await connectToSfuWebSocket(request.sfuUrls[0], request.joinToken, refs, request.channelSettings.eSportsMode, {
          microphoneCodec: source.microphoneCodec,
          channelMaxBitrateBps: request.channelSettings.maxBitrate,
          onMicrophoneCodecState: state => {
            if (record.invalidated || record.status === "lost" || record.status === "aborted") return;
            record.microphoneCodecState = state;
            if (this.promoted === record) this.deps.onMicrophoneCodecState?.(state);
          },
          getMediaPolicy: stagePolicy,
          getMicrophoneSenders: () => [sender],
          onDisposeAvailable: dispose => { record.disposeSocket = dispose; },
          onRoomJoined: info => { record.callAloneTimeoutSeconds = info.callAloneTimeoutSeconds; },
          onAbnormalClose: () => this.destinationFailed(record),
          interceptDisconnect: () => { this.destinationFailed(record); return true; },
        });
        record.ws = ws; refs.sfuWebSocketRef.current = ws;
        await ready;
        this.sourceCurrent(record);
        if (this.pending !== record || record.status !== "preparing" || Date.now() >= request.expiresAt || pc.connectionState !== "connected") throw this.error("stale_prepare");
        record.status = "ready";
        return { requestId: request.requestId, streamId: stream.id };
      } catch (error) { this.closePending(record, "prepare_failed"); throw error; }
    })();
    // Bound retained identity records without evicting the current or promoted operation.
    for (const [id, old] of this.records) if (this.records.size > 32 && old !== this.pending && old !== this.promoted) {
      old.unsubscribe?.(); old.disposeSocket?.(); old.clone.stop(); this.records.delete(id);
    }
    return record.preparePromise;
  }

  private async confirmation(record: MoveRecord) {
    this.authenticate(record);
    const result = await record.authority.confirmCommit(record.request.requestId);
    this.authenticate(record);
    if (result.requestId !== record.request.requestId || result.generation !== record.generation ||
        result.sourceChannelId !== record.request.sourceChannelId || result.destinationChannelId !== record.request.destinationChannelId) throw this.error("stale_confirmation");
    if (result.status === "committed") record.authorityCommitted = true;
    return result;
  }
  private async expire(record: MoveRecord): Promise<void> {
    if (record.status === "committed" || record.invalidated) return;
    try { if ((await this.confirmation(record)).status === "committed") return; } catch { /* The source is retained even when authority cannot answer. */ }
    this.closePending(record, "expired");
  }

  commit(requestId: string): Promise<void> {
    const record = this.records.get(requestId);
    if (!record) return Promise.reject(this.error("unknown_move"));
    if (record.status === "committed") {
      try { this.authenticate(record); return Promise.resolve(); } catch (error) { return Promise.reject(error); }
    }
    if (record.commitPromise) return record.commitPromise;
    record.commitPromise = (async () => {
      this.sourceCurrent(record);
      const confirmation = await this.confirmation(record);
      this.sourceCurrent(record);
      if (confirmation.status !== "committed") throw this.error(confirmation.status === "aborted" ? "authority_aborted" : "authority_pending");
      if (record.status !== "ready" && record.status !== "lost") throw this.error("not_ready");
      const recoveryRequired = record.pc.connectionState !== "connected" || record.ws?.readyState !== WebSocket.OPEN;
      record.status = "committed";
      if (record.timer) clearTimeout(record.timer);
      if (this.promoted && this.promoted !== record) {
        this.promoted.unsubscribe?.(); this.promoted.unsubscribe = undefined;
        this.promoted.disposeSocket?.(); this.promoted.disposeSocket = undefined;
        this.promoted.clone.stop();
      }
      this.pending = null; this.promoted = record; this.transmissionBlocked = true;
      retireMoveTransport(record.source.pc, record.source.ws);
      this.deps.onPromote(record, record.request, recoveryRequired);
      if (recoveryRequired) throw this.error("destination_recovery_required");
    })().finally(() => { record.commitPromise = undefined; });
    return record.commitPromise;
  }
  async abort(requestId: string): Promise<void> {
    const record = this.records.get(requestId);
    if (!record || record.status === "committed" || record.status === "aborted") return;
    try {
      if ((await this.confirmation(record)).status === "committed") { await this.commit(requestId); return; }
    } catch (error) { if (record.authorityCommitted) throw error; }
    this.closePending(record, "aborted", true);
  }
  resume(requestId: string): Promise<void> {
    const record = this.promoted;
    if (!record || record.request.requestId !== requestId || record.status !== "committed") return Promise.reject(this.error("not_committed"));
    if (record.resumePromise) return record.resumePromise;
    const promise: Promise<void> = this.resumeRecord(record).finally(() => {
      if (record.resumePromise === promise) record.resumePromise = undefined;
    });
    record.resumePromise = promise;
    return promise;
  }
  private async rollbackResume(record: MoveRecord): Promise<void> {
    if (this.promoted !== record || record.pc.connectionState !== "connected" ||
        record.ws?.readyState !== WebSocket.OPEN || record.clone.readyState !== "live") {
      retireMoveTransport(record.pc, record.ws);
      return;
    }
    try { await record.sender.replaceTrack(record.clone); } catch { retireMoveTransport(record.pc, record.ws); }
  }
  private async resumeRecord(record: MoveRecord): Promise<void> {
    const requestId = record.request.requestId;
    this.authenticate(record);
    const current = this.deps.getSource(), barrier = this.deps.getPublicationBarrier();
    if (record.transmissionReleased) {
      if (current?.pc === record.pc && record.pc.connectionState === "connected" && record.ws?.readyState === WebSocket.OPEN &&
          record.sender.track === record.sourceTrack && current.publicationStream.getAudioTracks()[0] === record.sourceTrack &&
          record.sourceTrack.readyState === "live" && record.sourceTrack.enabled === true &&
          record.pc.getSenders().includes(record.sender)) return;
      throw this.error("destination_disconnected");
    }
    if (current?.pc !== record.pc || record.pc.connectionState !== "connected" ||
        !record.authority.isDestinationPolicyApplied(requestId, record.request.channelSettings) ||
        !barrier?.acknowledged || !barrier.blocked || !Number.isFinite(barrier.revision)) throw this.error("destination_policy_not_acknowledged");
    const publication = current.publicationStream.getAudioTracks()[0];
    if (publication !== record.sourceTrack || publication.readyState !== "live" || publication.enabled !== true ||
        !record.pc.getSenders().includes(record.sender)) throw this.error("publication_changed");
    await record.sender.replaceTrack(publication);
    try { this.authenticate(record); }
    catch (error) {
      await this.rollbackResume(record);
      throw error;
    }
    const after = this.deps.getSource(), afterBarrier = this.deps.getPublicationBarrier();
    if (this.promoted !== record || after?.pc !== record.pc || record.pc.connectionState !== "connected" ||
        record.ws?.readyState !== WebSocket.OPEN || after.publicationStream.getAudioTracks()[0] !== publication ||
        publication.readyState !== "live" || publication.enabled !== true || record.sender.track !== publication ||
        !record.pc.getSenders().includes(record.sender) || !afterBarrier?.acknowledged || !afterBarrier.blocked ||
        afterBarrier.revision !== barrier.revision || !record.authority.isDestinationPolicyApplied(requestId, record.request.channelSettings)) {
      await this.rollbackResume(record);
      throw this.error("destination_policy_changed");
    }
    record.clone.stop(); record.transmissionReleased = true; this.transmissionBlocked = false;
    this.deps.onTransmissionReleased(current.publicationStream);
  }

  validatePending(): void {
    if (!this.pending) return;
    try { this.sourceCurrent(this.pending); } catch { this.closePending(this.pending, "source_or_policy_changed", true); }
  }
  sourceDisconnected(): boolean {
    const record = this.pending;
    if (!record || this.deps.getSource()?.pc !== record.source.pc) return false;
    if (!this.sourceReconciliation) {
      this.sourceReconciliation = true;
      void this.commit(record.request.requestId).catch((error: unknown) => {
        if (record.authorityCommitted) return;
        const knownFailure = error instanceof VoiceMoveError && ["authority_pending", "authority_aborted"].includes(error.code);
        if (!knownFailure && record.source.pc.connectionState === "connected") return;
        this.closePending(record, "source_disconnected", true);
        this.deps.onSourceFailure();
      }).finally(() => { this.sourceReconciliation = false; });
    }
    return true;
  }
  invalidatePending(reason: string): void {
    if (this.pending) this.closePending(this.pending, reason, true);
  }
  authorizeConnect(channelId: string): void {
    const promoted = this.promoted;
    if (promoted && this.transmissionBlocked && channelId === promoted.request.destinationChannelId) {
      this.authenticate(promoted);
      const barrier = this.deps.getPublicationBarrier();
      if (!promoted.authority.isDestinationPolicyApplied(promoted.request.requestId, promoted.request.channelSettings) ||
          !barrier?.acknowledged || !barrier.blocked) throw this.error("destination_policy_not_acknowledged");
    }
    this.reset();
  }
  reset(): void {
    this.invalidatePending("source_changed");
    this.promoted?.unsubscribe?.(); this.promoted?.disposeSocket?.();
    this.promoted?.clone.stop();
    this.promoted = null; this.transmissionBlocked = false; this.reconciliationRequired = false;
  }
  dispose(): void {
    this.disposed = true;
    if (this.pending) this.closePending(this.pending, "disposed", true);
    this.promoted?.unsubscribe?.(); this.promoted?.disposeSocket?.();
    this.promoted?.clone.stop();
    this.records.clear();
  }
}
