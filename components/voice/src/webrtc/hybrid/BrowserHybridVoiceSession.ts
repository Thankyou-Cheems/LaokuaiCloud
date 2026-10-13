import type { MicrophoneInterface } from "../../audio/types/Microphone";
import type { StreamSources } from "../types/SFU";
import type { HybridForwardingRequest, HybridParticipant, HybridScope, HybridState } from "../types/Hybrid";
import { BrowserHybridPeer, borrowHybridPublication, type BrowserHybridPeerOptions } from "./BrowserHybridPeer";
import { HybridReceivePortAdapter } from "./HybridReceivePortAdapter";
import { HybridRouteController } from "./HybridRouteController";
import { SfuDecodedAudioMonitor } from "./SfuDecodedAudioMonitor";
import { SocketHybridAuthority, type HybridAuthorizedSnapshot, type HybridSocketTransport } from "./SocketHybridAuthority";

export interface BrowserHybridVoiceState {
  status: "disabled" | "unsupported" | "active" | "recovering" | "disposed";
  reason: string | null;
  routing: HybridState | null;
  /** A host ICE candidate does not prove an EasyTier underlay or a physical direct path. */
  physicalDirectVerified: false;
}
export interface BrowserHybridVoiceOptions extends BrowserHybridPeerOptions {
  enabled?: boolean;
  allowNetwork?: boolean;
  pathStableMs?: number;
  pathMonitorMs?: number;
  socket: HybridSocketTransport;
  getAccessToken(): string | undefined;
  expectedRoomId: string;
  getPeerConnection(): RTCPeerConnection | null;
  getMicrophone(): MicrophoneInterface;
  /** Current account/server/socket/channel binding, independent of local mute/PTT/Squad. */
  isCurrent(): boolean;
  /** Exact current mic publication alias; reject screen, unknown and conflicting owners. */
  getSource(participant: HybridParticipant): StreamSources[string] | null;
  onSelection?(source: StreamSources[string], track: MediaStreamTrack | null, revision: number): void;
  onState?(state: BrowserHybridVoiceState): void;
}
interface PortBinding { source: StreamSources[string]; participant: HybridParticipant; port: HybridReceivePortAdapter }
interface Recovery { request: HybridForwardingRequest; port: HybridReceivePortAdapter; revision: number; restoredRevision?: number }
const sameRoom = (a: HybridScope, b: HybridScope) => a.serverInstanceId === b.serverInstanceId && a.roomId === b.roomId &&
  a.roomGeneration === b.roomGeneration && a.localParticipantId === b.localParticipantId && a.localSessionId === b.localSessionId;

/** Explicit voice-only integration. Uses one existing auth socket and one protected publication. */
export class BrowserHybridVoiceSession {
  private readonly authority: SocketHybridAuthority;
  private readonly pc: RTCPeerConnection;
  private readonly monitor: SfuDecodedAudioMonitor;
  private controller?: HybridRouteController;
  private unsubscribe?: () => void;
  private scope?: HybridScope;
  private ports = new Map<StreamSources[string], PortBinding>();
  private recoveries = new Map<HybridReceivePortAdapter, Recovery>();
  private flight?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private enabled: boolean;
  private state: BrowserHybridVoiceState = { status: "disabled", reason: null, routing: null, physicalDirectVerified: false };
  constructor(private readonly options: BrowserHybridVoiceOptions) {
    const pc = options.getPeerConnection(); if (!pc) throw new Error("sfu_media_unavailable"); this.pc = pc;
    this.enabled = options.enabled === true && options.allowNetwork === true;
    this.authority = new SocketHybridAuthority(options.socket, options.getAccessToken);
    this.monitor = new SfuDecodedAudioMonitor(options.getPeerConnection);
  }
  getState(): BrowserHybridVoiceState { return structuredClone(this.state); }
  /** Current authenticated receive scope only; reading it never refreshes or probes authority. */
  getReceiveScope(): HybridScope | null {
    return this.current() && this.scope && this.authority.isCurrent(this.scope) ? { ...this.scope } : null;
  }
  private publish(status: BrowserHybridVoiceState["status"], reason: string | null): void {
    const routing = this.controller?.getState() ?? null;
    reason ??= routing?.reason ?? null;
    if (status === "active" && routing?.status === "unsupported") { status = "unsupported"; reason = routing.reason; }
    if (status === "active" && routing?.routes.some(route => route.selected === "none")) { status = "recovering"; reason ??= "sfu_restore_incomplete"; }
    this.state = { status, reason, routing, physicalDirectVerified: false };
    try { this.options.onState?.(this.getState()); } catch { /* Observer does not own routing. */ }
  }
  private current(): boolean { return !this.disposed && this.options.isCurrent() && this.options.getPeerConnection() === this.pc && this.pc.connectionState === "connected"; }
  setEnabled(enabled: boolean): Promise<void> { this.enabled = enabled && this.options.allowNetwork === true; return this.update(); }
  /** Single-flight, bounded by authenticated socket ACK and media evidence deadlines. */
  update(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.flight) return this.flight;
    this.flight = this.run().finally(() => {
      this.flight = undefined;
      if (!this.disposed && (this.enabled || this.controller || this.recoveries.size)) this.schedule();
    }); return this.flight;
  }
  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.update(); }, 1000);
  }
  private getPort(participant: HybridParticipant): HybridReceivePortAdapter | null {
    const source = this.options.getSource(participant); if (!source) return null;
    let binding = this.ports.get(source);
    if (binding && binding.participant.sessionId === participant.sessionId && binding.participant.publicationId === participant.publicationId) return binding.port;
    if (binding) { binding.port.dispose(); this.recoveries.delete(binding.port); this.ports.delete(source); }
    if (!source.receiveCleanup?.isCurrent?.()) return null;
    const port = new HybridReceivePortAdapter({ source, monitor: this.monitor,
      getReadOnlyScope: () => this.getReceiveScope(),
      getReadOnlyParticipant: () => ({ participantId: participant.participantId, sessionId: participant.sessionId, publicationId: participant.publicationId }),
      getReadOnlyRoute: () => this.controller?.getState().routes.find(route => route.participantId === participant.participantId &&
        route.sessionId === participant.sessionId && route.publicationId === participant.publicationId) ?? null,
      isCurrent: () => this.current() && this.options.getSource(participant) === source,
      onSelection: (_kind, track, revision) => this.options.onSelection?.(source, track, revision),
      onRetired: () => { this.ports.delete(source); this.recoveries.delete(port); this.controller?.retireReceivePort(port); },
    });
    binding = { source, participant: { ...participant }, port }; this.ports.set(source, binding); return port;
  }
  private async recover(snapshot: HybridAuthorizedSnapshot): Promise<void> {
    this.controller?.setProbeAdmission(false, "auth_recovery_cleanup");
    for (const [port, recovery] of this.recoveries) {
      if (!port.isCurrent()) { this.recoveries.delete(port); continue; }
      if (port.getSelectionRevision() !== (recovery.restoredRevision ?? recovery.revision)) throw new Error("stale_receive_selection");
      if (recovery.restoredRevision === undefined) {
        const request = { ...recovery.request, routeGeneration: recovery.request.routeGeneration + 1,
          operationId: `${recovery.request.routeGeneration + 1}:1` };
        recovery.request = request;
        await port.restoreSfu(() => this.authority.restoreForwarding(request),
          () => this.current() && this.authority.isCurrent(snapshot.scope) && this.recoveries.get(port) === recovery);
        recovery.restoredRevision = port.getSelectionRevision();
        if (!this.controller?.confirmRetiredSfuRecovery(port, recovery.restoredRevision)) throw new Error("stale_receive_selection");
      }
      if (!this.current() || !port.isCurrent() || !this.authority.isCurrent(snapshot.scope)) throw new Error("hybrid_scope_stale");
      // Reconcile the actual restored edge while probes remain closed until every old pair is retired.
      this.controller?.reconcile(snapshot.scope, snapshot.participants.filter(participant => {
        const source = this.options.getSource(participant), binding = source && this.ports.get(source);
        const pending = binding && this.recoveries.get(binding.port);
        return !pending || pending.restoredRevision !== undefined;
      }));
      await this.authority.retireRestoredPair(recovery.request);
      if (!this.current() || !port.isCurrent() || port.getSelectionRevision() !== recovery.restoredRevision) throw new Error("stale_receive_selection");
      if (this.recoveries.get(port) === recovery) this.recoveries.delete(port);
    }
  }
  private async run(): Promise<void> {
    if (!this.current()) { this.dispose(); return; }
    if (!this.enabled && !this.controller && !this.recoveries.size) { this.publish("disabled", null); return; }
    try {
      const snapshot = await this.authority.refresh();
      if (!this.current() || snapshot.scope.roomId !== this.options.expectedRoomId || snapshot.scope.localSessionId !== this.options.socket.id) {
        this.dispose(); return;
      }
      if (this.scope && !sameRoom(this.scope, snapshot.scope)) { this.dispose(); return; }
      this.scope = snapshot.scope;
      for (const [source, binding] of this.ports) if (!binding.port.isCurrent()) {
        binding.port.dispose(); this.recoveries.delete(binding.port); this.ports.delete(source);
      }
      if (this.recoveries.size) { this.publish("recovering", "fresh_sfu_restore_required"); await this.recover(snapshot); }
      if (!this.current()) return;
      if (!this.controller && this.enabled) {
        this.controller = new HybridRouteController({ authority: this.authority,
          getPublication: () => borrowHybridPublication(this.options.getMicrophone(), this.options.getPeerConnection()),
          getReceivePort: participant => this.getPort(participant),
          createPeer: factory => new BrowserHybridPeer(factory, this.options),
          recoverRetiredSfu: (request, input, revision) => {
            if (input instanceof HybridReceivePortAdapter && input.isCurrent()) {
              this.recoveries.set(input, { request, port: input, revision }); this.publish("recovering", "fresh_sfu_restore_required");
            }
          },
        }, { enabled: true, allowNetwork: true, pathStableMs: this.options.pathStableMs, pathMonitorMs: this.options.pathMonitorMs });
        this.unsubscribe = this.controller.subscribe(() => {
          if (!this.disposed) this.publish(this.recoveries.size ? "recovering" : this.enabled ? "active" : "recovering", this.recoveries.size ? "fresh_sfu_restore_required" : null);
        });
      }
      if (!this.enabled) {
        if (this.controller && !await this.controller.restoreSfuAndDispose()) { this.publish("recovering", "sfu_restore_incomplete"); return; }
        this.unsubscribe?.(); this.unsubscribe = undefined; this.controller = undefined;
        for (const binding of this.ports.values()) binding.port.releaseRestored();
        this.ports.clear(); this.publish("disabled", null); return;
      }
      this.controller!.reconcile(snapshot.scope, snapshot.participants);
      this.controller!.setProbeAdmission(true);
      this.publish(this.recoveries.size ? "recovering" : "active", this.recoveries.size ? "fresh_sfu_restore_required" : null);
    } catch (error) {
      if (!this.disposed) this.publish(this.recoveries.size ? "recovering" : "unsupported",
        error instanceof Error && /^(hybrid_[a-z_]+|fresh_sfu_media_unavailable|sfu_binding_retired|stale_receive_selection)$/.test(error.message) ? error.message : "hybrid_unavailable");
    }
  }
  /** Room/account/PC retirement closes peers and inputs immediately; never reconnect a stale route. */
  dispose(): void {
    if (this.disposed) return; this.disposed = true; clearTimeout(this.timer);
    this.unsubscribe?.(); this.controller?.dispose(); this.authority.dispose();
    for (const binding of this.ports.values()) binding.port.dispose();
    this.ports.clear(); this.recoveries.clear(); this.monitor.dispose(); this.publish("disposed", null);
  }
}
