import { type EasyTierObservationReason, easyTierObservationReason, EasyTierOperationError, type EasyTierRuntime, type EasyTierSession } from "./easyTierCommunityManager";
import type { EasyTierExistingConfiguration } from "./easyTierExistingConfiguration";
import type { EasyTierCliCore } from "./easyTierWindowsProcesses";

export interface EasyTierStartupStage {
  stage: "configuration" | "permission" | "assets" | "core-start" | "credential-ready" | "icmp-prepare";
  action: "start" | "finish";
  elapsedMs: number;
  reason: "success" | "failed" | "cancelled" | null;
  observationReason?: EasyTierObservationReason;
}

export interface WindowsEasyTierCliPorts {
  platform: string;
  configuration(serverId: string, signal: AbortSignal): Promise<EasyTierExistingConfiguration>;
  permission(): Promise<boolean>;
  verifiedAssets(): Promise<string>;
  start(directory: string, config: EasyTierExistingConfiguration, signal: AbortSignal): Promise<EasyTierCliCore>;
  shutdownOwned(): void;
  /** Optional product-only, scoped rule preparation after the owned NIC is ready. */
  prepareOwnedInterface?(config: EasyTierExistingConfiguration, core: EasyTierCliCore, signal: AbortSignal): Promise<() => Promise<void>>;
  /** Static stage/elapsed evidence only; observer failures never affect LAN. */
  onStartupStage?(event: EasyTierStartupStage): void;
  /** Production waits between CLI attempts. Pure tests supply an immediate wait. */
  pause(signal: AbortSignal): Promise<void>;
}

/** Production startup-only official CLI path. Dynamic RPC adapter remains separate. */
export class WindowsEasyTierCliRuntime implements EasyTierRuntime {
  private stopped = false;
  private owner: { serverId: string; core: EasyTierCliCore | null; cleanupPending: boolean; close: () => Promise<void>; cancelPreparation: () => void } | null = null;
  constructor(private ports: WindowsEasyTierCliPorts) {}
  activationReason(): "activation-required" | "unsupported-target" | null {
    return this.stopped ? "activation-required" : this.ports.platform !== "win32" ? "unsupported-target" : null;
  }
  async assertReady(signal: AbortSignal): Promise<void> {
    if (this.activationReason() || signal.aborted) throw new EasyTierOperationError("unsupported-target");
    if (!(await this.ports.permission())) throw new EasyTierOperationError("needs-permission");
    if (signal.aborted) throw new EasyTierOperationError("connect-failed");
  }
  async connect(scope: { serverId: string; generation: number; signal: AbortSignal }): Promise<EasyTierSession> {
    if (this.activationReason()) throw new EasyTierOperationError("unsupported-target");
    // Reserve before any await. Never spawn a second core or restart another LAN session.
    if (this.owner?.serverId === scope.serverId && this.owner.cleanupPending) await this.owner.close();
    if (this.owner) throw new EasyTierOperationError("multi-community-unavailable");
    const interfaceCancel = new AbortController();
    const cancelPreparation = () => interfaceCancel.abort();
    const owner = { serverId: scope.serverId, core: null as EasyTierCliCore | null, cleanupPending: false, close: async () => undefined as void, cancelPreparation };
    this.owner = owner;
    let closed = false, closing: Promise<void> | null = null;
    let releaseInterface: (() => Promise<void>) | undefined;
    let interfacePreparation: Promise<void> = Promise.resolve();
    scope.signal.addEventListener("abort", cancelPreparation, { once: true });
    const startedAt = performance.now();
    const stage = async <T>(name: EasyTierStartupStage["stage"], work: () => Promise<T>, signal = scope.signal): Promise<T> => {
      const report = (action: EasyTierStartupStage["action"], reason: EasyTierStartupStage["reason"], error?: unknown) => {
        try { this.ports.onStartupStage?.({ stage: name, action, elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)), reason,
          ...(error === undefined ? {} : { observationReason: signal.aborted ? "cancelled" : easyTierObservationReason(error) }) }); }
        catch { /* Diagnostic observers never affect lifecycle. */ }
      };
      report("start", null);
      try { const result = await work(); report("finish", signal.aborted ? "cancelled" : "success"); return result; }
      catch (error) { report("finish", signal.aborted ? "cancelled" : "failed", error); throw error; }
    };
    const close = (): Promise<void> => {
      if (closed) return Promise.resolve();
      if (closing) return closing;
      closing = (async () => {
        cancelPreparation();
        scope.signal.removeEventListener("abort", cancelPreparation);
        // Windows may erase the interface alias from a rule after the NIC is
        // removed. Verify/remove our exact rule while that identity still exists.
        // Preparation has bounded production ports. Drain its late handle before
        // removing the NIC; racing it against a timer would orphan a created rule.
        try { await interfacePreparation; await releaseInterface?.(); }
        finally { await owner.core?.close(); }
        if (this.owner === owner) this.owner = null;
        closed = true;
      })().catch(() => { closing = null; owner.cleanupPending = true; throw new EasyTierOperationError("cleanup-failed"); });
      return closing;
    };
    owner.close = close;
    const check = () => { if (this.stopped || scope.signal.aborted) throw new EasyTierOperationError("connect-failed"); };
    try {
      check();
      const config = await stage("configuration", () => this.ports.configuration(scope.serverId, scope.signal));
      check();
      if (config.serverId !== scope.serverId) throw new EasyTierOperationError("configuration-required");
      // Configuration is a pure product-owned receipt read. Do it before the
      // Windows permission check so a missing/mismatched receipt cannot prompt
      // for access that no executable will use.
      if (!(await stage("permission", () => this.ports.permission()))) throw new EasyTierOperationError("needs-permission");
      check();
      const directory = await stage("assets", () => this.ports.verifiedAssets());
      check();
      owner.core = await stage("core-start", () => this.ports.start(directory, config, scope.signal));
      check();
      const core = owner.core;
      await stage("credential-ready", async () => {
        let lastError: unknown;
        for (let attempt = 0; attempt < 12; attempt++) {
          check();
          if (!core.isAlive()) throw new EasyTierOperationError("connect-failed");
          try {
            if (config.credentialIdentity) {
              if (!core.readCredentialObservation) throw new EasyTierOperationError("status-unavailable");
              await core.readCredentialObservation(scope.signal); return;
            }
            if ((await core.readNode(scope.signal)).virtualIp) return;
          }
          catch (error) { lastError = error; check(); }
          await this.ports.pause(scope.signal);
        }
        throw new EasyTierOperationError("connect-failed", easyTierObservationReason(lastError));
      });
      check();
      // ICMP is optional. A verified live core completes the connect lane while
      // its separately cancellable preparation retains exact cleanup ownership.
      if (this.ports.prepareOwnedInterface) {
        interfacePreparation = stage("icmp-prepare", async () => {
          releaseInterface = await this.ports.prepareOwnedInterface!(config, core, interfaceCancel.signal);
        }, interfaceCancel.signal).catch(() => undefined);
      }
      check();
      return {
        instanceId: config.instanceId, close,
        applyRelayBudget: core.applyRelayBudget ? (budget, lease, signal) => core.applyRelayBudget!(budget, lease, signal) : undefined,
        readCredentialObservation: core.readCredentialObservation ? signal => core.readCredentialObservation!(signal) : undefined,
        readCredentialSample: core.readCredentialNetwork ? async signal => {
          if (closed || closing || this.stopped || !core.isAlive() || signal.aborted) throw new EasyTierOperationError("runtime-exited");
          const {network, observation} = await core.readCredentialNetwork!(signal);
          if (closed || closing || this.stopped || !core.isAlive() || signal.aborted) throw new EasyTierOperationError("runtime-exited");
          return {observation, sample: {serverId: scope.serverId, generation: scope.generation, instanceId: config.instanceId,
            ...network, latencyFirst: config.latencyFirst ?? network.latencyFirst,
            acquisitionSource: "owned-cli-route-list", freshRpc: true, bindings: []}};
        } : undefined,
        read: async signal => {
          const context = { serverId: scope.serverId, generation: scope.generation, instanceId: config.instanceId,
            acquiredAtMs: performance.now(), acquiredAtUnixMs: Date.now(), freshRpc: !signal.aborted,
            latencyFirst: config.latencyFirst ?? null, bindings: [] };
          if (closed || closing || this.stopped || !core.isAlive() || signal.aborted) return { ...context, freshRpc: false, info: { running: false } };
          const network = await core.readNetwork(signal);
          if (closed || closing || this.stopped || !core.isAlive() || signal.aborted) return { ...context, freshRpc: false, info: { running: false } };
          // Verbose CLI supplies real local peer/route facts, not user binding or packet-path proof.
          return { ...context, ...network, latencyFirst: config.latencyFirst ?? network.latencyFirst,
            acquisitionSource: "owned-cli-route-list", freshRpc: true, bindings: [] };
        },
      };
    } catch (error) {
      await close();
      if (error instanceof EasyTierOperationError) throw error;
      throw new EasyTierOperationError("connect-failed");
    }
  }
  shutdownOwned(): void { if (this.stopped) return; this.stopped = true; this.owner?.cancelPreparation(); this.ports.shutdownOwned(); }
}
