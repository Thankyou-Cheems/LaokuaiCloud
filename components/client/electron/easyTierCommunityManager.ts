import type {
  EasyTierCommunityLease, EasyTierCommunityState, EasyTierReason,
} from "../src/lib/easyTierCommunity";
import type { OwnedCredentialObservation } from "./communityEtCredentialObservation";
import type { ApplyRelayBudget } from './communityRelayRuntime';
import { projectEasyTierMembers } from "./easyTierMemberAdapter";
import { type EasyTierStatusSample, projectEasyTierLocalDetails,projectEasyTierStatus } from "./easyTierStatus";

export interface EasyTierSession {
  instanceId: string;
  read(signal: AbortSignal): Promise<EasyTierStatusSample>;
  /** Idempotent; removes only this app's instance, never restarts a shared core. */
  close(): Promise<void>;
  readCredentialObservation?(signal: AbortSignal): Promise<OwnedCredentialObservation>;
  readCredentialSample?(signal: AbortSignal): Promise<{sample: EasyTierStatusSample; observation: OwnedCredentialObservation}>;
  applyRelayBudget?: ApplyRelayBudget;
}
export interface EasyTierRuntime {
  activationReason(): "activation-required" | "unsupported-target" | null;
  /** Readiness only, before credential mutation. Never opens a prompt inside a timed connect. */
  assertReady?(signal: AbortSignal): Promise<void>;
  connect(scope: { serverId: string; generation: number; signal: AbortSignal }): Promise<EasyTierSession>;
  /** Exact owned process handle only. Must be synchronous for Windows session end. */
  shutdownOwned(): void;
}
const observationReasons = ['cli-error', 'cli-timeout', 'parse-failed', 'invalid-owned-network-status',
  'credential-node-ip-mismatch', 'credential-node-key-conflict', 'issuer-connection-unverified', 'timeout', 'cancelled', 'other'] as const;
export type EasyTierObservationReason = typeof observationReasons[number];
export class EasyTierOperationError extends Error {
  constructor(public reason: Exclude<EasyTierReason, null>, readonly diagnosticReason: EasyTierObservationReason | null = null) { super(reason); }
}
export function easyTierObservationReason(error: unknown): EasyTierObservationReason {
  if (error instanceof EasyTierOperationError && error.diagnosticReason && observationReasons.includes(error.diagnosticReason)) return error.diagnosticReason;
  if (error instanceof EasyTierOperationError && error.reason === 'operation-timeout') return 'timeout';
  if (error instanceof Error && observationReasons.includes(error.message as EasyTierObservationReason)) return error.message as EasyTierObservationReason;
  return 'other';
}
/** An owned session retirement is separate from an ordinary telemetry failure. */
export class EasyTierSessionRetiredError extends EasyTierOperationError {}
export interface EasyTierManagerDiagnostic {
  event: 'state' | 'telemetry'; action: 'start' | 'finish'; generation: number;
  phase: EasyTierCommunityState['phase']; code: EasyTierReason | 'success';
  reason: EasyTierObservationReason | null;
}
interface Community {
  leases: Set<string>;
  state: EasyTierCommunityState;
  session: EasyTierSession | null;
  sample: EasyTierStatusSample | null;
  cancel: AbortController | null;
  tail: Promise<void>;
  operation: Promise<void>;
  refreshFlight: AbortController | null;
}
export function validEasyTierId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 &&
    !Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
}
export function validEasyTierLease(value: unknown): value is EasyTierCommunityLease {
  if (!value || typeof value !== "object") return false;
  const lease = value as EasyTierCommunityLease;
  return validEasyTierId(lease.serverId) && validEasyTierId(lease.leaseId);
}

/** No room, identity-store, SFU or native-driver dependencies. */
export class EasyTierCommunityManager {
  private communities = new Map<string, Community>();
  private enabled = false;
  private disposed = false;
  private membershipRevision = 0;
  constructor(private runtime: EasyTierRuntime | null, private emit: (state: EasyTierCommunityState) => void = () => undefined,
    private now = () => performance.now(), private timeoutMs = 8000, private maxAgeMs = 10_000, private unixNow = () => Date.now(),
    private diagnostic?: (event: EasyTierManagerDiagnostic) => void) {}
  private report(c: Community, event: EasyTierManagerDiagnostic['event'], action: 'start' | 'finish', reason: EasyTierObservationReason | null = null): void {
    const safeReasons: readonly EasyTierReason[] = ['activation-required', 'needs-permission', 'configuration-required', 'runtime-required', 'unsupported-target',
      'multi-community-unavailable', 'connect-failed', 'operation-timeout', 'cleanup-failed', 'status-unavailable', 'runtime-exited'];
    const code = c.state.reason === null ? 'success' : safeReasons.includes(c.state.reason) ? c.state.reason : 'status-unavailable';
    try { this.diagnostic?.({event, action, generation: c.state.generation, phase: c.state.phase, code, reason}); }
    catch { /* Observers never block lifecycle. */ }
  }

  private community(serverId: string): Community {
    if (!validEasyTierId(serverId)) throw new Error("invalid-community-id");
    let community = this.communities.get(serverId);
    if (!community) {
      community = { leases: new Set(), state: { serverId, generation: 0, phase: "disabled", reason: null, virtualIp: null, lanSnapshot: null },
        session: null, sample: null, cancel: null, tail: Promise.resolve(), operation: Promise.resolve(), refreshFlight: null };
      this.communities.set(serverId, community);
    }
    return community;
  }
  private publish(c: Community): void {
    this.report(c, 'state', 'finish');
    try { this.emit(this.getState(c.state.serverId)); } catch { /* Observers never block lifecycle. */ }
  }
  getState(serverId: string): EasyTierCommunityState {
    const c = this.community(serverId);
    const status = c.session && c.state.phase === "connected" ? projectEasyTierStatus(c.sample, {
      serverId, generation: c.state.generation, instanceId: c.session.instanceId,
    }, this.now(), this.maxAgeMs) : { virtualIp: null };
    const lanSnapshot = c.session ? projectEasyTierMembers(c.sample, { serverId, generation: c.state.generation, instanceId: c.session.instanceId }, c.state.phase, this.now(), this.unixNow(), this.maxAgeMs) : null;
    const localDetails = c.session && c.state.phase === "connected" ? projectEasyTierLocalDetails(c.sample,
      { serverId, generation: c.state.generation, instanceId: c.session.instanceId }, this.now(), this.unixNow(), Math.min(this.maxAgeMs, 5000)) : null;
    return { ...c.state, virtualIp: status.virtualIp, lanSnapshot, localDetails };
  }
  async connect(lease: EasyTierCommunityLease): Promise<EasyTierCommunityState> {
    if (!validEasyTierLease(lease)) throw new Error("invalid-community-lease");
    const c = this.community(lease.serverId);
    if (this.disposed) return this.getState(lease.serverId);
    c.leases.add(lease.leaseId);
    if (c.state.phase !== "connecting" && c.state.phase !== "connected") this.reconcile(c);
    await c.operation;
    return this.getState(lease.serverId);
  }
  async disconnect(lease: EasyTierCommunityLease): Promise<EasyTierCommunityState> {
    if (!validEasyTierLease(lease)) throw new Error("invalid-community-lease");
    const c = this.community(lease.serverId);
    if (!c.leases.delete(lease.leaseId) || c.leases.size > 0) return this.getState(lease.serverId);
    this.reconcile(c);
    await c.operation;
    return this.getState(lease.serverId);
  }
  async disconnectCommunity(serverId: string): Promise<EasyTierCommunityState> {
    const c = this.community(serverId);
    c.leases.clear();
    this.reconcile(c);
    await c.operation;
    return this.getState(serverId);
  }
  /** Main auth callback only. Membership leases survive bearer refresh and voice changes. */
  async authenticatedSessionChanged(serverId: string): Promise<EasyTierCommunityState> {
    const c = this.community(serverId);
    if (!this.disposed) this.reconcile(c);
    await c.operation;
    return this.getState(serverId);
  }
  async setEnabled(enabled: boolean): Promise<EasyTierCommunityState[]> {
    if (typeof enabled !== "boolean") throw new Error("invalid-enabled-value");
    if (!this.disposed && this.enabled !== enabled) {
      this.enabled = enabled;
      for (const c of this.communities.values()) this.reconcile(c);
    }
    await Promise.all([...this.communities.values()].map(c => c.operation));
    return [...this.communities.keys()].map(id => this.getState(id));
  }
  async syncMemberships(serverIds: readonly string[]): Promise<EasyTierCommunityState[]> {
    if (!Array.isArray(serverIds) || serverIds.length > 64 || !serverIds.every(validEasyTierId)) throw new Error("invalid-community-memberships");
    const wanted = new Set(serverIds);
    const revision = ++this.membershipRevision;
    const releases: Promise<EasyTierCommunityState>[] = [];
    for (const c of this.communities.values()) if (!wanted.has(c.state.serverId) && c.leases.has("renderer-community")) {
      releases.push(this.disconnect({ serverId: c.state.serverId, leaseId: "renderer-community" }));
    }
    await Promise.all(releases);
    if (revision !== this.membershipRevision || this.disposed) return [];
    const work: Promise<EasyTierCommunityState>[] = [];
    for (const serverId of wanted) work.push(this.connect({ serverId, leaseId: "renderer-community" }));
    return Promise.all(work);
  }
  private reconcile(c: Community): void {
    c.cancel?.abort();
    c.refreshFlight?.abort(); c.refreshFlight = null;
    const cancel = new AbortController();
    c.cancel = cancel;
    const generation = ++c.state.generation;
    const wanted = this.enabled && !this.disposed && c.leases.size > 0;
    const gate = wanted ? this.runtime?.activationReason() ?? (this.runtime ? null : "activation-required") : null;
    c.sample = null;
    c.state = { ...c.state, generation, phase: wanted ? gate ? "activation-required" : "connecting" : "disconnecting", reason: gate, virtualIp: null, lanSnapshot: null };
    this.publish(c);
    const work = c.tail.then(async () => {
      // All generations share one lane; canceled starts drain before replacement.
      if (c.session) {
        await c.session.close();
        c.session = null;
      }
      if (generation !== c.state.generation || cancel.signal.aborted) return;
      if (!wanted || gate) {
        c.state.phase = wanted ? "activation-required" : "disabled";
        this.publish(c);
        return;
      }
      const session = await this.runtime!.connect({ serverId: c.state.serverId, generation, signal: cancel.signal });
      if (generation !== c.state.generation || cancel.signal.aborted) { await session.close(); return; }
      c.session = session;
      c.state.phase = "connected";
      c.state.reason = null;
      this.publish(c);
      // Populate community telemetry immediately without extending the connect lane.
      void this.refresh(c.state.serverId).catch(() => undefined);
    });
    c.tail = work.catch(error => {
      if (generation === c.state.generation && !cancel.signal.aborted) {
        c.state.reason = error instanceof EasyTierOperationError ? error.reason : c.session ? "cleanup-failed" : "connect-failed";
        c.state.phase = ["activation-required", "needs-permission", "configuration-required", "runtime-required", "multi-community-unavailable"].includes(c.state.reason) ? "activation-required" : "error";
        this.publish(c);
      }
    });
    c.operation = this.deadline(c.tail, cancel.signal).catch(() => {
      if (generation === c.state.generation) {
        cancel.abort();
        c.state.phase = "error";
        c.state.reason = "operation-timeout";
        this.publish(c);
      }
    });
  }
  private deadline(work: Promise<void>, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = (error?: unknown) => { clearTimeout(timer); signal.removeEventListener("abort", abort); error === undefined ? resolve() : reject(error); };
      const abort = () => done();
      const timer = setTimeout(() => done(new EasyTierOperationError("operation-timeout")), this.timeoutMs);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) done();
      work.then(() => done(), error => done(error));
    });
  }
  /** A poll failure clears telemetry and leaves LAN session ownership intact. */
  async refresh(serverId: string): Promise<void> {
    const c = this.community(serverId);
    const session = c.session;
    if (!session || c.state.phase !== "connected") return;
    if (c.refreshFlight) { this.publish(c); return; }
    const generation = c.state.generation;
    const cancel = new AbortController();
    c.refreshFlight = cancel;
    this.report(c, 'telemetry', 'start');
    const work = session.read(cancel.signal).then(sample => {
      if (c.session !== session || c.state.generation !== generation || cancel.signal.aborted) return;
      c.sample = sample;
      const status = projectEasyTierStatus(sample, { serverId, generation, instanceId: session.instanceId }, this.now(), this.maxAgeMs);
      c.state.reason = status.running === false ? "runtime-exited" : status.running === null ? "status-unavailable" : null;
      if (status.running === false) c.state.phase = "error";
      this.publish(c);
      this.report(c, 'telemetry', 'finish');
    });
    try { await this.deadline(work, cancel.signal); }
    catch (error) {
      cancel.abort();
      if (c.session === session && c.state.generation === generation) {
        c.sample = null;
        c.state.reason = error instanceof EasyTierSessionRetiredError ? error.reason : "status-unavailable";
        if (error instanceof EasyTierSessionRetiredError) c.state.phase = "error";
        this.publish(c);
        this.report(c, 'telemetry', 'finish', easyTierObservationReason(error));
      }
    } finally {
      // A port may settle after its deadline or ignore abort. Only this flight
      // may release the read lane; late results cannot clear a newer poll.
      if (c.refreshFlight === cancel) c.refreshFlight = null;
    }
  }
  refreshAll(): void {
    for (const id of this.communities.keys()) void this.refresh(id);
  }
  /** Final synchronous fallback: no image-name/PID scans or user-owned ET access. */
  shutdownOwned(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    for (const c of this.communities.values()) {
      c.cancel?.abort();
      c.refreshFlight?.abort(); c.refreshFlight = null;
      c.leases.clear();
      c.sample = null;
      c.state = { ...c.state, generation: c.state.generation + 1, phase: "disabled", reason: null, virtualIp: null, lanSnapshot: null };
    }
    this.runtime?.shutdownOwned();
  }
}
