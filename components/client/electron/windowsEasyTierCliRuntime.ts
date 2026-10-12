import { EasyTierOperationError, type EasyTierRuntime, type EasyTierSession } from "./easyTierCommunityManager";
import type { EasyTierExistingConfiguration } from "./easyTierExistingConfiguration";
import type { EasyTierCliCore } from "./easyTierWindowsProcesses";

export interface WindowsEasyTierCliPorts {
  platform: string;
  configuration(serverId: string, signal: AbortSignal): Promise<EasyTierExistingConfiguration>;
  permission(): Promise<boolean>;
  verifiedAssets(): Promise<string>;
  start(directory: string, config: EasyTierExistingConfiguration, signal: AbortSignal): Promise<EasyTierCliCore>;
  shutdownOwned(): void;
  /** Production waits between CLI attempts. Pure tests supply an immediate wait. */
  pause(signal: AbortSignal): Promise<void>;
}

/** Production startup-only official CLI path. Dynamic RPC adapter remains separate. */
export class WindowsEasyTierCliRuntime implements EasyTierRuntime {
  private stopped = false;
  private owner: { serverId: string; core: EasyTierCliCore | null; cleanupPending: boolean; close: () => Promise<void> } | null = null;
  constructor(private ports: WindowsEasyTierCliPorts) {}
  activationReason(): "activation-required" | "unsupported-target" | null {
    return this.stopped ? "activation-required" : this.ports.platform !== "win32" ? "unsupported-target" : null;
  }
  async connect(scope: { serverId: string; generation: number; signal: AbortSignal }): Promise<EasyTierSession> {
    if (this.activationReason()) throw new EasyTierOperationError("unsupported-target");
    // Reserve before any await. Never spawn a second core or restart another LAN session.
    if (this.owner?.serverId === scope.serverId && this.owner.cleanupPending) await this.owner.close();
    if (this.owner) throw new EasyTierOperationError("multi-community-unavailable");
    const owner = { serverId: scope.serverId, core: null as EasyTierCliCore | null, cleanupPending: false, close: async () => undefined as void };
    this.owner = owner;
    let closed = false, closing: Promise<void> | null = null;
    const close = (): Promise<void> => {
      if (closed) return Promise.resolve();
      if (closing) return closing;
      closing = (async () => {
        await owner.core?.close();
        if (this.owner === owner) this.owner = null;
        closed = true;
      })().catch(() => { closing = null; owner.cleanupPending = true; throw new EasyTierOperationError("cleanup-failed"); });
      return closing;
    };
    owner.close = close;
    const check = () => { if (this.stopped || scope.signal.aborted) throw new EasyTierOperationError("connect-failed"); };
    try {
      check();
      if (!(await this.ports.permission())) throw new EasyTierOperationError("needs-permission");
      check();
      const config = await this.ports.configuration(scope.serverId, scope.signal);
      check();
      if (config.serverId !== scope.serverId) throw new EasyTierOperationError("configuration-required");
      const directory = await this.ports.verifiedAssets();
      check();
      owner.core = await this.ports.start(directory, config, scope.signal);
      check();
      let ready = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        check();
        if (!owner.core.isAlive()) throw new EasyTierOperationError("connect-failed");
        try {
          if (config.credentialIdentity) {
            if (!owner.core.readCredentialObservation) throw new EasyTierOperationError("status-unavailable");
            await owner.core.readCredentialObservation(scope.signal); ready = true; break;
          }
          if ((await owner.core.readNode(scope.signal)).virtualIp) { ready = true; break; }
        }
        catch { check(); }
        await this.ports.pause(scope.signal);
      }
      if (!ready) throw new EasyTierOperationError("connect-failed");
      check();
      const core = owner.core;
      return {
        instanceId: config.instanceId, close,
        readCredentialObservation: core.readCredentialObservation ? signal => core.readCredentialObservation!(signal) : undefined,
        readCredentialSample: core.readCredentialNetwork ? async signal => {
          if (closed || closing || this.stopped || !core.isAlive() || signal.aborted) throw new EasyTierOperationError("runtime-exited");
          const {network, observation} = await core.readCredentialNetwork!(signal);
          if (closed || closing || this.stopped || !core.isAlive() || signal.aborted) throw new EasyTierOperationError("runtime-exited");
          return {observation, sample: {serverId: scope.serverId, generation: scope.generation, instanceId: config.instanceId,
            ...network, acquisitionSource: "owned-cli-route-list", freshRpc: true, bindings: []}};
        } : undefined,
        read: async signal => {
          const context = { serverId: scope.serverId, generation: scope.generation, instanceId: config.instanceId,
            acquiredAtMs: performance.now(), acquiredAtUnixMs: Date.now(), freshRpc: !signal.aborted, latencyFirst: null, bindings: [] };
          if (closed || closing || this.stopped || !core.isAlive() || signal.aborted) return { ...context, freshRpc: false, info: { running: false } };
          const network = await core.readNetwork(signal);
          if (closed || closing || this.stopped || !core.isAlive() || signal.aborted) return { ...context, freshRpc: false, info: { running: false } };
          // Verbose CLI supplies real local peer/route facts, not user binding or packet-path proof.
          return { ...context, ...network, acquisitionSource: "owned-cli-route-list", freshRpc: true, bindings: [] };
        },
      };
    } catch (error) {
      await close();
      if (error instanceof EasyTierOperationError) throw error;
      throw new EasyTierOperationError("connect-failed");
    }
  }
  shutdownOwned(): void { if (this.stopped) return; this.stopped = true; this.ports.shutdownOwned(); }
}
