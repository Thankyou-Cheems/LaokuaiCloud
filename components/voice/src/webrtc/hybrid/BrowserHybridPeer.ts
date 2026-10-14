import type { MicrophoneInterface } from "../../audio/types/Microphone";
import { applyLocalMicrophoneCodecSdp, applyMicrophoneCodec, snapshotMicrophoneCodec } from "../hooks/microphoneCodec";
import { idleMicrophoneCodecState, type MicrophoneCodecProfile, type MicrophoneCodecState } from "../types/MicrophoneCodec";
import type { HybridMediaCandidate, HybridPeerFactoryOptions, HybridPeerMetrics, HybridPeerSession, HybridPublication, HybridSignalBody } from "../types/Hybrid";
import { readReceiveStats, ReceiveTrackStats } from "./receivePathStats";
import type { ReceivePathUnderlayResolver, ReceiveTrackObservation } from "../types/ReceivePath";
import { createHybridDiagnosticReporter, peerMediaDiagnostic, type BrowserHybridDiagnostic } from "./hybridDiagnostic";

export interface BrowserHybridPeerOptions {
  /** Explicit host-supplied ICE configuration. No public discovery server is added. */
  rtcConfiguration: RTCConfiguration;
  microphoneCodec: MicrophoneCodecProfile;
  channelMaxBitrateBps?: number | null;
  /** Optional host-owned ET/VPN evidence; receives only the in-memory selected path. */
  pathUnderlayResolver?: ReceivePathUnderlayResolver;
  onDiagnostic?: (event: BrowserHybridDiagnostic) => void;
}

// Media identity is independent of mute/PTT/Squad control acknowledgements.
const borrowed = new WeakMap<MediaStream, WeakMap<MediaStreamTrack, number>>();
let nextPublication = 0;

/** Borrow only the stable SDK publication already registered on the current SFU PC. */
export function borrowHybridPublication(microphone: MicrophoneInterface, pc: RTCPeerConnection | null): HybridPublication | null {
  const stream = microphone.microphoneBuffer.publicationStream;
  const track = stream?.getAudioTracks()[0], state = microphone.transmissionState;
  if (!stream || !track || stream.getTracks().length !== 1 || track.readyState !== "live" || !track.enabled ||
      !pc || pc.connectionState !== "connected" || !pc.getSenders().some(sender => sender.track === track)) return null;
  let tracks = borrowed.get(stream), generation = tracks?.get(track);
  if (generation === undefined) {
    // Initial admission needs a real publication ACK. Later gate changes keep the same protected track.
    if (state.publicationAcknowledged !== true || !Number.isSafeInteger(state.publicationRevision)) return null;
    if (!tracks) { tracks = new WeakMap(); borrowed.set(stream, tracks); }
    generation = ++nextPublication; tracks.set(track, generation);
  }
  return { stream, track, generation, publicationAcknowledged: true, publicationRevision: state.publicationRevision ?? 0 };
}

/** Real WebRTC adapter. ICE connection alone never establishes a playable route. */
export class BrowserHybridPeer implements HybridPeerSession {
  readonly pc: RTCPeerConnection;
  private readonly sender: RTCRtpSender;
  private readonly profile: MicrophoneCodecProfile;
  private disposed = false;
  private failed = false;
  private started = false;
  private remote?: MediaStream;
  private remoteTrack?: MediaStreamTrack;
  private decoder?: HTMLAudioElement;
  private pendingIce: (RTCIceCandidateInit | null)[] = [];
  private lastSamples = 0;
  private lastPackets = 0;
  private codecState: MicrophoneCodecState = idleMicrophoneCodecState();
  private initialCodecFlight?: Promise<void>;
  private sequence = 0;
  private lastDecodedAt = -Infinity;
  private decodedFrames = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private statsFlight?: Promise<RTCStatsReport>;
  private waiters = new Set<{ resolve(candidate: HybridMediaCandidate): void; reject(error: Error): void }>();
  private readonly receiveStats = new ReceiveTrackStats();
  private receiveObservation: ReceiveTrackObservation | null = null;
  private readonly diagnostic: (event: BrowserHybridDiagnostic) => void;

  constructor(private readonly factory: HybridPeerFactoryOptions, private readonly options: BrowserHybridPeerOptions) {
    this.diagnostic = createHybridDiagnosticReporter(options.onDiagnostic);
    const profile = snapshotMicrophoneCodec(options.microphoneCodec);
    if (!profile) throw new Error("peer_codec_profile_invalid"); this.profile = profile;
    const { publication } = factory;
    if (!publication.publicationAcknowledged || publication.track.kind !== "audio" ||
        publication.track.readyState !== "live" || !publication.track.enabled ||
        publication.stream.getTracks().length !== 1 || publication.stream.getAudioTracks()[0] !== publication.track) throw new Error("protected_publication_required");
    this.pc = new RTCPeerConnection({ ...options.rtcConfiguration });
    this.sender = this.pc.addTrack(publication.track, publication.stream);
    this.pc.onicecandidate = event => this.signal({ kind: "candidate", candidate: event.candidate?.toJSON() ?? null });
    this.pc.ontrack = event => {
      // Exactly one authenticated microphone publication is admitted, never screen/video.
      if (event.track.kind !== "audio" || this.remoteTrack && this.remoteTrack !== event.track ||
          event.streams.length !== 1 || event.streams[0].getTracks().length !== 1 || event.streams[0].getAudioTracks()[0] !== event.track) { this.fail("peer_publication_mismatch"); return; }
      if (this.remoteTrack === event.track) return;
      this.remote = event.streams[0]; this.remoteTrack = event.track;
      this.decoder = new Audio(); this.decoder.srcObject = this.remote; this.decoder.volume = 0;
      this.decoder.play().catch(() => this.fail("peer_decoder_unavailable"));
      event.track.addEventListener("ended", this.trackEnded);
    };
    this.pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(this.pc.connectionState)) this.fail("peer_connection_lost");
    };
    publication.track.addEventListener("ended", this.trackEnded);
  }
  private trackEnded = () => this.fail("peer_track_ended");
  private signal(body: HybridSignalBody): void { if (!this.disposed && !this.failed) this.factory.onSignal(body); }
  private ensure(): void { if (this.disposed || this.failed) throw new Error("peer_unavailable"); }

  async start(): Promise<void> {
    this.ensure(); if (this.started) return; this.started = true;
    await this.initialCodec(); this.ensure();
    this.poll();
    if (this.factory.lease.initiator) {
      await this.pc.setLocalDescription(await this.pc.createOffer()); this.ensure();
      const sdp = applyLocalMicrophoneCodecSdp(this.pc, [this.sender], this.pc.localDescription!.sdp, this.profile);
      await this.pc.setLocalDescription({ type: "offer", sdp }); this.ensure();
      this.signal({ kind: "offer", sdp: this.pc.localDescription!.sdp });
    }
  }
  async acceptSignal(body: HybridSignalBody): Promise<void> {
    this.ensure();
    await this.initialCodec(); this.ensure();
    if (body.kind === "candidate") {
      if (!this.pc.remoteDescription) { if (this.pendingIce.length >= 64) throw new Error("peer_ice_overflow"); this.pendingIce.push(body.candidate); }
      else if (body.candidate) await this.pc.addIceCandidate(body.candidate);
      return;
    }
    const description = body.sdp;
    if ((description.match(/^m=audio /gm)?.length ?? 0) !== 1 || (description.match(/^m=/gm)?.length ?? 0) !== 1) throw new Error("peer_audio_only_required");
    if (body.kind === "offer") {
      if (this.factory.lease.initiator || this.pc.signalingState !== "stable") throw new Error("peer_offer_role_mismatch");
      await this.pc.setRemoteDescription({ type: "offer", sdp: description }); this.ensure();
      await this.drainIce();
      const answer = await this.pc.createAnswer(); this.ensure();
      const sdp = applyLocalMicrophoneCodecSdp(this.pc, [this.sender], answer.sdp!, this.profile);
      await this.pc.setLocalDescription({ type: "answer", sdp }); this.ensure();
      await this.configure(description);
      this.signal({ kind: "answer", sdp: this.pc.localDescription!.sdp });
    } else {
      if (!this.factory.lease.initiator || this.pc.signalingState !== "have-local-offer") throw new Error("peer_answer_role_mismatch");
      await this.pc.setRemoteDescription({ type: "answer", sdp: description }); this.ensure();
      await this.drainIce(); await this.configure(description);
    }
  }
  private initialCodec(): Promise<void> {
    return this.initialCodecFlight ??= (async () => {
      // Apply the trusted channel ceiling before starting any SDP exchange.
      const state = await applyMicrophoneCodec(this.pc, [this.sender], this.profile, undefined, this.options.channelMaxBitrateBps);
      this.codecState = state; this.ensure();
      if (state.status === "degraded") { this.fail(state.reason ?? "peer_codec_unavailable"); throw new Error("peer_codec_unavailable"); }
    })();
  }
  private async configure(sdp: string): Promise<void> {
    const state = await applyMicrophoneCodec(this.pc, [this.sender], this.profile, sdp, this.options.channelMaxBitrateBps);
    this.codecState = state;
    this.ensure(); if (state.status !== "configured") { this.fail(state.reason ?? "peer_codec_unavailable"); throw new Error("peer_codec_unavailable"); }
  }
  getMicrophoneCodecState(): MicrophoneCodecState { return structuredClone(this.codecState); }
  private async drainIce(): Promise<void> {
    for (const candidate of this.pendingIce.splice(0)) { this.ensure(); if (candidate) await this.pc.addIceCandidate(candidate); }
  }
  private stats(): Promise<RTCStatsReport> {
    if (this.statsFlight) return this.statsFlight;
    const result = readReceiveStats(this.pc); this.statsFlight = result;
    void result.finally(() => { if (this.statsFlight === result) this.statsFlight = undefined; }).catch(() => undefined);
    return result;
  }
  private poll(): void {
    if (this.disposed || this.failed) return;
    void this.stats().then(report => {
      if (this.disposed || this.failed) return;
      const now = performance.now(); let samples = 0, packets = 0;
      let observation = this.remoteTrack ? this.receiveStats.observe(report, this.remoteTrack.id, now) : null;
      if (observation && this.options.pathUnderlayResolver) {
        try {
          const underlay = this.options.pathUnderlayResolver.resolve(observation.transportPath);
          if (underlay && underlay.source === "host-underlay-resolver" && Number.isFinite(underlay.observedAtMs) &&
              underlay.observedAtMs <= observation.transportPath.observedAtMs) {
            const transportPath = { ...observation.transportPath, underlay };
            observation = { ...observation, transportPath,
              metrics: { ...observation.metrics, path: {
                ...observation.metrics.path, underlay: underlay.classification,
              } } };
          }
        } catch { /* An optional host observer cannot affect media routing. */ }
      }
      this.receiveObservation = observation;
      this.diagnostic(peerMediaDiagnostic(observation));
      const remoteTrackId = this.remoteTrack?.id; let matchedRows = 0;
      report.forEach(row => { if (row.type === "inbound-rtp" && (row.kind ?? row.mediaType) === "audio" &&
        row.trackIdentifier === remoteTrackId) {
        matchedRows++;
        if (Number.isSafeInteger(row.totalSamplesReceived) && row.totalSamplesReceived >= 0 &&
            Number.isSafeInteger(row.packetsReceived) && row.packetsReceived >= 0) {
          samples += row.totalSamplesReceived; packets += row.packetsReceived;
        }
      } });
      // Only one exact-track row proves this peer's media; ambiguous/absent
      // stats wait for freshness expiry without resetting valid counters.
      if (matchedRows !== 1) {
        if (this.sequence > 0 && now - this.lastDecodedAt > 3000) this.fail("peer_decoded_media_stale");
        return;
      }
      if (samples < this.lastSamples || packets < this.lastPackets) { this.fail("peer_stats_reset"); return; }
      if (Number.isSafeInteger(samples) && Number.isSafeInteger(packets) && samples > this.lastSamples && packets > this.lastPackets && this.remoteTrack?.readyState === "live") {
        this.lastSamples = samples; this.lastPackets = packets; this.decodedFrames = Math.max(1, Math.floor(samples / 480)); ++this.sequence; this.lastDecodedAt = now;
        const candidate = this.candidate(); if (candidate) for (const waiter of this.waiters) waiter.resolve(candidate); this.waiters.clear();
      } else if (this.sequence > 0 && now - this.lastDecodedAt > 3000) this.fail("peer_decoded_media_stale");
    }).catch(() => this.fail("peer_stats_unavailable")).finally(() => {
      if (!this.disposed && !this.failed) this.timer = setTimeout(() => this.poll(), this.sequence > 0 ? 500 : 200);
    });
  }
  private candidate(): HybridMediaCandidate | undefined {
    if (!this.remote || !this.remoteTrack || this.decodedFrames <= 0 || !this.isHealthy()) return;
    return { stream: this.remote, track: this.remoteTrack, decodedFrames: this.decodedFrames, mediaSequence: this.sequence,
      observedAtMs: this.lastDecodedAt, getReceiveObservation: () => this.getReceiveObservation() };
  }
  getReceiveObservation(): ReceiveTrackObservation | null {
    const value = this.receiveObservation;
    return !this.disposed && !this.failed && this.pc.connectionState === "connected" && this.remoteTrack?.readyState === "live" &&
      value?.trackId === this.remoteTrack.id && performance.now() - value.observedAtMs <= 3000 ? structuredClone(value) : null;
  }
  private isHealthy(): boolean {
    return !this.disposed && !this.failed && this.pc.connectionState === "connected" &&
      this.remoteTrack?.readyState === "live" && performance.now() - this.lastDecodedAt <= 3000;
  }
  waitForMedia(): Promise<HybridMediaCandidate> {
    this.ensure(); const candidate = this.candidate();
    return candidate ? Promise.resolve(candidate) : new Promise((resolve, reject) => this.waiters.add({ resolve, reject }));
  }
  isReceiving(candidate: HybridMediaCandidate): boolean { return candidate.track === this.remoteTrack && this.isHealthy(); }
  async readMetrics(): Promise<HybridPeerMetrics> {
    this.ensure(); const stats = await this.stats(); this.ensure(); let packets = 0, bytes = 0, matched = false, headers: number | null = null, cpu: number | null = null;
    stats.forEach(row => { if (row.type !== "outbound-rtp" || (row.kind ?? row.mediaType) !== "audio") return;
      if (!Number.isSafeInteger(row.packetsSent) || row.packetsSent < 0 || !Number.isSafeInteger(row.bytesSent) || row.bytesSent < 0) return;
      matched = true; packets += row.packetsSent; bytes += row.bytesSent;
      if (typeof row.headerBytesSent === "number") headers = (headers ?? 0) + row.headerBytesSent;
      if (typeof row.totalEncodeTime === "number") cpu = (cpu ?? 0) + row.totalEncodeTime; });
    if (!matched) throw new Error("peer_metrics_unavailable");
    return { source: "rtc-stats", observedAtMs: performance.now(), packetsSent: packets, payloadBytesSent: bytes, headerBytesSent: headers, totalEncodeTimeSeconds: cpu };
  }
  private fail(reason: string): void {
    if (this.disposed || this.failed) return; this.failed = true; clearTimeout(this.timer);
    this.diagnostic(peerMediaDiagnostic(this.receiveObservation, reason));
    for (const waiter of this.waiters) waiter.reject(new Error(reason)); this.waiters.clear();
    try { this.pc.close(); } catch {} this.decoder?.pause();
    try { this.factory.onFailure(reason); } catch { /* Media is already stopped. */ }
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; clearTimeout(this.timer);
    for (const waiter of this.waiters) waiter.reject(new Error("peer_disposed")); this.waiters.clear();
    this.pendingIce.length = 0; this.pc.onicecandidate = this.pc.ontrack = this.pc.onconnectionstatechange = null;
    this.remoteTrack?.removeEventListener("ended", this.trackEnded); this.factory.publication.track.removeEventListener("ended", this.trackEnded);
    if (this.decoder) { this.decoder.pause(); this.decoder.srcObject = null; this.decoder.remove(); }
    this.pc.close();
  }
}
