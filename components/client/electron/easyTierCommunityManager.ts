import type {
  EasyTierCommunityLease, EasyTierCommunityState,
} from "../src/lib/easyTierCommunity";
import { projectEasyTierMembers } from "./easyTierMemberAdapter";
import { type EasyTierStatusSample, projectEasyTierStatus } from "./easyTierStatus";

export interface EasyTierSession {
  instanceId: string;
  read(signal: AbortSignal): Promise<EasyTierStatusSample>;
  /** Idempotent; removes only this app's instance, never restarts a shared core. */
  close(): Promise<void>;
}
export interface EasyTierRuntime {
  activationReason(): "activation-required" | "unsupported-target" | null;
  connect(scope: { serverId: string; generation: number; signal: AbortSignal }): Promise<EasyTierSession>;
  /** Exact owned process handle only. Must be synchronous for Windows session end. */
  shutdownOwned(): void;
}
export class EasyTierOperationError extends Error {
  constructor(public reason: "cleanup-failed" | "connect-failed") { super(reason); }
}
interface Community {
  leases: Set<string>;
  state: EasyTierCommunityState;
  session: EasyTierSession | null;
  sample: EasyTierStatusSample | null;
  cancel: AbortController | null;
  tail: Promise<void>;
  operation: Promise<void>;
  refreshing: boolean;
}
export function validEasyTierId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);
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
  constructor(private runtime: EasyTierRuntime | null, private emit: (state: EasyTierCommunityState) => void = () => undefined,
    private now = () => performance.now(), private timeoutMs = 8000, private maxAgeMs = 10_000, private unixNow = () => Date.now()) {}

  private community(serverId: string): Community {
    if (!validEasyTierId(serverId)) throw new Error("invalid-community-id");
    let community = this.communities.get(serverId);
    if (!community) {
      community = { leases: new Set(), state: { serverId, generation: 0, phase: "disabled", reason: null, virtualIp: null, lanSnapshot: null },
        session: null, sample: null, cancel: null, tail: Promise.resolve(), operation: Promise.resolve(), refreshing: false };
      this.communities.set(serverId, community);
    }
    return community;
  }
  private publish(c: Community): void {
    try { this.emit(this.getState(c.state.serverId)); } catch { /* Observers never block lifecycle. */ }
  }
  getState(serverId: string): EasyTierCommunityState {
    const c = this.community(serverId);
    const status = c.session && c.state.phase === "connected" ? projectEasyTierStatus(c.sample, {
      serverId, generation: c.state.generation, instanceId: c.session.instanceId,
    }, this.now(), this.maxAgeMs) : { virtualIp: null };
    const lanSnapshot = c.session ? projectEasyTierMembers(c.sample, { serverId, generation: c.state.generation, instanceId: c.session.instanceId }, c.state.phase, this.now(), this.unixNow(), this.maxAgeMs) : null;
    return { ...c.state, virtualIp: status.virtualIp, lanSnapshot };
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
  async setEnabled(enabled: boolean): Promise<EasyTierCommunityState[]> {
    if (typeof enabled !== "boolean") throw new Error("invalid-enabled-value");
    if (!this.disposed && this.enabled !== enabled) {
      this.enabled = enabled;
      for (const c of this.communities.values()) this.reconcile(c);
    }
    await Promise.all([...this.communities.values()].map(c => c.operation));
    return [...this.communities.keys()].map(id => this.getState(id));
  }
  private reconcile(c: Community): void {
    c.cancel?.abort();
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
    });
    c.tail = work.catch(error => {
      if (generation === c.state.generation && !cancel.signal.aborted) {
        c.state.phase = "error";
        c.state.reason = error instanceof EasyTierOperationError ? error.reason : c.session ? "cleanup-failed" : "connect-failed";
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
      const done = (error = false) => { clearTimeout(timer); signal.removeEventListener("abort", abort); error ? reject(new Error("operation-timeout")) : resolve(); };
      const abort = () => done();
      const timer = setTimeout(() => done(true), this.timeoutMs);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) done();
      work.then(() => done(), () => done(true));
    });
  }
  /** A poll failure clears telemetry and leaves LAN session ownership intact. */
  async refresh(serverId: string): Promise<void> {
    const c = this.community(serverId);
    const session = c.session;
    if (!session || c.state.phase !== "connected") return;
    if (c.refreshing) { this.publish(c); return; }
    c.refreshing = true;
    const generation = c.state.generation;
    const cancel = new AbortController();
    const work = session.read(cancel.signal).then(sample => {
      if (c.session !== session || c.state.generation !== generation || cancel.signal.aborted) return;
      c.sample = sample;
      const status = projectEasyTierStatus(sample, { serverId, generation, instanceId: session.instanceId }, this.now(), this.maxAgeMs);
      c.state.reason = status.running === false ? "runtime-exited" : status.running === null ? "status-unavailable" : null;
      if (status.running === false) c.state.phase = "error";
      this.publish(c);
    }).finally(() => { c.refreshing = false; });
    try { await this.deadline(work, cancel.signal); }
    catch {
      cancel.abort();
      if (c.session === session && c.state.generation === generation) { c.sample = null; c.state.reason = "status-unavailable"; this.publish(c); }
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
      c.leases.clear();
      c.sample = null;
      c.state = { ...c.state, generation: c.state.generation + 1, phase: "disabled", reason: null, virtualIp: null, lanSnapshot: null };
    }
    this.runtime?.shutdownOwned();
  }
}
