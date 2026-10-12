import { randomUUID } from 'node:crypto';

import { buildCommunityEtConfig } from './communityEtConfig';
import { MainGrantGate, exact, id, sameScope, type TrustedCommunityIntent } from './communityEtGrant';
import { CommunityEtGrantTransport, CommunityEtTransportError, validCommunityBearer, type TrustedCommunityTarget, type VerifiedCommunitySession } from './communityEtGrantTransport';
import { CommunityEtOwnedFiles, readCommunityGrantTarget } from './communityEtTrustedConfiguration';
import { EasyTierOperationError, EasyTierSessionRetiredError, type EasyTierRuntime, type EasyTierSession } from './easyTierCommunityManager';
import type { EasyTierExistingConfiguration } from './easyTierExistingConfiguration';
import { projectCommunityEtBinding } from './communityEtBindingProjection';

interface AuthInput { serverId: string; host: string; accessToken: string | null }
interface Context {
  target: TrustedCommunityTarget; bearer: string; verified: VerifiedCommunitySession; gate: MainGrantGate;
  cancel: AbortController; configuration: EasyTierExistingConfiguration | null; removeConfig: (() => Promise<void>) | null;
  closeNative: (() => Promise<void>) | null; pendingRenew: Promise<void> | null; revisionFloor: number;
  retireFlight: Promise<void> | null;
  renewDueMono: number; grantExpiresMono: number; lastGrantId: string | null; retired: boolean; pendingRevoke: {grantId: string} | null;
}
export interface CommunityEtGrantRuntimePorts {
  target(serverId: string): Promise<TrustedCommunityTarget>;
  identities(serverId: string): Promise<{deviceId: string; nativeInstanceId: string}>;
  write: CommunityEtOwnedFiles['write'];
  transport: CommunityEtGrantTransport;
  wallMs(): number; monoMs(): number;
}
const combined = (...signals: AbortSignal[]) => AbortSignal.any(signals);
/** Main-only grant/session state. No private DTO reaches IPC or shared voice objects. */
export class CommunityEtGrantRuntime {
  private contexts = new Map<string, Context>();
  private authEpoch = new Map<string, number>();
  private authPending = new Map<string, AbortController>();
  private stopped = false;
  constructor(private ports: CommunityEtGrantRuntimePorts) {}
  async setAuthenticatedSession(input: unknown): Promise<{serverId: string; changed: boolean; authenticated: boolean}> {
    exact<AuthInput>(input, ['serverId', 'host', 'accessToken'], 'invalid-community-auth');
    if (!id(input.serverId) || typeof input.host !== 'string' || input.host.length > 256 ||
        (input.accessToken !== null && !validCommunityBearer(input.accessToken))) throw new Error('invalid-community-auth');
    if (this.stopped) throw new EasyTierOperationError('activation-required');
    const previous = this.contexts.get(input.serverId);
    const epoch = (this.authEpoch.get(input.serverId) ?? 0) + 1; this.authEpoch.set(input.serverId, epoch);
    this.authPending.get(input.serverId)?.abort(); const pending = new AbortController(); this.authPending.set(input.serverId, pending);
    if (input.accessToken === null) {
      try {
        if (previous) {
          previous.retired = true;
          try { await this.retire(previous); }
          catch { throw new EasyTierSessionRetiredError('cleanup-failed'); }
          this.contexts.delete(input.serverId);
        }
        return {serverId: input.serverId, changed: !!previous, authenticated: false};
      } finally { if (this.authPending.get(input.serverId) === pending) this.authPending.delete(input.serverId); }
    }
    try {
      const target = await this.ports.target(input.serverId);
      if (target.serverHost !== input.host) throw new EasyTierOperationError('configuration-required');
      if (previous && !previous.retired && previous.bearer === input.accessToken &&
          JSON.stringify(previous.target) === JSON.stringify(target))
        return {serverId: input.serverId, changed: false, authenticated: true};
      const identities = await this.ports.identities(input.serverId);
      const verified = await this.ports.transport.verifySession(target, input.accessToken, identities.deviceId, identities.nativeInstanceId, pending.signal);
      if (pending.signal.aborted || this.stopped || this.authEpoch.get(input.serverId) !== epoch) throw new Error('stale-auth-session');
      if (previous && !previous.retired && sameScope(previous.verified.intent, verified.intent) &&
          previous.verified.serverUserId === verified.serverUserId &&
          JSON.stringify(previous.target) === JSON.stringify(target) && this.sameIntent(previous.verified.intent, verified.intent)) {
        // Refresh keeps the exact owned LAN/core and active key. Never a voice-room restart.
        previous.bearer = input.accessToken; previous.verified = verified;
        return {serverId: input.serverId, changed: false, authenticated: true};
      }
      if (previous) {
        previous.retired = true;
        try { await this.retire(previous); }
        catch { throw new EasyTierSessionRetiredError('cleanup-failed'); }
      }
      if (pending.signal.aborted || this.authEpoch.get(input.serverId) !== epoch) throw new Error('stale-auth-session');
      const gate = new MainGrantGate(verified.intent, () => ({wallMs: this.ports.wallMs(), monoMs: Math.floor(this.ports.monoMs())}), {maxTtlMs: 300_000});
      this.contexts.set(input.serverId, {target, bearer: input.accessToken, verified, gate, cancel: new AbortController(),
        configuration: null, removeConfig: null, closeNative: null, pendingRenew: null, retireFlight: null, revisionFloor: 0,
        renewDueMono: Infinity, grantExpiresMono: 0, lastGrantId: null, retired: false, pendingRevoke: null});
      return {serverId: input.serverId, changed: true, authenticated: true};
    } catch (error) {
      // Genuine failed auth cannot leave a formerly authenticated scope active.
      if (error instanceof CommunityEtTransportError && error.code === 'auth-unavailable' && previous && this.authEpoch.get(input.serverId) === epoch) {
        previous.retired = true;
        try { await this.retire(previous); }
        catch { throw new EasyTierSessionRetiredError('cleanup-failed'); }
        this.contexts.delete(input.serverId);
        throw new EasyTierSessionRetiredError('configuration-required');
      }
      if (error instanceof EasyTierOperationError) throw error;
      throw new EasyTierOperationError(error instanceof CommunityEtTransportError && error.code === 'provider-unavailable' ? 'configuration-required' : 'connect-failed');
    } finally { if (this.authPending.get(input.serverId) === pending) this.authPending.delete(input.serverId); }
  }
  private sameIntent(a: TrustedCommunityIntent, b: TrustedCommunityIntent): boolean {
    return ['networkName', 'networkRevision', 'virtualIp', 'bootstrapProfileId'].every(k => a[k as keyof TrustedCommunityIntent] === b[k as keyof TrustedCommunityIntent]);
  }
  private body(c: Context, requestId: string) {
    return {v: 1, communityId: c.verified.intent.communityId, deviceId: c.verified.intent.deviceId,
      nativeInstanceId: c.verified.intent.nativeInstanceId, requestId};
  }
  private current(c: Context): void {
    if (this.stopped || c.retired || this.contexts.get(c.target.communityId) !== c) throw new EasyTierOperationError('connect-failed');
  }
  private async acquire(c: Context, signal: AbortSignal): Promise<void> {
    this.current(c);
    c.gate = new MainGrantGate(c.verified.intent, () => ({wallMs: this.ports.wallMs(), monoMs: Math.floor(this.ports.monoMs())}),
      {maxTtlMs: 300_000, revisionFloor: c.revisionFloor});
    const requestId = randomUUID(), ticket = c.gate.begin('acquire', requestId);
    const value = await this.ports.transport.post(c.target, 'acquire', c.bearer, this.body(c, requestId), combined(signal, c.cancel.signal));
    this.current(c); c.gate.accept(ticket, value); this.accepted(c, ticket.startedMonoMs);
  }
  private accepted(c: Context, startedMonoMs: number): void {
    const grant = c.gate.privateGrantForConfig()!, now = Math.floor(this.ports.monoMs());
    c.revisionFloor = grant.revision;
    c.lastGrantId = grant.grantId;
    c.renewDueMono = now + Math.max(0, grant.renewAfterMs - grant.serverTimeMs - (now - startedMonoMs));
    c.grantExpiresMono = now + grant.expiresAtMs - grant.serverTimeMs - (now - startedMonoMs);
  }
  private async renew(c: Context, signal: AbortSignal): Promise<void> {
    if (c.pendingRenew) return c.pendingRenew;
    const grant = c.gate.privateGrantForConfig(); if (!grant) throw new EasyTierOperationError('connect-failed');
    const requestId = randomUUID(), ticket = c.gate.begin('renew', requestId);
    const work = this.ports.transport.post(c.target, 'renew', c.bearer, {...this.body(c, requestId), grantId: grant.grantId}, combined(signal, c.cancel.signal))
      .then(value => { this.current(c); c.gate.accept(ticket, value); this.accepted(c, ticket.startedMonoMs); });
    c.pendingRenew = work;
    try { await work; } finally { if (c.pendingRenew === work) c.pendingRenew = null; }
  }
  async configuration(serverId: string, signal: AbortSignal): Promise<EasyTierExistingConfiguration> {
    const c = this.contexts.get(serverId);
    if (!c || signal.aborted || !c.configuration || !c.gate.privateGrantForConfig()) throw new EasyTierOperationError('configuration-required');
    this.current(c); return structuredClone(c.configuration);
  }
  private async retire(c: Context): Promise<void> {
    if (c.retireFlight) return c.retireFlight;
    const work = this.performRetire(c); c.retireFlight = work;
    try { await work; } finally { if (c.retireFlight === work) c.retireFlight = null; }
  }
  private async performRetire(c: Context): Promise<void> {
    if (c.lastGrantId && !c.pendingRevoke) c.pendingRevoke = {grantId: c.lastGrantId};
    c.cancel.abort(); c.gate.close();
    // First stop the exact owned instance; a backend outage must not leave TUN alive.
    await c.closeNative?.(); c.closeNative = null;
    await c.removeConfig?.(); c.removeConfig = null; c.configuration = null;
    if (c.pendingRevoke) {
      const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 4000);
      try {
        const result = await this.ports.transport.post(c.target, 'revoke', c.bearer, {...this.body(c, randomUUID()), grantId: c.pendingRevoke.grantId}, abort.signal);
        exact<{v: number; revoked: boolean}>(result, ['v', 'revoked'], 'invalid-revocation-result');
        if (result.v !== 1 || result.revoked !== true) throw new EasyTierOperationError('cleanup-failed');
        c.pendingRevoke = null;
        c.lastGrantId = null;
      }
      finally { clearTimeout(timer); }
    }
  }
  private async retired(c: Context, reason: 'configuration-required' | 'runtime-exited'): Promise<never> {
    c.retired = true;
    try { await this.retire(c); }
    catch { throw new EasyTierSessionRetiredError('cleanup-failed'); }
    throw new EasyTierSessionRetiredError(reason);
  }
  /** Ordinary app quit waits for private config removal and confirmed backend cleanup. */
  async drainOwned(): Promise<void> {
    if (!this.stopped) throw new EasyTierOperationError('cleanup-failed');
    const outcomes = await Promise.allSettled([...this.contexts.values()].map(c => this.retire(c)));
    if (outcomes.some(result => result.status === 'rejected')) throw new EasyTierOperationError('cleanup-failed');
  }
  wrap(runtime: EasyTierRuntime): EasyTierRuntime {
    return {activationReason: () => runtime.activationReason(), shutdownOwned: () => {
      this.stopped = true; for (const p of this.authPending.values()) p.abort();
      for (const c of this.contexts.values()) { c.retired = true; c.cancel.abort(); void this.retire(c).catch(() => undefined); }
      runtime.shutdownOwned();
    }, connect: async scope => {
      const c = this.contexts.get(scope.serverId); if (!c) throw new EasyTierOperationError('configuration-required');
      this.current(c);
      // Provisioner approval is re-read immediately before a credential mutation.
      const target = await this.ports.target(scope.serverId);
      if (JSON.stringify(target) !== JSON.stringify(c.target)) throw new EasyTierOperationError('configuration-required');
      if (c.pendingRevoke) await this.retire(c);
      c.cancel = new AbortController(); const signal = combined(scope.signal, c.cancel.signal);
      let physical: EasyTierSession | null = null;
      try {
        await this.acquire(c, signal);
        const grant = c.gate.privateGrantForConfig()!;
        const draft = buildCommunityEtConfig(c.gate, c.verified.intent, c.target.bootstrap);
        const owned = await this.ports.write(scope.serverId, c.verified.intent.nativeInstanceId, c.verified.intent.networkName, draft, signal);
        c.removeConfig = owned.remove; c.configuration = {...owned.config, credentialIdentity: {
          networkName: grant.networkName, virtualIp: grant.virtualIp, publicKeyFingerprint: grant.publicKeyFingerprint,
          issuerPublicKeyFingerprint: c.target.bootstrap.issuerPublicKeyFingerprint}};
        this.current(c); if (signal.aborted) throw new Error('cancelled');
        physical = await runtime.connect({...scope, signal}); c.closeNative = physical.close;
        this.current(c);
        if (!c.gate.privateGrantForConfig() || signal.aborted) throw new EasyTierOperationError('runtime-exited');
        let closed = false;
        return {instanceId: physical.instanceId, close: async () => {
          if (closed) return; await this.retire(c); closed = true;
        }, read: async readSignal => {
          this.current(c); const active = c.gate.privateGrantForConfig();
          if (!active) return this.retired(c, 'runtime-exited');
          try {
            const approved = await this.ports.target(scope.serverId);
            if (JSON.stringify(approved) !== JSON.stringify(c.target)) throw new Error('policy-changed');
          } catch { return this.retired(c, 'configuration-required'); }
          if (Math.floor(this.ports.monoMs()) >= c.renewDueMono) {
            try { await this.renew(c, readSignal); }
            catch (error) {
              if (error instanceof CommunityEtTransportError && error.code === 'auth-unavailable') return this.retired(c, 'configuration-required');
              throw error;
            }
          }
          if (!physical!.readCredentialSample) throw new EasyTierOperationError('status-unavailable');
          const {sample, observation} = await physical!.readCredentialSample(combined(readSignal, c.cancel.signal));
          c.gate.acceptOwnedNode({peerId: observation.peerId, virtualIp: observation.virtualIp, publicKeyB64: observation.publicKeyB64,
            nativeInstanceId: c.verified.intent.nativeInstanceId, runtimeGeneration: scope.generation,
            networkName: c.verified.intent.networkName, observedMonoMs: Math.floor(this.ports.monoMs())}, scope.generation);
          const grant = c.gate.privateGrantForConfig();
          if (!grant) return this.retired(c, 'runtime-exited');
          const started = Math.floor(this.ports.monoMs());
          let proof: unknown;
          try {
            proof = await this.ports.transport.post(c.target, 'binding', c.bearer, {v: 1,
              communityId: grant.scope.communityId, deviceId: grant.scope.deviceId,
              nativeInstanceId: grant.scope.nativeInstanceId, grantId: grant.grantId}, combined(readSignal, c.cancel.signal));
          } catch (error) {
            if (error instanceof CommunityEtTransportError && error.code === 'auth-unavailable') return this.retired(c, 'configuration-required');
            throw error;
          }
          this.current(c);
          const live = c.gate.privateGrantForConfig();
          if (!live) return this.retired(c, 'runtime-exited');
          if (readSignal.aborted || live.grantId !== grant.grantId || live.revision !== grant.revision)
            throw new EasyTierOperationError('status-unavailable');
          const binding = projectCommunityEtBinding(proof, live, c.verified, observation, sample, started,
            Math.floor(this.ports.monoMs()), this.ports.wallMs(), c.grantExpiresMono);
          return {...sample, bindings: [binding]};
        }};
      } catch (error) {
        if (physical) c.closeNative = physical.close;
        try { await this.retire(c); } catch { throw new EasyTierOperationError('cleanup-failed'); }
        if (error instanceof EasyTierOperationError) throw error;
        throw new EasyTierOperationError('connect-failed');
      }
    }};
  }
}

export function createCommunityEtGrantRuntime(root: () => string): CommunityEtGrantRuntime {
  const files = new CommunityEtOwnedFiles(root);
  return new CommunityEtGrantRuntime({target: serverId => readCommunityGrantTarget(root(), serverId),
    identities: serverId => files.identities(serverId), write: (...args) => files.write(...args),
    transport: new CommunityEtGrantTransport(), wallMs: () => Date.now(), monoMs: () => performance.now()});
}
