import { EasyTierOperationError, type EasyTierRuntime, type EasyTierSession } from "./easyTierCommunityManager";
import type { EasyTierIdentityBinding, EasyTierStatusSample } from "./easyTierStatus";
import { EASYTIER_WINDOWS_TARGET } from "./easyTierTarget";

export interface EasyTierActivation {
  /** Main-only approval after binary, driver, permissions and RPC transport acceptance. */
  approved: boolean;
  targetVerified: boolean;
  dynamicInstanceRpcVerified: boolean;
  broadcastFixVerified: boolean;
  /** Locally checked archive digest and matching release build, not metadata alone. */
  targetVersion: string;
  targetCommit: string;
  archiveSha256: string;
}
export interface EasyTierBootstrapPolicy {
  provider: "existing-owned";
  /** Opaque main-only provider references. No public nodes enabled in this stage. */
  providerRefs: readonly string[];
}
export const DEFAULT_EASYTIER_BOOTSTRAP: EasyTierBootstrapPolicy = Object.freeze({ provider: "existing-owned", providerRefs: Object.freeze([]) });

/** Provisioning authority owns the network name, secret and configuration lifetime. */
export interface EasyTierInstancePlan {
  serverId: string;
  instanceId: string;
  /** Must be unique per community; same name with a different secret is rejected. */
  networkName: string;
  configRef: string;
  latencyFirst: boolean | null;
}
export interface EasyTierOwnedCore {
  /** Handle captured at launch. No attaching to an already running user process. */
  isAlive(): boolean;
  terminateOwned(): void;
  /** Dispose the exit listener without performing process discovery. */
  onExit(listener: () => void): () => void;
  rpc: {
    /** Must drain dispatched mutations to a definitive reply even after consumer cancel. */
    runInstance(plan: EasyTierInstancePlan, signal: AbortSignal): Promise<{ instanceId: string }>;
    waitForRunning(instanceId: string, signal: AbortSignal): Promise<void>;
    /** True only after the native transport has resolved an indeterminate mutation. */
    reconcileMutation?(instanceId: string): Promise<boolean>;
    deleteInstance(instanceId: string): Promise<void>;
    listInstanceIds(): Promise<string[]>;
    /** Scoped CollectNetworkInfo; no config, events or public addresses forwarded. */
    collectInfo(instanceId: string, signal: AbortSignal): Promise<unknown>;
  };
}
export interface WindowsEasyTierPorts {
  activation: EasyTierActivation;
  bootstrap?: EasyTierBootstrapPolicy;
  /** Secure main/native boundary. No renderer supplied TOML/CLI or credentials. */
  provision(serverId: string, policy: EasyTierBootstrapPolicy, signal: AbortSignal): Promise<EasyTierInstancePlan>;
  releasePlan(plan: EasyTierInstancePlan): Promise<void>;
  startOwnedCore(): Promise<EasyTierOwnedCore>;
  bindings(scope: { serverId: string; instanceId: string; generation: number }): Promise<EasyTierIdentityBinding[]>;
  /** Independent timestamped local observations. Never refresh stale RTT with RPC read time. */
  observations?(scope: { serverId: string; instanceId: string; generation: number }): Promise<Pick<EasyTierStatusSample, "rtt" | "relayRoles" | "selectedRoutes">>;
  now?: () => number;
  unixNow?: () => number;
}

/** One app-owned Windows core, multiple dynamic network instances. No launcher here. */
export class WindowsEasyTierRuntime implements EasyTierRuntime {
  private core: EasyTierOwnedCore | null = null;
  private starting: Promise<EasyTierOwnedCore> | null = null;
  private stopped = false;
  private unlisten: (() => void) | null = null;
  private plans = new Map<string, EasyTierInstancePlan>();
  private names = new Map<string, string>();
  private instanceIds = new Set<string>();
  private cleanup = new Map<string, () => Promise<void>>();
  constructor(private ports: WindowsEasyTierPorts) {}
  activationReason(): "activation-required" | "unsupported-target" | null {
    const a = this.ports.activation;
    if (this.stopped || !a.approved) return "activation-required";
    return a.targetVerified && a.dynamicInstanceRpcVerified && a.broadcastFixVerified
      && a.targetVersion === EASYTIER_WINDOWS_TARGET.version && a.targetCommit === EASYTIER_WINDOWS_TARGET.commit
      && a.archiveSha256 === EASYTIER_WINDOWS_TARGET.archiveSha256 ? null : "unsupported-target";
  }
  private async ownedCore(): Promise<EasyTierOwnedCore> {
    if (this.core) {
      if (!this.core.isAlive()) throw new Error("owned-core-exited");
      return this.core;
    }
    if (!this.starting) {
      this.starting = this.ports.startOwnedCore().then(core => {
        if (this.stopped) { core.terminateOwned(); throw new Error("runtime-stopped"); }
        this.core = core;
        this.unlisten = core.onExit(() => { /* isAlive and the status adapter expose exit, without identity changes. */ });
        return core;
      });
      // A failed launch can be retried; successful launch remains shared.
      void this.starting.catch(() => { this.starting = null; });
    }
    return this.starting;
  }
  async connect(scope: { serverId: string; generation: number; signal: AbortSignal }): Promise<EasyTierSession> {
    if (this.activationReason() || scope.signal.aborted) throw new Error("activation-required");
    // Retry unconfirmed cleanup before provisioning a replacement for this community.
    const previousCleanup = this.cleanup.get(scope.serverId);
    if (previousCleanup) {
      try { await previousCleanup(); } catch { throw new EasyTierOperationError("cleanup-failed"); }
    }
    const policy = this.ports.bootstrap ?? DEFAULT_EASYTIER_BOOTSTRAP;
    if (policy.provider !== "existing-owned") throw new Error("bootstrap-policy-not-approved");
    const plan = await this.ports.provision(scope.serverId, policy, scope.signal);
    if (scope.signal.aborted || this.stopped) { await this.ports.releasePlan(plan); throw new Error("connect-canceled"); }
    if (plan.serverId !== scope.serverId || !plan.networkName || !plan.instanceId || this.plans.has(plan.serverId) || this.names.has(plan.networkName) || this.instanceIds.has(plan.instanceId)) {
      await this.ports.releasePlan(plan);
      throw new Error("community-network-conflict");
    }
    // Reserve before awaiting startup: parallel communities cannot reuse a network name.
    this.plans.set(plan.serverId, plan);
    this.names.set(plan.networkName, plan.serverId);
    this.instanceIds.add(plan.instanceId);
    let core: EasyTierOwnedCore | null = null;
    let attempted = false;
    let indeterminate = false;
    let closing: Promise<void> | null = null;
    let closed = false;
    const close = (): Promise<void> => {
      if (closed) return Promise.resolve();
      if (closing) return closing;
      closing = (async () => {
        if (attempted && core?.isAlive() && !this.stopped) {
          // 2.7 process mutations spawn tasks: transport cancellation is not rollback.
          if (indeterminate && !(await core.rpc.reconcileMutation?.(plan.instanceId))) throw new Error("mutation-unconfirmed");
          // Never RetainNetworkInstance (it deletes every instance outside its list).
          await core.rpc.deleteInstance(plan.instanceId);
          if ((await core.rpc.listInstanceIds()).includes(plan.instanceId)) throw new Error("instance-remains");
        }
        await this.ports.releasePlan(plan);
        this.plans.delete(plan.serverId);
        this.names.delete(plan.networkName);
        this.instanceIds.delete(plan.instanceId);
        this.cleanup.delete(plan.serverId);
        closed = true;
      })().catch(error => { closing = null; throw error; });
      return closing;
    };
    this.cleanup.set(plan.serverId, close);
    try {
      core = await this.ownedCore();
      if (scope.signal.aborted || this.stopped) throw new Error("connect-canceled");
      // Refuse an unexpected pre-existing instance even on our core.
      if ((await core.rpc.listInstanceIds()).includes(plan.instanceId)) throw new Error("instance-not-owned");
      if (scope.signal.aborted || this.stopped) throw new Error("connect-canceled");
      attempted = true;
      let result: { instanceId: string };
      try {
        // Keep observing a dispatched operation so consumer cancellation cannot lose its ACK.
        result = await core.rpc.runInstance(plan, new AbortController().signal);
      } catch { indeterminate = true; throw new Error("mutation-unconfirmed"); }
      if (result.instanceId !== plan.instanceId) { indeterminate = true; throw new Error("instance-id-mismatch"); }
      if (scope.signal.aborted || this.stopped) throw new Error("instance-start-not-confirmed");
      await core.rpc.waitForRunning(plan.instanceId, scope.signal);
      if (scope.signal.aborted || this.stopped) throw new Error("connect-canceled");
    } catch {
      try { await close(); } catch { throw new EasyTierOperationError("cleanup-failed"); }
      throw new EasyTierOperationError("connect-failed");
    }
    const owned = core;
    return {
      instanceId: plan.instanceId,
      close,
      read: async signal => {
        const acquiredAtMs = (this.ports.now ?? (() => performance.now()))();
        const acquiredAtUnixMs = (this.ports.unixNow ?? (() => Date.now()))();
        const context = { serverId: scope.serverId, instanceId: plan.instanceId, generation: scope.generation };
        if (closed || this.stopped || !owned.isAlive()) return { ...context, acquiredAtMs, acquiredAtUnixMs, freshRpc: true, latencyFirst: plan.latencyFirst, info: { running: false }, bindings: [] };
        // Bindings are separately authenticated; ET network-secret possession is not a user ID.
        const [info, bindings, observations] = await Promise.all([owned.rpc.collectInfo(plan.instanceId, signal), this.ports.bindings(context), this.ports.observations?.(context) ?? Promise.resolve<Pick<EasyTierStatusSample, "rtt" | "relayRoles" | "selectedRoutes">>({})]);
        const sample: EasyTierStatusSample = { ...context, acquiredAtMs, acquiredAtUnixMs, freshRpc: !signal.aborted, latencyFirst: plan.latencyFirst, info, bindings, rtt: observations.rtt, relayRoles: observations.relayRoles, selectedRoutes: observations.selectedRoutes };
        return sample;
      },
    };
  }
  shutdownOwned(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.unlisten?.();
    this.unlisten = null;
    // The native port must terminate the original owned handle/job, never a PID re-open.
    this.core?.terminateOwned();
  }
}
