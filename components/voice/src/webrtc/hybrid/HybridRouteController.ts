import type {
  HybridClock, HybridDependencies, HybridForwardingAck, HybridForwardingRequest,
  HybridMediaCandidate, HybridMetrics, HybridOptions, HybridPairLease, HybridParticipant,
  HybridPeerMetrics, HybridPeerSession, HybridPublication, HybridReceivePort, HybridRouteState,
  HybridScope, HybridSignal, HybridSignalBody, HybridState,
} from "../types/Hybrid";
import type { ReceiveTrackObservation } from "../types/ReceivePath";
import { hybridProtocolFailure, type BrowserHybridDiagnostic } from "./hybridDiagnostic";
import { HYBRID_MEDIA_HEALTH_MAX_AGE_MS, HYBRID_MEDIA_PROOF_MAX_AGE_MS } from "./hybridMediaTiming";

interface Route {
  participant: HybridParticipant;
  scope: HybridScope;
  publication: HybridPublication;
  port: HybridReceivePort;
  state: HybridRouteState;
  peer?: HybridPeerSession;
  lease?: HybridPairLease;
  /** Signal sequence numbers are scoped to one server-minted pair connection. */
  signalConnectionId?: string;
  candidate?: HybridMediaCandidate;
  generation: number;
  signalIn: number;
  signalOut: number;
  outbound: Promise<void>;
  inbound: Promise<void>;
  pauseAttempted: boolean;
  pauseUntil: number;
  pathSince?: number;
  pathKey?: string;
  pathMonitor?: unknown;
  reprobe?: unknown;
  reprobeAttempt: number;
  restoreRetry?: unknown;
  restoreAttempts: number;
  renew?: unknown;
  expiry?: unknown;
  cancellations: Set<() => void>;
  pendingIn: number;
  pendingOut: number;
  recovery?: Promise<void>;
}

const clockDefault: HybridClock = {
  now: () => performance.now(),
  schedule: (callback, delay) => setTimeout(callback, delay),
  cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;
const finite = (value: number) => Number.isFinite(value) && value >= 0;
const diagnostic = (error: unknown, fallback: string) => error instanceof Error &&
  /^(operation_timeout|route_cancelled|invalid_pair_lease|decoded_media_unavailable|media_stale_before_switch|peer_path_not_admitted|peer_path_unstable|peer_path_unavailable|peer_path_inconsistent|peer_media_stale|forwarding_ack_mismatch|fresh_sfu_media_unavailable|invalid_sfu_media_sequence|stale_receive_selection|invalid_receive_candidate|invalid_receive_node)$/.test(error.message)
  ? error.message : fallback;
const sameScope = (a: HybridScope, b: HybridScope) => a.serverInstanceId === b.serverInstanceId &&
  a.roomId === b.roomId && a.roomGeneration === b.roomGeneration &&
  a.localParticipantId === b.localParticipantId && a.localSessionId === b.localSessionId &&
  a.canPublish === b.canPublish && a.canReceive === b.canReceive;
const validScope = (scope: HybridScope) => [scope.serverInstanceId, scope.roomId, scope.roomGeneration,
  scope.localParticipantId, scope.localSessionId].every(id) &&
  typeof scope.canPublish === "boolean" && typeof scope.canReceive === "boolean";
const validSignal = (body: HybridSignalBody) => body && (
  (body.kind === "offer" || body.kind === "answer") ? typeof body.sdp === "string" && body.sdp.length <= 65536 :
  body.kind === "candidate" && (body.candidate === null ||
    (typeof body.candidate.candidate === "string" && body.candidate.candidate.length <= 4096 &&
      (body.candidate.sdpMid == null || (typeof body.candidate.sdpMid === "string" && body.candidate.sdpMid.length <= 256)) &&
      (body.candidate.sdpMLineIndex == null || (Number.isSafeInteger(body.candidate.sdpMLineIndex) && body.candidate.sdpMLineIndex >= 0 && body.candidate.sdpMLineIndex <= 1024)) &&
      (body.candidate.usernameFragment == null || (typeof body.candidate.usernameFragment === "string" && body.candidate.usernameFragment.length <= 256))))
);
const copySignalBody = (body: HybridSignalBody): HybridSignalBody => body.kind === "candidate" ?
  { kind: "candidate", candidate: body.candidate === null ? null : {
    candidate: body.candidate.candidate, sdpMid: body.candidate.sdpMid,
    sdpMLineIndex: body.candidate.sdpMLineIndex, usernameFragment: body.candidate.usernameFragment,
  } } : { kind: body.kind, sdp: body.sdp };
const numberOption = (value: number | undefined, fallback: number, min: number, max: number) =>
  value === undefined ? fallback : Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
const reprobeDelaysMs = [15000, 30000, 60000] as const;
const restoreRetryDelaysMs = [1000, 2000, 4000, 8000] as const;
const restoreCooldownMs = 60000;

/** Experimental adapter-driven controller; the normal SDK SFU path is unchanged. */
export class HybridRouteController {
  private readonly clock: HybridClock;
  private readonly options: Required<HybridOptions>;
  private routes = new Map<string, Route>();
  private scope: HybridScope | null = null;
  private listeners = new Set<(state: HybridState) => void>();
  private disposed = false;
  private generations = 0;
  private selections = 0;
  private operations = 0;
  private rejectedSignals = 0;
  private admission = true;
  private admissionReason: string | null = null;
  private activeProbes = 0;
  private lastProbe = -Infinity;
  private pumpTimer?: unknown;
  private cleanups: (() => void)[] = [];
  private previousMetrics = new Map<HybridPeerSession, HybridPeerMetrics>();
  private metricsFlight: Promise<HybridMetrics> | null = null;
  private metricsCached: HybridMetrics | null = null;
  private metricsAt = -Infinity;
  private restorePorts = new WeakSet<HybridReceivePort>();
  private stateReason: string | null = null;
  private stopping = false;
  private stopFlight: Promise<boolean> | null = null;
  private releasedLeases = new WeakSet<HybridPairLease>();

  constructor(private readonly dependencies: HybridDependencies, options: HybridOptions = {}) {
    this.clock = dependencies.clock ?? clockDefault;
    this.options = {
      enabled: options.enabled ?? false, allowNetwork: options.allowNetwork ?? false,
      pathStableMs: numberOption(options.pathStableMs, 1000, 0, 10000),
      pathMonitorMs: numberOption(options.pathMonitorMs, 500, 100, 5000),
      maxPeerConnections: numberOption(options.maxPeerConnections, 19, 1, 19),
      maxConcurrentProbes: numberOption(options.maxConcurrentProbes, 2, 1, 19),
      minProbeIntervalMs: numberOption(options.minProbeIntervalMs, 250, 50, 60000),
      probeTimeoutMs: numberOption(options.probeTimeoutMs, 10000, 100, 60000),
      switchTimeoutMs: numberOption(options.switchTimeoutMs, 5000, 100, 30000),
      pauseLeaseMs: numberOption(options.pauseLeaseMs, 10000, 1000, 30000),
      leaseRenewMs: numberOption(options.leaseRenewMs, 4000, 100, 10000),
    };
    this.options.maxConcurrentProbes = Math.min(this.options.maxConcurrentProbes, this.options.maxPeerConnections);
    this.options.leaseRenewMs = Math.min(this.options.leaseRenewMs, this.options.pauseLeaseMs / 3);
    if (!this.unsupportedReason() && this.options.enabled) {
      const authority = dependencies.authority!;
      this.cleanups.push(authority.subscribeSignals(signal => this.onSignal(signal)));
      this.cleanups.push(authority.subscribeInvalidation(() => this.invalidate("authority_invalidated")));
      if (authority.subscribePairInvalidation) this.cleanups.push(authority.subscribePairInvalidation(connectionId => {
        for (const route of this.routes.values()) if (route.lease?.connectionId === connectionId && this.current(route)) {
          try { this.select(route, "none"); } catch { /* Keep selection failure observable. */ }
          try { route.peer?.dispose(); } catch { /* Continue to authorized fallback. */ } route.peer = undefined;
          void this.fallback(route.participant.participantId, "pair_invalidated");
        }
      }));
    }
  }

  private unsupportedReason(): string | null {
    const authority = this.dependencies.authority;
    if (!authority || authority.capabilities?.protocolVersion !== 1 ||
      authority.capabilities.authenticatedRoomSignals !== true || authority.capabilities.pairForwardingLeases !== true) {
      return "authenticated_pair_protocol_unavailable";
    }
    return authority.environment === "network" && !this.options.allowNetwork ? "network_not_authorized" : null;
  }

  getState(): HybridState {
    const reason = this.unsupportedReason();
    return {
      kind: "hybrid-prototype", status: this.disposed ? "disposed" : !this.options.enabled ? "disabled" : reason ? "unsupported" : "active",
      reason: !this.options.enabled ? null : reason ?? this.stateReason ?? this.admissionReason,
      environment: this.dependencies.authority?.environment ?? "unavailable",
      peerConnections: [...this.routes.values()].filter(route => route.peer).length,
      concurrentProbes: this.activeProbes,
      queuedProbes: [...this.routes.values()].filter(route => route.state.status === "queued").length,
      probeAdmissionAllowed: this.admission, rejectedSignals: this.rejectedSignals,
      routes: [...this.routes.values()].map(route => ({ ...route.state, forwardingPaused: route.pauseUntil > this.clock.now() })),
    };
  }

  subscribe(listener: (state: HybridState) => void): () => void {
    this.listeners.add(listener);
    try { listener(this.getState()); } catch { /* Isolate observers. */ }
    return () => this.listeners.delete(listener);
  }

  /** SDK receive entry retirement closes its peer synchronously, before graph teardown. */
  retireReceivePort(port: HybridReceivePort): void {
    for (const [key, route] of this.routes) if (route.port === port) {
      this.retire(route, "receive_binding_retired"); this.routes.delete(key);
    }
    this.emit(); this.pump();
  }

  /** Transfer a completed ACK + fresh-media restoration back from the host recovery owner. */
  confirmRetiredSfuRecovery(port: HybridReceivePort, revision: number): boolean {
    const selection = port.getSelection?.();
    if (this.disposed || !port.isCurrent() || !selection || selection.kind !== "sfu" || !selection.trackId ||
      selection.revision !== revision || !Number.isSafeInteger(revision) || revision < 0 ||
      [...this.routes.values()].some(route => route.port === port)) return false;
    this.restorePorts.delete(port); return true;
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) { try { listener(state); } catch { /* Isolate observers. */ } }
  }

  /** Reconcile only server-authorized stable IDs and the current physical receive ports. */
  reconcile(scope: HybridScope, participants: readonly HybridParticipant[]): void {
    if (this.disposed) return;
    if (!validScope(scope) || !this.dependencies.authority?.isCurrent(scope)) {
      this.invalidate("invalid_scope"); return;
    }
    if (this.scope && !sameScope(this.scope, scope)) this.invalidate("scope_changed");
    this.scope = { ...scope };
    this.stateReason = !scope.canPublish || !scope.canReceive ? "permission_unavailable" : null;
    const publication = this.dependencies.getPublication();
    if (!this.validPublication(publication) && !this.stateReason) this.stateReason = "protected_publication_unavailable";
    const usable = this.options.enabled && !this.unsupportedReason() && scope.canPublish && scope.canReceive &&
      this.validPublication(publication);
    const accepted = new Map<string, HybridParticipant>();
    for (const participant of participants) {
      if ([participant.participantId, participant.sessionId, participant.publicationId].every(id) &&
          participant.canSendAudio === true && participant.canReceiveAudio === true &&
          participant.participantId !== scope.localParticipantId && participant.sessionId !== scope.localSessionId &&
          !accepted.has(participant.participantId) && ![...accepted.values()].some(other => other.sessionId === participant.sessionId)) {
        accepted.set(participant.participantId, { ...participant });
      }
    }
    for (const [key, route] of this.routes) {
      const participant = accepted.get(key);
      if (!usable || !participant || participant.sessionId !== route.participant.sessionId ||
        participant.publicationId !== route.participant.publicationId || !route.port.isCurrent() ||
        !this.samePublication(route.publication, publication)) {
        this.retire(route, "binding_changed"); this.routes.delete(key);
      }
    }
    if (usable && !this.stopping) for (const [key, participant] of accepted) {
      if (this.routes.has(key)) continue;
      const port = this.dependencies.getReceivePort(participant);
      if (!port?.isCurrent() || [...this.routes.values()].some(route => route.port === port)) continue;
      const generation = ++this.generations;
      const withinLimit = this.routes.size < this.options.maxPeerConnections;
      const selection = port.getSelection?.();
      const restoring = this.restorePorts.has(port) || selection?.kind === "none";
      const route: Route = {
        participant, scope: { ...scope }, publication: { ...publication! }, port, generation,
        signalIn: 0, signalOut: 0, outbound: Promise.resolve(), inbound: Promise.resolve(),
        pauseAttempted: restoring, pauseUntil: 0, reprobeAttempt: 0, restoreAttempts: 0,
        cancellations: new Set(), pendingIn: 0, pendingOut: 0,
        state: { participantId: participant.participantId, sessionId: participant.sessionId,
          publicationId: participant.publicationId, routeGeneration: generation, selectionRevision: selection?.revision ?? 0,
          status: restoring ? "sfu" : withinLimit ? "queued" : "sfu", selected: selection?.kind ?? (restoring ? "none" : "sfu"), selectedTrackId: selection?.trackId ?? null,
          reason: withinLimit ? null : "peer_limit", forwardingPaused: false },
      };
      this.routes.set(key, route);
      if (restoring) void this.fallback(key, "binding_restore_required").then(() => {
        if (withinLimit && this.current(route) && route.state.status === "sfu") {
          route.state.status = "queued"; this.emit(); this.pump();
        }
      });
    }
    this.emit(); this.pump();
  }

  private validPublication(publication: HybridPublication | null): publication is HybridPublication {
    return !!publication && publication.publicationAcknowledged && Number.isSafeInteger(publication.generation) &&
      publication.generation >= 0 && Number.isSafeInteger(publication.publicationRevision) && publication.publicationRevision >= 0 &&
      publication.track.kind === "audio" && publication.track.readyState === "live" &&
      publication.stream.getAudioTracks().includes(publication.track);
  }

  private samePublication(a: HybridPublication, b: HybridPublication | null): boolean {
    return this.validPublication(b) && a.track === b.track && a.stream === b.stream &&
      a.generation === b.generation;
  }

  private current(route: Route, generation = route.generation): boolean {
    if (this.disposed || this.routes.get(route.participant.participantId) !== route || route.generation !== generation) return false;
    try {
      if (this.scope && sameScope(route.scope, this.scope) && this.dependencies.authority!.isCurrent(route.scope) &&
          route.port.isCurrent() && this.samePublication(route.publication, this.dependencies.getPublication())) return true;
    } catch { /* Treat an unavailable binding as revoked. */ }
    this.retire(route, "binding_stale"); this.routes.delete(route.participant.participantId);
    this.stateReason = "binding_stale"; this.emit(); return false;
  }

  private receiving(route: Route, candidate = route.candidate): boolean {
    try { return !!candidate && candidate.track.readyState === "live" && !!route.peer?.isReceiving(candidate); }
    catch { return false; }
  }

  /** Require matching current pair/underlay evidence from the host resolver.
   * Candidate type alone cannot admit a path or prove EasyTier direct routing. */
  private pathAdmission(candidate: HybridMediaCandidate): { key: string; observation: ReceiveTrackObservation } | null {
    let observation: ReceiveTrackObservation | null = null;
    try { observation = candidate.getReceiveObservation?.() ?? null; } catch { return null; }
    if (!observation) return null;
    const path = observation.transportPath, summary = observation.metrics.path;
    const underlay = path.underlay;
    const now = this.clock.now();
    if (path.classification !== "non-turn-candidate" || summary.classification !== path.classification ||
        summary.pairId !== path.pairId || summary.underlay !== underlay?.classification ||
        !id(path.pairId) || !underlay || underlay.source !== "host-underlay-resolver" ||
        !finite(underlay.observedAtMs) || underlay.observedAtMs > path.observedAtMs ||
        underlay.observedAtMs > now || now - underlay.observedAtMs > HYBRID_MEDIA_HEALTH_MAX_AGE_MS ||
        (underlay.classification !== "not-easytier" && underlay.classification !== "easytier-direct")) return null;
    const observedAt = path.observedAtMs;
    if (!finite(observedAt) || observedAt > now || now - observedAt > HYBRID_MEDIA_HEALTH_MAX_AGE_MS) return null;
    return { key: `${path.pairId}:${underlay.classification}`, observation };
  }

  private mediaHealthy(route: Route, candidate = route.candidate): boolean {
    if (!candidate || !finite(candidate.observedAtMs)) return false;
    const now = this.clock.now();
    if (candidate.observedAtMs > now || now - candidate.observedAtMs > HYBRID_MEDIA_HEALTH_MAX_AGE_MS) return false;
    return this.receiving(route, candidate);
  }

  private wait(route: Route, delayMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let handle: unknown;
      const cancel = () => {
        if (handle !== undefined) this.clock.cancel(handle);
        route.cancellations.delete(cancel); reject(new Error("route_cancelled"));
      };
      handle = this.clock.schedule(() => { route.cancellations.delete(cancel); resolve(); }, Math.max(1, delayMs));
      route.cancellations.add(cancel);
    });
  }

  private async awaitAdmittedPath(route: Route, generation: number, initial: HybridMediaCandidate): Promise<HybridMediaCandidate> {
    let candidate = initial, stableKey: string | null = null, stableSince = -Infinity;
    const deadline = this.clock.now() + this.options.probeTimeoutMs;
    while (true) {
      if (!this.current(route, generation)) throw new Error("route_cancelled");
      const admission = this.pathAdmission(candidate);
      if (!admission) throw new Error("peer_path_not_admitted");
      if (!this.mediaHealthy(route, candidate)) throw new Error("peer_media_stale");
      const now = this.clock.now();
      if (stableKey !== admission.key) { stableKey = admission.key; stableSince = now; route.pathKey = admission.key; route.pathSince = now; }
      if (now - stableSince >= this.options.pathStableMs) return candidate;
      if (now >= deadline) throw new Error("peer_path_unstable");
      await this.wait(route, Math.min(this.options.pathMonitorMs, this.options.pathStableMs - (now - stableSince)));
      if (!route.peer) throw new Error("peer_path_unavailable");
      // waitForMedia is a read-only proof request; it never creates a second
      // PeerConnection. The getter then supplies the same current path fact.
      const remaining = deadline - this.clock.now();
      if (!finite(remaining) || remaining === 0) throw new Error("peer_path_unstable");
      candidate = await this.bounded(route, route.peer.waitForMedia(), remaining);
      route.candidate = candidate;
    }
  }

  setProbeAdmission(allowed: boolean, reason: string | null = null): void {
    if (this.stopping || this.disposed) return;
    this.admission = allowed; this.admissionReason = allowed ? null : reason ?? "probe_budget_closed";
    this.emit(); this.pump();
  }

  private pump(): void {
    if (this.pumpTimer !== undefined) { this.clock.cancel(this.pumpTimer); this.pumpTimer = undefined; }
    if (this.disposed || this.stopping || !this.admission || this.activeProbes >= this.options.maxConcurrentProbes) return;
    // Shared session ordering admits a matching pair even when each host's roster arrives in a different order.
    const route = [...this.routes.values()].filter(value => value.state.status === "queued")
      .sort((a, b) => a.participant.sessionId < b.participant.sessionId ? -1 : a.participant.sessionId > b.participant.sessionId ? 1 : 0)
      .find(value => this.current(value));
    if (!route) return;
    const wait = this.options.minProbeIntervalMs - (this.clock.now() - this.lastProbe);
    if (wait > 0) { this.pumpTimer = this.clock.schedule(() => { this.pumpTimer = undefined; this.pump(); }, wait); return; }
    route.state.status = "probing"; route.state.reason = this.admissionReason;
    this.activeProbes++; this.lastProbe = this.clock.now(); this.emit();
    void this.probe(route).finally(() => { this.activeProbes--; this.emit(); this.pump(); });
    this.pump();
  }

  private bounded<T>(route: Route, promise: Promise<T>, delay: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (error: unknown, value?: T) => {
        if (settled) return;
        settled = true; this.clock.cancel(timer); route.cancellations.delete(cancel);
        if (error) reject(error); else resolve(value!);
      };
      const cancel = () => finish(new Error("route_cancelled"));
      const timer = this.clock.schedule(() => finish(new Error("operation_timeout")), delay);
      route.cancellations.add(cancel);
      promise.then(value => finish(null, value), error => finish(error));
    });
  }

  private validMedia(candidate: HybridMediaCandidate): boolean {
    const age = this.clock.now() - candidate.observedAtMs;
    return candidate.track.kind === "audio" && candidate.track.readyState === "live" &&
      candidate.stream.getAudioTracks().includes(candidate.track) && Number.isSafeInteger(candidate.decodedFrames) && candidate.decodedFrames > 0 &&
      Number.isSafeInteger(candidate.mediaSequence) && candidate.mediaSequence > 0 && finite(age) && age <= HYBRID_MEDIA_PROOF_MAX_AGE_MS;
  }

  private async probe(route: Route): Promise<void> {
    const generation = route.generation;
    const probeStarted = this.clock.now();
    let leased: HybridPairLease | undefined;
    try {
      const leasePromise = this.dependencies.authority!.leasePair(route.scope, route.participant);
      leasePromise.then(lease => { if (!this.current(route, generation)) this.release(lease); }, () => undefined);
      leased = await this.bounded(route, leasePromise, this.options.probeTimeoutMs);
      if (!this.current(route, generation)) return;
      if (!id(leased.connectionId) || !sameScope(leased.scope, route.scope) ||
          leased.remoteSessionId !== route.participant.sessionId || typeof leased.initiator !== "boolean" ||
          [...this.routes.values()].some(other => other !== route && other.lease?.connectionId === leased!.connectionId)) {
        throw new Error("invalid_pair_lease");
      }
      route.lease = leased;
      // New pair IDs reset signaling; deliberately reused IDs retain counters
      // so replay rejection stays monotonic across same-pair reconnects.
      if (route.signalConnectionId !== leased.connectionId) {
        route.signalConnectionId = leased.connectionId;
        route.signalIn = 0; route.signalOut = 0;
      }
      const peer = this.dependencies.createPeer({
        lease: leased, publication: route.publication, participant: route.participant,
        onSignal: body => this.sendSignal(route, generation, body),
        onFailure: () => {
          if (this.routes.get(route.participant.participantId) !== route || route.peer !== peer) return;
          if (route.state.status === "recovering") {
            if (route.state.selected === "p2p") {
              try { this.select(route, "none"); } catch { /* Keep disconnect failures observable. */ }
            }
            this.closePeer(route); this.emit();
          } else if (this.current(route)) void this.fallback(route.participant.participantId, "peer_failed");
        },
      });
      route.peer = peer;
      let candidate = await this.bounded(route, peer.start().then(() => peer.waitForMedia()), this.options.probeTimeoutMs);
      if (!this.current(route, generation)) return;
      if (!this.validMedia(candidate) || !this.receiving(route, candidate)) throw new Error("decoded_media_unavailable");
      this.reportHandoff("peer_media_ready", probeStarted, "verified_media");
      candidate = await this.awaitAdmittedPath(route, generation, candidate);
      if (!this.current(route, generation)) return;
      route.candidate = candidate; route.state.status = "switching"; this.emit();
      // Prepare and complete playback locally while the SFU still forwards.
      // Neither signaling latency nor the server pause can open a silent gap.
      if (!this.validMedia(candidate)) throw new Error("media_stale_before_switch");
      const handoffStarted = this.clock.now();
      this.reportHandoff("local_handoff_started", probeStarted, "local_handoff_before_pause");
      this.select(route, "p2p", candidate);
      await this.selectionComplete(route);
      if (!this.current(route, generation)) return;
      await this.refreshSwitchCandidate(route, candidate);
      if (!this.current(route, generation)) return;
      this.reportHandoff("local_handoff_completed", handoffStarted, "local_handoff_before_pause");
      route.pauseAttempted = true;
      const request = this.request(route, false);
      const started = this.clock.now();
      const ack = await this.forwardingRequest(route, request, this.options.switchTimeoutMs);
      if (!this.current(route, generation)) return;
      this.validateAck(request, ack, started);
      this.setPause(route, started + ack.leaseRemainingMs);
      // ACK may arrive long after the admission snapshot. Refresh the exact
      // track/path proof instead of rejecting still-playing audio by its age.
      await this.refreshSwitchCandidate(route, candidate);
      if (!this.current(route, generation)) return;
      route.state.status = "p2p"; route.state.reason = null; route.reprobeAttempt = 0; route.restoreAttempts = 0;
      this.emit(); this.renew(route); this.monitorPeer(route);
    } catch (error) {
      if (this.current(route, generation)) await this.fallback(route.participant.participantId,
        diagnostic(error, "probe_failed"));
      else if (leased && leased !== route.lease) this.release(leased);
    } finally {
      if (leased && leased !== route.lease) this.release(leased);
    }
  }

  private async refreshSwitchCandidate(route: Route, selected: HybridMediaCandidate): Promise<void> {
    if (!route.peer) throw new Error("peer_path_unavailable");
    const fresh = await this.bounded(route, route.peer.waitForMedia(), this.options.switchTimeoutMs);
    if (fresh.track !== selected.track || !this.validMedia(fresh) || !this.receiving(route, fresh)) {
      throw new Error("media_stale_before_switch");
    }
    const admission = this.pathAdmission(fresh);
    if (!admission || admission.key !== route.pathKey) throw new Error("peer_path_not_admitted");
    route.candidate = fresh;
  }

  private async selectionComplete(route: Route): Promise<void> {
    if (route.port.waitForSelection) await this.bounded(route,
      route.port.waitForSelection(route.state.selectionRevision), this.options.switchTimeoutMs);
  }

  private request(route: Route, enabled: boolean): HybridForwardingRequest {
    return { scope: { ...route.scope }, pairConnectionId: route.lease?.connectionId ?? null,
      sourceParticipantId: route.participant.participantId,
      sourceSessionId: route.participant.sessionId, sourcePublicationId: route.participant.publicationId,
      destinationSessionId: route.scope.localSessionId, routeGeneration: route.generation,
      operationId: `${route.generation}:${++this.operations}`, enabled, pauseLeaseMs: enabled ? 0 : this.options.pauseLeaseMs };
  }

  private validateAck(request: HybridForwardingRequest, ack: HybridForwardingAck, started: number): void {
    if (!ack || !sameScope(request.scope, ack.scope) || request.pairConnectionId !== ack.pairConnectionId ||
      request.sourceParticipantId !== ack.sourceParticipantId ||
      request.sourceSessionId !== ack.sourceSessionId || request.sourcePublicationId !== ack.sourcePublicationId ||
      request.destinationSessionId !== ack.destinationSessionId || request.routeGeneration !== ack.routeGeneration ||
      request.operationId !== ack.operationId || request.enabled !== ack.enabled || request.pauseLeaseMs !== ack.pauseLeaseMs ||
      ack.applied !== true || !finite(ack.leaseRemainingMs) || (!request.enabled &&
        (ack.leaseRemainingMs > request.pauseLeaseMs || started + ack.leaseRemainingMs <= this.clock.now()))) {
      this.reportForwarding(request, "failed", "forwarding_ack_mismatch", started);
      throw new Error("forwarding_ack_mismatch");
    }
    this.reportForwarding(request, "acknowledged", "validated_ack", started);
  }

  private elapsed(started: number): number { return Math.min(60000, Math.max(0, Math.round(this.clock.now() - started))); }

  private reportHandoff(stage: Extract<BrowserHybridDiagnostic, { kind: "handoff" }>["stage"], started: number,
    reason: Extract<BrowserHybridDiagnostic, { kind: "handoff" }>["reason"]): void {
    try { this.dependencies.onDiagnostic?.({ kind: "handoff", stage, elapsedMs: this.elapsed(started), reason }); }
    catch { /* Observers do not own playback. */ }
  }

  private reportForwarding(request: HybridForwardingRequest, result: "acknowledged" | "failed", reason: "validated_ack" | "request_failed" | "forwarding_ack_mismatch", started: number,
    failureReason?: Extract<BrowserHybridDiagnostic, { kind: "forwarding" }>["failureReason"]): void {
    const event: BrowserHybridDiagnostic = { kind: "forwarding", action: request.enabled ? "restore" : "pause", result, reason, elapsedMs: this.elapsed(started),
      ...(failureReason ? { failureReason } : {}) };
    try { this.dependencies.onDiagnostic?.(event); } catch { /* Observers do not own forwarding. */ }
  }
  private async forwardingRequest(route: Route, request: HybridForwardingRequest, timeout: number): Promise<HybridForwardingAck> {
    const started = this.clock.now();
    try {
      return await this.bounded(route, Promise.resolve().then(() => this.dependencies.authority!.setForwarding(request)), timeout);
    } catch (error) {
      this.reportForwarding(request, "failed", "request_failed", started, hybridProtocolFailure(error));
      throw error;
    }
  }

  private select(route: Route, kind: "sfu" | "p2p" | "none", candidate?: HybridMediaCandidate): void {
    const revision = this.selections = Math.max(this.selections + 1, (route.port.getSelectionRevision?.() ?? -1) + 1);
    try { route.port.select(kind, candidate, revision); }
    catch (error) {
      try {
        const cleanupRevision = this.selections = Math.max(this.selections + 1, (route.port.getSelectionRevision?.() ?? -1) + 1);
        route.port.select("none", undefined, cleanupRevision);
        route.state.selected = "none"; route.state.selectedTrackId = null; route.state.selectionRevision = cleanupRevision;
      } catch { /* Do not report a disconnect that the adapter could not confirm. */ }
      throw error;
    }
    route.state.selected = kind; route.state.selectedTrackId = candidate?.track.id ?? null;
    route.state.selectionRevision = revision;
  }

  fallback(participantId: string, reason = "fallback_requested"): Promise<void> {
    const route = this.routes.get(participantId);
    if (!route || !this.current(route)) return Promise.resolve();
    if (route.reprobe !== undefined) { this.clock.cancel(route.reprobe); route.reprobe = undefined; }
    if (route.restoreRetry !== undefined) { this.clock.cancel(route.restoreRetry); route.restoreRetry = undefined; }
    if (route.recovery) return route.recovery;
    const promise = this.recoverRoute(route, reason);
    route.recovery = promise;
    void promise.finally(() => { if (route.recovery === promise) route.recovery = undefined; }).catch(() => undefined);
    return promise;
  }

  private monitorPeer(route: Route): void {
    if (route.pathMonitor !== undefined) this.clock.cancel(route.pathMonitor);
    const generation = route.generation;
    route.pathMonitor = this.clock.schedule(() => {
      route.pathMonitor = undefined;
      void this.checkPeerPath(route, generation);
    }, this.options.pathMonitorMs);
  }

  private async checkPeerPath(route: Route, generation: number): Promise<void> {
    if (!this.current(route, generation) || route.state.status !== "p2p" || !route.peer) return;
    let candidate = route.candidate;
    try { candidate = await this.bounded(route, route.peer.waitForMedia(HYBRID_MEDIA_HEALTH_MAX_AGE_MS), this.options.pathMonitorMs); }
    catch {
      if (this.current(route, generation)) void this.fallback(route.participant.participantId, "p2p_media_lost");
      return;
    }
    if (!this.current(route, generation) || route.state.status !== "p2p") return;
    route.candidate = candidate;
    const admission = candidate && this.pathAdmission(candidate);
      if (!candidate || !admission || !this.mediaHealthy(route, candidate)) {
        void this.fallback(route.participant.participantId,
          !admission ? "peer_path_changed" : "p2p_media_lost");
        return;
      }
    route.pathKey = admission.key; route.pathSince = this.clock.now(); this.emit(); this.monitorPeer(route);
  }

  private scheduleReprobe(route: Route): void {
    if (this.disposed || this.stopping || route.reprobe !== undefined) return;
    const delay = reprobeDelaysMs[Math.min(route.reprobeAttempt, reprobeDelaysMs.length - 1)];
    route.reprobeAttempt = Math.min(route.reprobeAttempt + 1, reprobeDelaysMs.length - 1);
    route.reprobe = this.clock.schedule(() => {
      route.reprobe = undefined;
      if (!this.current(route) || route.state.status !== "sfu") return;
      // Temporary budget closure reschedules the pending retry rather than
      // consuming it and stranding an otherwise healthy SFU route.
      if (!this.admission) { this.scheduleReprobe(route); return; }
      route.state.status = "queued"; route.state.reason = null; this.emit(); this.pump();
    }, delay);
  }

  private scheduleRestoreRetry(route: Route): void {
    if (this.disposed || this.stopping || route.restoreRetry !== undefined) return;
    const attempt = route.restoreAttempts + 1;
    const delay = attempt >= 5 ? restoreCooldownMs : restoreRetryDelaysMs[attempt - 1];
    route.restoreAttempts = attempt >= 5 ? 0 : attempt;
    route.restoreRetry = this.clock.schedule(() => {
      route.restoreRetry = undefined;
      if (!this.current(route)) return;
      void this.fallback(route.participant.participantId, "sfu_restore_retry");
    }, delay);
  }

  private async recoverRoute(route: Route, reason: string): Promise<void> {
    const recoveryStarted = this.clock.now();
    this.cancel(route); route.generation = ++this.generations; route.state.routeGeneration = route.generation;
    const generation = route.generation;
    const shouldReprobe = !!route.peer || route.pauseAttempted || route.state.status === "probing" || route.state.status === "switching";
    const needsRestore = route.pauseAttempted || route.state.selected !== "sfu";
    route.state.reason = reason; route.state.status = "recovering";
    const healthy = route.state.selected === "p2p" && this.receiving(route);
    if (route.state.selected === "p2p" && !healthy) {
      try { this.select(route, "none"); } catch { route.state.reason = "receive_selection_failed"; }
    }
    this.emit();
    try {
      if (needsRestore) {
        const after = route.port.getSfuMediaSequence();
        if (!Number.isSafeInteger(after) || after < 0) throw new Error("invalid_sfu_media_sequence");
        const request = this.request(route, true); const started = this.clock.now();
        const ack = await this.forwardingRequest(route, request, this.options.switchTimeoutMs);
        if (!this.current(route, generation)) return;
        this.validateAck(request, ack, started); this.setPause(route, 0);
        const media = await this.bounded(route, route.port.waitForSfuMedia(after), this.options.switchTimeoutMs);
        if (!this.current(route, generation)) return;
        if (!this.validMedia(media) || media.mediaSequence <= after) throw new Error("fresh_sfu_media_unavailable");
        this.select(route, "sfu", media);
        await this.selectionComplete(route);
        if (!this.current(route, generation)) return;
      }
      this.closePeer(route); route.state.status = "sfu"; route.pauseAttempted = false; route.restoreAttempts = 0;
      this.reportHandoff("sfu_restore_completed", recoveryStarted, "fresh_sfu_restored");
      this.restorePorts.delete(route.port); this.emit(); if (shouldReprobe) this.scheduleReprobe(route);
    } catch (error) {
      if (!this.current(route, generation)) return;
      route.state.status = "recovering"; route.state.reason = diagnostic(error, "restore_failed");
      this.reportHandoff("recovery_failed", recoveryStarted, "restore_failed");
      if (route.state.selected !== "p2p" || !healthy || !this.receiving(route)) {
        if (route.state.selected === "p2p") {
          try { this.select(route, "none"); } catch { route.state.reason = "receive_selection_failed"; }
        }
        this.closePeer(route);
      }
      this.emit(); this.scheduleRestoreRetry(route);
    }
  }

  private renew(route: Route): void {
    const generation = route.generation;
    const delay = Math.min(this.options.leaseRenewMs, Math.max(1, (route.pauseUntil - this.clock.now()) / 3));
    route.renew = this.clock.schedule(() => {
      route.renew = undefined;
      if (!this.current(route, generation) || route.state.status !== "p2p") return;
      if (!this.receiving(route)) { void this.fallback(route.participant.participantId, "p2p_media_lost"); return; }
      const request = this.request(route, false); const started = this.clock.now();
      void this.forwardingRequest(route, request,
        Math.min(this.options.switchTimeoutMs, Math.max(1, route.pauseUntil - started))).then(ack => {
        if (!this.current(route, generation)) return;
        this.validateAck(request, ack, started); this.setPause(route, started + ack.leaseRemainingMs);
        this.emit(); this.renew(route);
      }).catch(error => {
        if (this.current(route, generation)) void this.fallback(route.participant.participantId,
          diagnostic(error, "lease_renew_failed"));
      });
    }, delay);
  }

  private setPause(route: Route, until: number): void {
    if (route.expiry !== undefined) this.clock.cancel(route.expiry);
    route.expiry = undefined; route.pauseUntil = until;
    if (until <= this.clock.now()) return;
    route.expiry = this.clock.schedule(() => {
      route.expiry = undefined;
      if (this.routes.get(route.participant.participantId) !== route || route.pauseUntil !== until) return;
      this.emit();
      if (route.state.status === "p2p" && this.current(route)) void this.fallback(route.participant.participantId, "pause_lease_expired");
    }, until - this.clock.now());
  }

  private sendSignal(route: Route, generation: number, body: HybridSignalBody): void {
    if (!this.current(route, generation) || !route.lease || !validSignal(body) || !this.signalRole(route, body, false) || route.pendingOut >= 64) {
      this.rejectedSignals++; this.emit(); return;
    }
    const signal: HybridSignal = {
      serverInstanceId: route.scope.serverInstanceId, roomId: route.scope.roomId, roomGeneration: route.scope.roomGeneration,
      sourceSessionId: route.scope.localSessionId, destinationSessionId: route.participant.sessionId,
      connectionId: route.lease.connectionId, sequence: ++route.signalOut, body: copySignalBody(body),
    };
    route.pendingOut++;
    route.outbound = route.outbound.then(() => this.current(route, generation) ?
      this.bounded(route, this.dependencies.authority!.relay(signal), this.options.probeTimeoutMs) : undefined).catch(() => {
      if (this.current(route, generation)) void this.fallback(route.participant.participantId, "signal_relay_failed");
    }).finally(() => { route.pendingOut--; });
  }

  private onSignal(signal: HybridSignal): void {
    if (!signal || typeof signal !== "object") { this.rejectedSignals++; this.emit(); return; }
    const route = [...this.routes.values()].find(value => value.lease?.connectionId === signal.connectionId);
    if (!route || !this.current(route) || !route.peer || signal.serverInstanceId !== route.scope.serverInstanceId ||
      signal.roomId !== route.scope.roomId || signal.roomGeneration !== route.scope.roomGeneration ||
      signal.sourceSessionId !== route.participant.sessionId || signal.destinationSessionId !== route.scope.localSessionId ||
      !Number.isSafeInteger(signal.sequence) || signal.sequence <= route.signalIn || !validSignal(signal.body) ||
      !this.signalRole(route, signal.body, true) || route.pendingIn >= 64) {
      this.rejectedSignals++; this.emit(); return;
    }
    route.signalIn = signal.sequence;
    const generation = route.generation;
    const body = copySignalBody(signal.body);
    route.pendingIn++;
    route.inbound = route.inbound.then(() => this.current(route, generation) && route.peer ?
      this.bounded(route, route.peer.acceptSignal(body), this.options.probeTimeoutMs) : undefined).catch(() => {
      if (this.current(route, generation)) void this.fallback(route.participant.participantId, "signal_accept_failed");
    }).finally(() => { route.pendingIn--; });
  }

  private signalRole(route: Route, body: HybridSignalBody, incoming: boolean): boolean {
    if (body.kind === "candidate") return true;
    return body.kind === "offer" ? incoming !== route.lease?.initiator : incoming === route.lease?.initiator;
  }

  private cancel(route: Route): void {
    if (route.renew !== undefined) this.clock.cancel(route.renew);
    route.renew = undefined;
    if (route.pathMonitor !== undefined) this.clock.cancel(route.pathMonitor);
    route.pathMonitor = undefined;
    if (route.reprobe !== undefined) this.clock.cancel(route.reprobe);
    route.reprobe = undefined;
    if (route.restoreRetry !== undefined) this.clock.cancel(route.restoreRetry);
    route.restoreRetry = undefined;
    for (const cancel of [...route.cancellations]) cancel();
  }

  private release(lease: HybridPairLease): void {
    if (this.releasedLeases.has(lease)) return;
    this.releasedLeases.add(lease);
    try { Promise.resolve(this.dependencies.authority!.releasePair(lease)).catch(() => undefined); } catch { /* Server lease also expires. */ }
  }

  private closePeer(route: Route): void {
    this.setPause(route, 0);
    if (route.peer) { this.previousMetrics.delete(route.peer); try { route.peer.dispose(); } catch { /* Continue cleanup. */ } }
    route.peer = undefined;
    route.candidate = undefined; route.pathKey = undefined; route.pathSince = undefined;
    if (route.lease) this.release(route.lease);
    route.lease = undefined;
  }

  private retire(route: Route, reason: string): void {
    this.cancel(route); route.generation = ++this.generations;
    route.state.reason = reason;
    if (route.state.selected !== "sfu" || route.pauseAttempted) {
      this.restorePorts.add(route.port);
      try { this.select(route, "none"); } catch { /* A replaced physical port cannot be reconnected. */ }
    }
    if (route.pauseAttempted) {
      try { this.dependencies.rememberRetiredSfu?.(this.request(route, true), route.port); }
      catch { /* A host may reject a retired physical source. */ }
      try { void this.dependencies.authority!.setForwarding(this.request(route, true)).catch(() => undefined); }
      catch { /* Independent server pause lease must restore forwarding. */ }
      if (!this.disposed && route.port.isCurrent()) {
        try { this.dependencies.recoverRetiredSfu?.(this.request(route, true), route.port, route.state.selectionRevision); }
        catch { /* Input stays closed until the host can verify restoration. */ }
      }
    }
    this.closePeer(route);
  }

  private invalidate(reason: string): void {
    if (this.pumpTimer !== undefined) this.clock.cancel(this.pumpTimer);
    this.pumpTimer = undefined;
    for (const route of this.routes.values()) this.retire(route, reason);
    this.routes.clear(); this.scope = null; this.stateReason = reason; this.emit();
  }

  async sampleMetrics(): Promise<HybridMetrics> {
    if (this.metricsFlight) return this.metricsFlight;
    if (this.metricsCached && this.clock.now() - this.metricsAt < 1000) return this.metricsCached;
    this.metricsAt = this.clock.now();
    this.metricsFlight = this.collectMetrics().then(metrics => { this.metricsCached = metrics; return metrics; })
      .finally(() => { this.metricsFlight = null; });
    return this.metricsFlight;
  }

  /** Orderly disable: retain one input until fresh SFU restoration succeeds; false needs caller attention. */
  restoreSfuAndDispose(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(true);
    if (this.stopFlight) return this.stopFlight;
    this.stopping = true; this.admission = false;
    this.stopFlight = (async () => {
      for (const route of [...this.routes.values()]) await this.fallback(route.participant.participantId, "controller_stopping");
      const restored = [...this.routes.values()].every(route => route.state.selected === "sfu" && !route.peer && !route.pauseAttempted);
      if (restored) this.dispose();
      else { this.stateReason = "sfu_restore_incomplete"; this.emit(); }
      this.stopFlight = null;
      return restored;
    })();
    return this.stopFlight;
  }

  private async collectMetrics(): Promise<HybridMetrics> {
    const peers = [...this.routes.values()].filter(route => route.peer);
    const measured: HybridPeerMetrics[] = [];
    const rates: number[][] = [[], [], [], []];
    for (const route of peers) {
      const peer = route.peer!;
      try {
        const value = await this.bounded(route, peer.readMetrics(), 1000);
        if (![...this.routes.values()].some(route => route.peer === peer) || !finite(value.observedAtMs) ||
          !finite(value.packetsSent) || !finite(value.payloadBytesSent) ||
          (value.headerBytesSent !== null && !finite(value.headerBytesSent)) ||
          (value.totalEncodeTimeSeconds !== null && !finite(value.totalEncodeTimeSeconds)) ||
          value.source !== (this.dependencies.authority?.environment === "simulation" ? "simulation" : "rtc-stats")) continue;
        measured.push({ ...value });
        const previous = this.previousMetrics.get(peer);
        if (previous && value.observedAtMs <= previous.observedAtMs) continue;
        this.previousMetrics.set(peer, { ...value });
        if (!previous) continue;
        const seconds = (value.observedAtMs - previous.observedAtMs) / 1000;
        const delta = (next: number | null, before: number | null, index: number, scale: number) => {
          if (next !== null && before !== null && next >= before) rates[index].push((next - before) * scale / seconds);
        };
        delta(value.payloadBytesSent, previous.payloadBytesSent, 0, 8);
        delta(value.headerBytesSent, previous.headerBytesSent, 1, 8);
        delta(value.packetsSent, previous.packetsSent, 2, 1);
        delta(value.totalEncodeTimeSeconds, previous.totalEncodeTimeSeconds, 3, 1);
      } catch { /* Missing stats remain unknown. */ }
    }
    const sum = (index: number) => rates[index].length ? rates[index].reduce((a, b) => a + b, 0) : null;
    return { environment: this.dependencies.authority?.environment ?? "unavailable", peerConnections: peers.length,
      reportingPeers: measured.length, complete: peers.length > 0 && rates.every(values => values.length === peers.length),
      knownPayloadUplinkBps: sum(0), knownHeaderUplinkBps: sum(1), knownPacketsPerSecond: sum(2),
      knownEncoderCpuSecondsPerSecond: sum(3), measuredPeers: measured };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.invalidate("disposed");
    for (const cleanup of this.cleanups) { try { cleanup(); } catch { /* Continue cleanup. */ } }
    this.cleanups = []; this.listeners.clear(); this.previousMetrics.clear();
  }
}
