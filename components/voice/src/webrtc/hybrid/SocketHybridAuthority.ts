import type { HybridAuthority, HybridForwardingAck, HybridForwardingRequest, HybridPairLease, HybridParticipant, HybridScope, HybridSignal } from "../types/Hybrid";

export interface HybridSocketTransport {
  id?: string;
  connected: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
  timeout(ms: number): { emitWithAck(event: string, payload: unknown): Promise<unknown> };
}
export interface HybridAuthorizedSnapshot { scope: HybridScope; participants: readonly HybridParticipant[] }
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const sameScope = (a: HybridScope, b: HybridScope) => a.serverInstanceId === b.serverInstanceId && a.roomId === b.roomId &&
  a.roomGeneration === b.roomGeneration && a.localParticipantId === b.localParticipantId && a.localSessionId === b.localSessionId &&
  a.canPublish === b.canPublish && a.canReceive === b.canReceive;
const sameBinding = (a: HybridScope, b: HybridScope) => a.serverInstanceId === b.serverInstanceId && a.roomId === b.roomId &&
  a.roomGeneration === b.roomGeneration && a.localParticipantId === b.localParticipantId && a.localSessionId === b.localSessionId;
function validScope(value: unknown): value is HybridScope {
  return object(value) && [value.serverInstanceId, value.roomId, value.roomGeneration, value.localParticipantId, value.localSessionId].every(text) &&
    typeof value.canPublish === "boolean" && typeof value.canReceive === "boolean";
}
function validParticipant(value: unknown): value is HybridParticipant {
  return object(value) && [value.participantId, value.sessionId, value.publicationId].every(text) &&
    typeof value.canSendAudio === "boolean" && typeof value.canReceiveAudio === "boolean";
}
/** Reuses the host's authenticated socket; never creates a second auth connection. */
export class SocketHybridAuthority implements HybridAuthority {
  readonly environment = "network" as const;
  capabilities: HybridAuthority["capabilities"] = null;
  private snapshot?: HybridAuthorizedSnapshot;
  private disposed = false;
  private generation = 0;
  private refreshing = 0;
  private signals = new Set<(signal: HybridSignal) => void>();
  private invalidations = new Set<() => void>();
  private pairInvalidations = new Set<(connectionId: string) => void>();
  private leases = new Set<string>();
  private retiredPairs = new Set<string>();
  private restoredPairs = new Map<string, HybridScope>();
  private releasedPairs = new Map<string, HybridScope>();
  private pendingReleases = new Map<string, HybridPairLease>();
  private releaseFlights = new Map<string, { generation: number; promise: Promise<void> }>();
  private pending = new Map<string, HybridSignal[]>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  constructor(private readonly socket: HybridSocketTransport, private readonly getAccessToken: () => string | undefined) {
    socket.on("voice:hybrid:signal", this.incoming);
    socket.on("voice:hybrid:pair-invalidated", this.pairInvalidated);
    socket.on("disconnect", this.invalidate);
    socket.on("token:revoked", this.invalidate);
    socket.on("voice:room:leave", this.invalidate);
    socket.on("voice:move:committed", this.invalidate);
  }
  private invalidate = (): void => {
    ++this.generation; ++this.refreshing; this.snapshot = undefined; this.capabilities = null;
    this.pending.clear(); this.leases.clear(); this.retiredPairs.clear();
    this.releaseFlights.clear();
    for (const timer of this.timers) clearTimeout(timer); this.timers.clear();
    for (const listener of this.invalidations) { try { listener(); } catch {} }
  };
  private async request(event: string, payload: object): Promise<Record<string, any>> {
    const session = this.socket.id, generation = this.generation, token = this.getAccessToken();
    if (this.disposed || !this.socket.connected || !text(session) || typeof token !== "string" || token.length === 0) throw new Error("hybrid_unauthenticated");
    const response = await this.socket.timeout(5000).emitWithAck(event, { ...payload, accessToken: token });
    if (this.disposed || !this.socket.connected || this.socket.id !== session || this.generation !== generation) throw new Error("hybrid_scope_stale");
    if (!object(response) || response.v !== 1 || response.status === "failed") throw new Error(object(response) &&
      typeof response.error === "string" && /^hybrid_[a-z_]+$/.test(response.error) ? response.error : "hybrid_authority_failed");
    return response;
  }
  /** Complete before constructing an enabled controller. A probe failure stays unsupported. */
  async refresh(): Promise<HybridAuthorizedSnapshot> {
    const revision = ++this.refreshing;
    try {
      const response = await this.request("voice:hybrid:scope", {});
      const capabilities = response.capabilities;
      if (revision !== this.refreshing || response.status !== "supported" || !validScope(response.scope) || response.scope.localSessionId !== this.socket.id ||
          !object(capabilities) || capabilities.protocolVersion !== 1 || capabilities.authenticatedRoomSignals !== true || capabilities.pairForwardingLeases !== true ||
          !Array.isArray(response.participants) || response.participants.length > 128 || !response.participants.every(validParticipant)) throw new Error("hybrid_protocol_invalid");
      for (const field of ["participantId", "sessionId", "publicationId"] as const) if (new Set(response.participants.map(p => p[field])).size !== response.participants.length) throw new Error("hybrid_protocol_invalid");
      if (this.snapshot && !sameScope(this.snapshot.scope, response.scope)) this.invalidate();
      this.capabilities = { protocolVersion: 1, authenticatedRoomSignals: true, pairForwardingLeases: true };
      this.snapshot = { scope: structuredClone(response.scope), participants: structuredClone(response.participants) };
      for (const [id, scope] of this.restoredPairs) if (!sameBinding(scope, response.scope)) this.restoredPairs.delete(id);
      for (const [id, scope] of this.releasedPairs) if (!sameBinding(scope, response.scope)) this.releasedPairs.delete(id);
      await this.flushReleases(this.snapshot.scope);
      if (!this.isCurrent(response.scope)) throw new Error("hybrid_scope_stale");
      return structuredClone(this.snapshot);
    } catch (error) { if (revision === this.refreshing) this.invalidate(); throw error; }
  }
  isCurrent(scope: HybridScope): boolean {
    return !this.disposed && this.socket.connected && this.socket.id === scope.localSessionId && !!this.snapshot &&
      this.capabilities !== null && sameScope(this.snapshot.scope, scope);
  }
  async leasePair(scope: HybridScope, participant: HybridParticipant): Promise<HybridPairLease> {
    if (!this.isCurrent(scope)) throw new Error("hybrid_scope_stale");
    const response = await this.request("voice:hybrid:lease", { scope, participant }); const lease = response.lease;
    if (!this.isCurrent(scope) || response.status !== "leased" || !object(lease) || !text(lease.connectionId) ||
      !validScope(lease.scope) || !sameScope(lease.scope, scope) || lease.remoteSessionId !== participant.sessionId ||
      typeof lease.initiator !== "boolean" || this.retiredPairs.has(lease.connectionId)) throw new Error("hybrid_pair_stale");
    this.leases.add(lease.connectionId);
    // The controller consumes the resolved lease before the next task delivers queued ICE/SDP.
    const timer = setTimeout(() => {
      this.timers.delete(timer); const signals = this.pending.get(lease.connectionId); this.pending.delete(lease.connectionId);
      if (this.isCurrent(scope) && this.leases.has(lease.connectionId)) for (const signal of signals ?? []) this.deliver(signal);
    }, 0); this.timers.add(timer);
    return structuredClone(lease) as HybridPairLease;
  }
  async relay(signal: HybridSignal): Promise<void> {
    if (!this.snapshot || !this.isCurrent(this.snapshot.scope) || !this.leases.has(signal.connectionId)) throw new Error("hybrid_pair_stale");
    const response = await this.request("voice:hybrid:signal", { signal }); if (response.status !== "relayed") throw new Error("hybrid_signal_refused");
  }
  async setForwarding(request: HybridForwardingRequest): Promise<HybridForwardingAck> {
    if (!this.isCurrent(request.scope)) throw new Error("hybrid_scope_stale");
    const response = await this.request("voice:hybrid:forwarding", { request });
    if (!this.isCurrent(request.scope) || response.status !== "applied" || !object(response.ack)) throw new Error("hybrid_sfu_ack_failed");
    return structuredClone(response.ack) as HybridForwardingAck;
  }
  /** Reauthenticate recovery; lost publish permission does not revoke a still-authorized SFU receive route. */
  async restoreForwarding(request: HybridForwardingRequest): Promise<void> {
    if (!request.enabled || request.pauseLeaseMs !== 0) throw new Error("hybrid_restore_required");
    const { scope } = await this.refresh(), prior = request.scope;
    if (!scope.canReceive || scope.serverInstanceId !== prior.serverInstanceId || scope.roomId !== prior.roomId ||
      scope.roomGeneration !== prior.roomGeneration || scope.localParticipantId !== prior.localParticipantId ||
      scope.localSessionId !== prior.localSessionId) throw new Error("hybrid_scope_stale");
    let current = { ...request, scope }, ack: HybridForwardingAck;
    try { ack = await this.setForwarding(current); }
    catch (error) {
      // An expired old pair may use guarded unbound restoration; a different active pair still conflicts.
      if (!request.pairConnectionId || !(error instanceof Error) || error.message !== "hybrid_pair_stale") throw error;
      current = { ...current, pairConnectionId: null }; ack = await this.setForwarding(current);
    }
    if (!ack || ack.applied !== true || ack.leaseRemainingMs !== 0 ||
      Object.entries(current).some(([key, value]) => JSON.stringify(ack[key as keyof HybridForwardingAck]) !== JSON.stringify(value))) {
      throw new Error("hybrid_sfu_ack_failed");
    }
    if (request.pairConnectionId) {
      if (!this.restoredPairs.has(request.pairConnectionId) && this.restoredPairs.size >= 19) throw new Error("hybrid_restore_capacity");
      this.restoredPairs.set(request.pairConnectionId, { ...scope });
    }
  }
  /** Idempotent retirement of a restored old pair; never relax another pair's forwarding ownership. */
  async retireRestoredPair(request: HybridForwardingRequest): Promise<void> {
    const connectionId = request.pairConnectionId;
    if (connectionId === null) return;
    const scope = this.snapshot?.scope, restored = this.restoredPairs.get(connectionId), released = this.releasedPairs.get(connectionId);
    if (!scope || !this.isCurrent(scope) || !sameBinding(scope, request.scope) || !scope.canReceive) throw new Error("hybrid_scope_stale");
    if (released && sameBinding(released, scope)) { this.restoredPairs.delete(connectionId); return; }
    if (!restored || !sameBinding(restored, scope)) throw new Error("hybrid_restore_required");
    await this.releaseOnce(connectionId, { connectionId, scope, remoteSessionId: request.sourceSessionId }, scope);
    if (!this.isCurrent(scope)) throw new Error("hybrid_scope_stale");
    if (this.retiredPairs.size >= 512) { this.invalidate(); throw new Error("hybrid_scope_stale"); }
    this.leases.delete(connectionId); this.pending.delete(connectionId); this.retiredPairs.add(connectionId);
    this.restoredPairs.delete(connectionId); this.rememberRelease(connectionId, scope);
  }
  async releasePair(lease: HybridPairLease): Promise<void> {
    this.leases.delete(lease.connectionId); this.pending.delete(lease.connectionId);
    if (this.disposed) return;
    const released = this.releasedPairs.get(lease.connectionId);
    if (released && sameBinding(released, lease.scope)) return;
    if (!this.pendingReleases.has(lease.connectionId) && this.pendingReleases.size >= 19) throw new Error("hybrid_release_capacity");
    if (!this.pendingReleases.has(lease.connectionId)) this.pendingReleases.set(lease.connectionId, structuredClone(lease));
    const scope = this.snapshot?.scope;
    if (scope && sameBinding(scope, lease.scope) && this.isCurrent(scope)) await this.flushReleases(scope);
  }
  private rememberRelease(connectionId: string, scope: HybridScope): void {
    if (!this.releasedPairs.has(connectionId) && this.releasedPairs.size >= 19) this.releasedPairs.delete(this.releasedPairs.keys().next().value!);
    this.releasedPairs.set(connectionId, { ...scope });
  }
  private async flushReleases(scope: HybridScope): Promise<void> {
    for (const [connectionId, lease] of this.pendingReleases) {
      if (!sameBinding(scope, lease.scope)) { this.pendingReleases.delete(connectionId); continue; }
      if (!this.isCurrent(scope)) throw new Error("hybrid_scope_stale");
      await this.releaseOnce(connectionId, lease, scope);
      if (!this.isCurrent(scope)) throw new Error("hybrid_scope_stale");
      if (this.pendingReleases.get(connectionId) === lease) this.pendingReleases.delete(connectionId);
      if (!this.retiredPairs.has(connectionId) && this.retiredPairs.size >= 512) { this.invalidate(); throw new Error("hybrid_scope_stale"); }
      this.retiredPairs.add(connectionId);
      this.rememberRelease(connectionId, scope);
    }
  }
  private releaseOnce(connectionId: string,
    lease: Pick<HybridPairLease, "connectionId" | "scope" | "remoteSessionId">, scope: HybridScope): Promise<void> {
    const prior = this.releaseFlights.get(connectionId);
    if (prior?.generation === this.generation) return prior.promise;
    const flight = { generation: this.generation, promise: Promise.resolve() };
    flight.promise = (async () => {
      try {
        const response = await this.request("voice:hybrid:release", { lease: { ...lease, scope } });
        if (response.status !== "released") throw new Error("hybrid_release_failed");
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "hybrid_pair_stale" || !this.isCurrent(scope)) throw error;
      }
    })().finally(() => { if (this.releaseFlights.get(connectionId) === flight) this.releaseFlights.delete(connectionId); });
    this.releaseFlights.set(connectionId, flight); return flight.promise;
  }
  private incoming = (value: unknown): void => {
    if (!object(value) || !text(value.connectionId) || !this.snapshot || !this.isCurrent(this.snapshot.scope)) return;
    const scope = this.snapshot.scope;
    if (value.serverInstanceId !== scope.serverInstanceId || value.roomId !== scope.roomId || value.roomGeneration !== scope.roomGeneration ||
      value.destinationSessionId !== scope.localSessionId || !this.snapshot.participants.some(p => p.sessionId === value.sourceSessionId) ||
      this.retiredPairs.has(value.connectionId) || !Number.isSafeInteger(value.sequence) || value.sequence <= 0 || !object(value.body)) return;
    let signal: HybridSignal;
    try { if (JSON.stringify(value.body).length > 70000) return; signal = structuredClone(value) as HybridSignal; } catch { return; }
    if (this.leases.has(value.connectionId)) this.deliver(signal);
    else { let pending = this.pending.get(value.connectionId);
      if (!pending) { if (this.pending.size >= 19) { this.invalidate(); return; } pending = []; this.pending.set(value.connectionId, pending); }
      if (pending.length >= 64) { this.invalidate(); return; } pending.push(signal); }
  };
  private deliver(signal: HybridSignal): void { for (const listener of this.signals) { try { listener(structuredClone(signal)); } catch {} } }
  private pairInvalidated = (value: unknown): void => {
    if (!object(value) || !text(value.connectionId)) return;
    if (this.retiredPairs.has(value.connectionId)) return;
    this.pending.delete(value.connectionId); this.leases.delete(value.connectionId);
    if (this.retiredPairs.size >= 512) { this.invalidate(); return; } this.retiredPairs.add(value.connectionId);
    for (const listener of this.pairInvalidations) { try { listener(value.connectionId); } catch {} }
  };
  subscribeSignals(listener: (signal: HybridSignal) => void): () => void { this.signals.add(listener); return () => { this.signals.delete(listener); }; }
  subscribeInvalidation(listener: () => void): () => void { this.invalidations.add(listener); return () => { this.invalidations.delete(listener); }; }
  subscribePairInvalidation(listener: (connectionId: string) => void): () => void { this.pairInvalidations.add(listener); return () => { this.pairInvalidations.delete(listener); }; }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.invalidate();
    this.socket.off("voice:hybrid:signal", this.incoming); this.socket.off("voice:hybrid:pair-invalidated", this.pairInvalidated);
    for (const event of ["disconnect", "token:revoked", "voice:room:leave", "voice:move:committed"]) this.socket.off(event, this.invalidate);
    this.signals.clear(); this.invalidations.clear(); this.pairInvalidations.clear(); this.pendingReleases.clear();
    this.restoredPairs.clear(); this.releasedPairs.clear(); this.releaseFlights.clear();
  }
}
