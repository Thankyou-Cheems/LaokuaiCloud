import type {
  HybridClock, HybridDependencies, HybridForwardingAck, HybridForwardingRequest,
  HybridMediaCandidate, HybridMetrics, HybridOptions, HybridPairLease, HybridParticipant,
  HybridPeerMetrics, HybridPeerSession, HybridPublication, HybridReceivePort, HybridRouteState,
  HybridScope, HybridSignal, HybridSignalBody, HybridState,
} from "../types/Hybrid";

interface Route {
  participant: HybridParticipant;
  scope: HybridScope;
  publication: HybridPublication;
  port: HybridReceivePort;
  state: HybridRouteState;
  peer?: HybridPeerSession;
  lease?: HybridPairLease;
  candidate?: HybridMediaCandidate;
  generation: number;
  signalIn: number;
  signalOut: number;
  outbound: Promise<void>;
  inbound: Promise<void>;
  pauseAttempted: boolean;
  pauseUntil: number;
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
  /^(operation_timeout|route_cancelled|invalid_pair_lease|decoded_media_unavailable|media_stale_before_switch|forwarding_ack_mismatch|fresh_sfu_media_unavailable|invalid_sfu_media_sequence|stale_receive_selection|invalid_receive_candidate|invalid_receive_node)$/.test(error.message)
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
      const restoring = this.restorePorts.has(port);
      const route: Route = {
        participant, scope: { ...scope }, publication: { ...publication! }, port, generation,
        signalIn: 0, signalOut: 0, outbound: Promise.resolve(), inbound: Promise.resolve(),
        pauseAttempted: restoring, pauseUntil: 0, cancellations: new Set(), pendingIn: 0, pendingOut: 0,
        state: { participantId: participant.participantId, sessionId: participant.sessionId,
          publicationId: participant.publicationId, routeGeneration: generation, selectionRevision: 0,
          status: restoring ? "sfu" : withinLimit ? "queued" : "sfu", selected: restoring ? "none" : "sfu", selectedTrackId: null,
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
      Number.isSafeInteger(candidate.mediaSequence) && candidate.mediaSequence > 0 && finite(age) && age <= 500;
  }

  private async probe(route: Route): Promise<void> {
    const generation = route.generation;
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
      const peer = this.dependencies.createPeer({
        lease: leased, publication: route.publication, participant: route.participant,
        onSignal: body => this.sendSignal(route, generation, body),
        onFailure: () => {
          if (this.routes.get(route.participant.participantId) !== route || route.peer !== peer) return;
          if (route.state.status === "recovering") {
            try { this.select(route, "none"); } catch { /* Keep disconnect failures observable. */ }
            this.closePeer(route); this.emit();
          } else if (this.current(route)) void this.fallback(route.participant.participantId, "peer_failed");
        },
      });
      route.peer = peer;
      const candidate = await this.bounded(route, peer.start().then(() => peer.waitForMedia()), this.options.probeTimeoutMs);
      if (!this.current(route, generation)) return;
      if (!this.validMedia(candidate) || !this.receiving(route, candidate)) throw new Error("decoded_media_unavailable");
      route.candidate = candidate; route.state.status = "switching"; route.pauseAttempted = true; this.emit();
      const request = this.request(route, false);
      const started = this.clock.now();
      const ack = await this.bounded(route, this.dependencies.authority!.setForwarding(request), this.options.switchTimeoutMs);
      if (!this.current(route, generation)) return;
      this.validateAck(request, ack, started);
      if (!this.validMedia(candidate) || !this.receiving(route, candidate)) throw new Error("media_stale_before_switch");
      this.setPause(route, started + ack.leaseRemainingMs);
      this.select(route, "p2p", candidate);
      route.state.status = "p2p"; route.state.reason = null; this.emit(); this.renew(route);
    } catch (error) {
      if (this.current(route, generation)) await this.fallback(route.participant.participantId,
        diagnostic(error, "probe_failed"));
      else if (leased && leased !== route.lease) this.release(leased);
    } finally {
      if (leased && leased !== route.lease) this.release(leased);
    }
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
      throw new Error("forwarding_ack_mismatch");
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
    if (route.recovery) return route.recovery;
    const promise = this.recoverRoute(route, reason);
    route.recovery = promise;
    void promise.finally(() => { if (route.recovery === promise) route.recovery = undefined; }).catch(() => undefined);
    return promise;
  }

  private async recoverRoute(route: Route, reason: string): Promise<void> {
    this.cancel(route); route.generation = ++this.generations; route.state.routeGeneration = route.generation;
    const generation = route.generation;
    route.state.reason = reason; route.state.status = "recovering";
    const healthy = route.state.selected === "p2p" && this.receiving(route);
    if (route.state.selected === "p2p" && !healthy) {
      try { this.select(route, "none"); } catch { route.state.reason = "receive_selection_failed"; }
    }
    this.emit();
    try {
      if (route.pauseAttempted) {
        const after = route.port.getSfuMediaSequence();
        if (!Number.isSafeInteger(after) || after < 0) throw new Error("invalid_sfu_media_sequence");
        const request = this.request(route, true); const started = this.clock.now();
        const ack = await this.bounded(route, this.dependencies.authority!.setForwarding(request), this.options.switchTimeoutMs);
        if (!this.current(route, generation)) return;
        this.validateAck(request, ack, started); this.setPause(route, 0);
        const media = await this.bounded(route, route.port.waitForSfuMedia(after), this.options.switchTimeoutMs);
        if (!this.current(route, generation)) return;
        if (!this.validMedia(media) || media.mediaSequence <= after) throw new Error("fresh_sfu_media_unavailable");
        this.select(route, "sfu", media);
      }
      this.closePeer(route); route.state.status = "sfu"; route.pauseAttempted = false;
      this.restorePorts.delete(route.port); this.emit();
    } catch (error) {
      if (!this.current(route, generation)) return;
      route.state.status = "failed"; route.state.reason = diagnostic(error, "restore_failed");
      if (route.state.selected !== "p2p" || !this.receiving(route)) {
        if (route.state.selected === "p2p") {
          try { this.select(route, "none"); } catch { route.state.reason = "receive_selection_failed"; }
        }
        this.closePeer(route);
      }
      this.emit();
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
      void this.bounded(route, Promise.resolve().then(() => this.dependencies.authority!.setForwarding(request)),
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
