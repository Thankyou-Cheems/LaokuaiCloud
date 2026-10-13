import { createHash, randomUUID } from 'node:crypto';

import type { CommunityNetworkPreferences } from '../src/lib/communityNetworkPreferences';
import type { CommunityRelayState } from '../src/lib/communityRelay';
import type { CommunityDnsPolicy } from './communityDnsPolicy';
import { parseCommunityDnsDirectory } from './communityDnsResolver';
import { projectCommunityEtBinding } from './communityEtBindingProjection';
import { buildCommunityEtConfig } from './communityEtConfig';
import { communityIdentity, exact, MainGrantGate, sameScope, type TrustedCommunityIntent } from './communityEtGrant';
import { CommunityEtGrantTransport, type CommunityEtHttpDiagnostic,CommunityEtTransportError, type TrustedCommunityTarget, validCommunityBearer, type VerifiedCommunitySession } from './communityEtGrantTransport';
import type {CommunityAcquireRequestV1, CommunityBindingProofV1, CommunityBindingRequestV1, CommunityDirectoryMemberV1} from './communityEtHttpContract';
import { CommunityEtOwnedFiles, readCommunityGrantTarget } from './communityEtTrustedConfiguration';
import { type CommunityRelayPreferenceStore,CommunityRelayRuntime, parseRelayPreference } from './communityRelayRuntime';
import { EasyTierOperationError, type EasyTierRuntime, type EasyTierSession,EasyTierSessionRetiredError } from './easyTierCommunityManager';
import type { EasyTierExistingConfiguration } from './easyTierExistingConfiguration';

interface AuthInput { serverId: string; host: string; accessToken: string | null }
export type CommunityEtRuntimeDiagnostic = CommunityEtHttpDiagnostic | {
  event: 'core-start' | 'core-stop'; action: 'start' | 'finish'; generation: number;
  code: 'success' | 'connect-failed' | 'cleanup-failed';
};
interface Context {
  target: TrustedCommunityTarget; bearer: string; verified: VerifiedCommunitySession; gate: MainGrantGate;
  cancel: AbortController; configuration: EasyTierExistingConfiguration | null; removeConfig: (() => Promise<void>) | null;
  closeNative: (() => Promise<void>) | null; pendingRenew: Promise<void> | null; revisionFloor: number;
  retireFlight: Promise<void> | null;
  relay: CommunityRelayRuntime | null;
  mutationTail: Promise<void>;
  recentGrants: Array<{grant: import('./communityEtGrant').PrivateCommunityGrantV1; expiresMono: number; acceptedMono: number}>;
  renewDueMono: number; grantExpiresMono: number; lastGrantId: string | null; retired: boolean; pendingRevoke: {grantId: string} | null;
  directory: { fetchedAtMono: number; observedAtUnixMs: number; members: CommunityDirectoryMemberV1[]; pending: Promise<CommunityDirectoryMemberV1[]> | null;
    dns: Array<{dnsName: string; virtualIp: string; expiresAtUnixMs: number; expiresAtMono: number}> };
}
export interface CommunityEtGrantRuntimePorts {
  target(serverId: string): Promise<TrustedCommunityTarget>;
  identities(serverId: string): Promise<{deviceId: string; nativeInstanceId: string}>;
  write: CommunityEtOwnedFiles['write'];
  transport: CommunityEtGrantTransport;
  dns?: Pick<CommunityDnsPolicy, 'publish' | 'clear' | 'isReady'>;
  preferences?(): CommunityNetworkPreferences;
  relayPreferences?: CommunityRelayPreferenceStore;
  diagnostic?(event: CommunityEtRuntimeDiagnostic): void;
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
  private report(event: CommunityEtRuntimeDiagnostic): void {
    try { this.ports.diagnostic?.(event); } catch { /* Diagnostics never affect owned resources. */ }
  }
  async setAuthenticatedSession(input: unknown): Promise<{serverId: string; changed: boolean; authenticated: boolean}> {
    exact<AuthInput>(input, ['serverId', 'host', 'accessToken'], 'invalid-community-auth');
    if (!communityIdentity(input.serverId) || typeof input.host !== 'string' || input.host.length > 256 ||
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
        configuration: null, removeConfig: null, closeNative: null, pendingRenew: null, retireFlight: null, relay: null, mutationTail: Promise.resolve(), recentGrants: [], revisionFloor: 0,
        renewDueMono: Infinity, grantExpiresMono: 0, lastGrantId: null, retired: false, pendingRevoke: null,
        directory: {fetchedAtMono: -Infinity, observedAtUnixMs: 0, members: [], pending: null, dns: []}});
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
  getRelayState(serverId: string): CommunityRelayState {
    const c = this.contexts.get(serverId);
    if (c && !c.retired) return this.relay(c).snapshot();
    return {v: 1, serverId, desiredEnabled: false, desiredBytesPerSecond: 0, status: 'off', reason: 'not-connected',
      confirmedEnabled: false, localBudgetApplied: false, bytesPerSecond: 0, leaseExpiresAtMs: null};
  }
  async setRelayPreference(value: unknown): Promise<CommunityRelayState> {
    const preference = parseRelayPreference(value), c = this.contexts.get(preference.serverId);
    if (!c) throw new EasyTierOperationError('configuration-required');
    this.current(c); return this.relay(c).set({enabled: preference.enabled, bytesPerSecond: preference.bytesPerSecond});
  }
  private relay(c: Context): CommunityRelayRuntime {
    if (c.relay) return c.relay;
    const i = c.verified.intent;
    const scopeKey = createHash('sha256').update(JSON.stringify([i.serverInstanceId, i.accountId, i.communityId, i.deviceId, i.nativeInstanceId])).digest('hex');
    c.relay = new CommunityRelayRuntime({serverId: c.target.communityId, intent: i,
      grant: () => c.gate.privateGrantForConfig(),
      mutate: (work, signal) => this.mutate(c, work, signal),
      post: (operation, body, signal) => this.ports.transport.post(c.target, operation, c.bearer, body, combined(signal, c.cancel.signal)),
      accept: (grant, startedMono) => {
        this.current(c); const current = c.gate.privateGrantForConfig();
        if (!current || current.revision >= grant.revision) throw new Error('relay-grant-mismatch');
        let begin = true;
        const gate = new MainGrantGate(c.verified.intent, () => ({wallMs: this.ports.wallMs(),
          monoMs: begin ? startedMono : Math.floor(this.ports.monoMs())}), {maxTtlMs: 300000, revisionFloor: c.revisionFloor});
        const ticket = gate.begin('acquire', grant.requestId); begin = false;
        gate.accept(ticket, grant); c.gate.close(); c.gate = gate; this.accepted(c, startedMono);
      }, wallMs: this.ports.wallMs, monoMs: this.ports.monoMs,
      save: preference => this.ports.relayPreferences?.write(scopeKey, preference)}, this.ports.relayPreferences?.read(scopeKey));
    return c.relay;
  }
  private body(c: Context, requestId: string): CommunityAcquireRequestV1 {
    return {v: 1, communityId: c.verified.intent.communityId, deviceId: c.verified.intent.deviceId,
      nativeInstanceId: c.verified.intent.nativeInstanceId, requestId};
  }
  private current(c: Context): void {
    if (this.stopped || c.retired || this.contexts.get(c.target.communityId) !== c) throw new EasyTierOperationError('connect-failed');
  }
  private async mutate(c: Context, work: () => Promise<void>, signal: AbortSignal): Promise<void> {
    const flight = c.mutationTail.catch(() => undefined).then(() => {
      if (signal.aborted) throw new CommunityEtTransportError('request-cancelled');
      this.current(c); return work();
    });
    c.mutationTail = flight.catch(() => undefined);
    if (signal.aborted) throw new CommunityEtTransportError('request-cancelled');
    let abort: (() => void) | null = null;
    try {
      await Promise.race([flight, new Promise<never>((_resolve, reject) => {
        abort = () => reject(new CommunityEtTransportError('request-cancelled')); signal.addEventListener('abort', abort, {once: true});
      })]);
    } finally { if (abort) signal.removeEventListener('abort', abort); }
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
    c.recentGrants = [...c.recentGrants.filter(row => now - row.acceptedMono < 5000),
      {grant, expiresMono: c.grantExpiresMono, acceptedMono: now}].slice(-8);
  }
  private async renew(c: Context, signal: AbortSignal): Promise<void> {
    if (c.pendingRenew) return c.pendingRenew;
    const work = this.mutate(c, async () => {
      const grant = c.gate.privateGrantForConfig(); if (!grant) throw new EasyTierOperationError('connect-failed');
      const requestId = randomUUID(), ticket = c.gate.begin('renew', requestId);
      const value = await this.ports.transport.post(c.target, 'renew', c.bearer, {...this.body(c, requestId), grantId: grant.grantId}, combined(signal, c.cancel.signal));
      this.current(c); c.gate.accept(ticket, value); this.accepted(c, ticket.startedMonoMs);
    }, combined(signal, c.cancel.signal));
    c.pendingRenew = work;
    try { await work; } finally { if (c.pendingRenew === work) c.pendingRenew = null; }
  }
  /**
   * Fetch the authenticated server roster at a low rate. A roster outage must
   * not take down ET itself; only an authentication failure retires the session.
   */
  private async directory(c: Context, signal: AbortSignal): Promise<CommunityDirectoryMemberV1[]> {
    const now = Math.floor(this.ports.monoMs());
    const requestedAtUnixMs = this.ports.wallMs();
    if (now - c.directory.fetchedAtMono < 5000) return c.directory.members;
    if (c.directory.pending) return c.directory.pending;
    const work = (async () => {
      // The optional roster must not consume the required LAN telemetry budget.
      const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), 1000);
      try {
        const body = {v: 1 as const, communityId: c.verified.intent.communityId};
        const readSignal = combined(signal, c.cancel.signal, timeout.signal);
        let withDns = !!this.ports.dns && (this.ports.preferences?.().magicDns ?? true);
        let value: unknown;
        try {
          value = await this.ports.transport.post(c.target, 'directory', c.bearer,
            {...body, ...(withDns ? {includeDnsNames: true, dnsNameStyle: 'friendly'} : {})}, readSignal);
        } catch (error) {
          // Negotiate only an explicit optional-extension rejection. Authentication,
          // outages, malformed replies and clock/TTL failures never downgrade.
          if (!withDns || readSignal.aborted || !(error instanceof CommunityEtTransportError) || error.code !== 'directory-extension-unsupported') throw error;
          try {
            value = await this.ports.transport.post(c.target, 'directory', c.bearer, {...body, includeDnsNames: true}, readSignal);
          } catch (legacyError) {
            if (readSignal.aborted || !(legacyError instanceof CommunityEtTransportError) || legacyError.code !== 'directory-extension-unsupported') throw legacyError;
            withDns = false;
            value = await this.ports.transport.post(c.target, 'directory', c.bearer, body, readSignal);
          }
        }
        if (signal.aborted || c.cancel.signal.aborted) throw new CommunityEtTransportError('request-cancelled');
        if (timeout.signal.aborted) throw new CommunityEtTransportError('provider-unavailable');
        let members: CommunityDirectoryMemberV1[];
        if (withDns && this.ports.dns) {
          try {
            const parsed = parseCommunityDnsDirectory(value, c.verified.intent.communityId);
            members = parsed.members.map(({serverUserId, virtualIp}) => ({serverUserId, virtualIp}));
            this.current(c);
            this.ports.dns.publish(c.verified.intent.communityId, parsed, now, requestedAtUnixMs);
            c.directory.dns = parsed.members.map(row => ({dnsName: row.dnsName, virtualIp: row.virtualIp,
              expiresAtUnixMs: requestedAtUnixMs + row.dnsExpiresAtMs - parsed.dns.serverTimeMs,
              expiresAtMono: now + row.dnsExpiresAtMs - parsed.dns.serverTimeMs}));
          } catch { throw new CommunityEtTransportError('invalid-response'); }
        } else {
          members = this.ports.transport.parseDirectory(value, c.verified.intent.communityId);
          this.current(c); c.directory.dns = []; this.ports.dns?.clear(c.verified.intent.communityId);
        }
        this.current(c); c.directory.fetchedAtMono = now; c.directory.observedAtUnixMs = requestedAtUnixMs; c.directory.members = members;
        return members;
      } catch (error) {
        if (this.contexts.get(c.target.communityId) === c) {
          c.directory.dns = []; this.ports.dns?.clear(c.verified.intent.communityId);
        }
        if (signal.aborted || c.cancel.signal.aborted) throw new CommunityEtTransportError('request-cancelled');
        if (error instanceof CommunityEtTransportError && error.code === 'auth-unavailable') return this.retired(c, 'configuration-required');
        if (error instanceof CommunityEtTransportError && (error.code === 'provider-unavailable' || error.code === 'invalid-response' ||
            (error.code === 'request-cancelled' && timeout.signal.aborted && !signal.aborted && !c.cancel.signal.aborted))) {
          // Do not relabel the old response as fresh on an outage or malformed roster.
          this.current(c); c.directory.fetchedAtMono = now; c.directory.members = []; c.directory.observedAtUnixMs = 0; return [];
        }
        throw error;
      } finally { clearTimeout(timer); }
    })();
    c.directory.pending = work;
    try { return await work; } finally { if (c.directory.pending === work) c.directory.pending = null; }
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
    c.recentGrants = [];
    const relayDrain = c.relay?.detach();
    this.ports.dns?.clear(c.verified.intent.communityId);
    // First stop the exact owned instance; a backend outage must not leave TUN alive.
    await c.closeNative?.(); c.closeNative = null;
    await relayDrain;
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
      let closeNative: (() => Promise<void>) | null = null;
      try {
        await runtime.assertReady?.(signal);
        await this.acquire(c, signal);
        const grant = c.gate.privateGrantForConfig()!;
        const draft = buildCommunityEtConfig(c.gate, c.verified.intent, c.target.bootstrap, this.ports.preferences?.());
        const owned = await this.ports.write(scope.serverId, c.verified.intent.nativeInstanceId, c.verified.intent.networkName, draft, signal);
        c.removeConfig = owned.remove; c.configuration = {...owned.config, credentialIdentity: {
          networkName: grant.networkName, virtualIp: grant.virtualIp, publicKeyFingerprint: grant.publicKeyFingerprint,
          issuerPublicKeyFingerprint: c.target.bootstrap.issuerPublicKeyFingerprint}};
        this.current(c); if (signal.aborted) throw new Error('cancelled');
        this.report({event: 'core-start', action: 'start', generation: scope.generation, code: 'success'});
        try { physical = await runtime.connect({...scope, signal}); }
        catch (error) { this.report({event: 'core-start', action: 'finish', generation: scope.generation, code: 'connect-failed'}); throw error; }
        this.report({event: 'core-start', action: 'finish', generation: scope.generation, code: 'success'});
        const ownedPhysical = physical;
        closeNative = async () => {
          this.report({event: 'core-stop', action: 'start', generation: scope.generation, code: 'success'});
          try {
            await ownedPhysical.close();
            this.report({event: 'core-stop', action: 'finish', generation: scope.generation, code: 'success'});
          } catch (error) { this.report({event: 'core-stop', action: 'finish', generation: scope.generation, code: 'cleanup-failed'}); throw error; }
        };
        c.closeNative = closeNative;
        // Startup TOML already denies relay. Optional capability readback cannot
        // consume the required LAN connect deadline.
        void this.relay(c).attach(physical.applyRelayBudget).catch(() => undefined);
        this.current(c);
        if (!c.gate.privateGrantForConfig() || signal.aborted) throw new EasyTierOperationError('runtime-exited');
        let closed = false;
        return {instanceId: physical.instanceId, close: async () => {
          if (closed) return; await this.retire(c); closed = true;
        }, read: async readSignal => {
          try {
          this.current(c); const active = c.gate.privateGrantForConfig();
          if (!active) return this.retired(c, 'runtime-exited');
          try {
            const approved = await this.ports.target(scope.serverId);
            if (JSON.stringify(approved) !== JSON.stringify(c.target)) throw new Error('policy-changed');
          } catch { return this.retired(c, 'configuration-required'); }
          if (Math.floor(this.ports.monoMs()) >= c.renewDueMono) {
            // Required renewal has priority: cancel optional HTTPS immediately;
            // zero budget runs independently and cannot hold the LAN deadline.
            void c.relay?.suspend('backend-unavailable').catch(() => undefined);
            try { await this.renew(c, readSignal); }
            catch (error) {
              if (error instanceof CommunityEtTransportError && error.code === 'auth-unavailable') return this.retired(c, 'configuration-required');
              throw error;
            }
          }
          if (!physical!.readCredentialSample) throw new EasyTierOperationError('status-unavailable');
          const {sample, observation} = await physical!.readCredentialSample(combined(readSignal, c.cancel.signal)).catch(error => {
            // CLI/RPC adapters use runtime-exited for an aborted read as well.
            // A telemetry deadline is not evidence that the owned core died.
            if (readSignal.aborted || c.cancel.signal.aborted) throw new EasyTierOperationError('status-unavailable', readSignal.aborted ? 'timeout' : 'cancelled');
            if (error instanceof EasyTierOperationError && error.reason === 'runtime-exited') return this.retired(c, 'runtime-exited');
            throw error;
          });
          c.gate.acceptOwnedNode({peerId: observation.peerId, virtualIp: observation.virtualIp, publicKeyB64: observation.publicKeyB64,
            nativeInstanceId: c.verified.intent.nativeInstanceId, runtimeGeneration: scope.generation,
            networkName: c.verified.intent.networkName, observedMonoMs: Math.floor(this.ports.monoMs())}, scope.generation);
          const grant = c.gate.privateGrantForConfig();
          if (!grant) return this.retired(c, 'runtime-exited');
          const grantExpiresMono = c.grantExpiresMono;
          const started = Math.floor(this.ports.monoMs());
          let proof: unknown;
          try {
            const body: CommunityBindingRequestV1 = {v: 1,
              communityId: grant.scope.communityId, deviceId: grant.scope.deviceId,
              nativeInstanceId: grant.scope.nativeInstanceId, grantId: grant.grantId};
            proof = await this.ports.transport.post(c.target, 'binding', c.bearer, body, combined(readSignal, c.cancel.signal));
          } catch (error) {
            if (error instanceof CommunityEtTransportError && error.code === 'auth-unavailable') return this.retired(c, 'configuration-required');
            throw error;
          }
          this.current(c);
          const live = c.gate.privateGrantForConfig();
          if (!live) return this.retired(c, 'runtime-exited');
          if (readSignal.aborted || c.cancel.signal.aborted || live.grantId !== grant.grantId || live.credentialId !== grant.credentialId ||
              live.publicKeyFingerprint !== grant.publicKeyFingerprint || live.virtualIp !== grant.virtualIp)
            throw new EasyTierOperationError('status-unavailable');
          exact<CommunityBindingProofV1>(proof, ['v', 'serverUserId', 'scope', 'grantId', 'credentialId', 'revision',
            'peerId', 'virtualIp', 'publicKeyFingerprint', 'physicalDirectVerified'], 'invalid-binding-response');
          // A background same-key qualification change can commit while binding
          // is in flight. Use only a revision actually accepted here, preserving
          // the old proof's expiry; no revision or address is fabricated.
          const historical = c.recentGrants.find(row => row.grant.revision === proof.revision &&
            row.grant.grantId === live.grantId && Math.floor(this.ports.monoMs()) - row.acceptedMono < 5000);
          const boundGrant = proof.revision === live.revision ? live : proof.revision === grant.revision ? grant : historical?.grant;
          if (!boundGrant) throw new EasyTierOperationError('status-unavailable');
          const binding = projectCommunityEtBinding(proof, boundGrant, c.verified, observation, sample, started,
            Math.floor(this.ports.monoMs()), this.ports.wallMs(), Math.min(c.grantExpiresMono,
              proof.revision === grant.revision ? grantExpiresMono : historical?.expiresMono ?? c.grantExpiresMono));
          if ((sample.info as {running?: unknown} | null)?.running === true)
            void c.relay?.observe(Math.floor(sample.acquisitionStartedAtMs ?? sample.acquiredAtMs),
              sample.acquisitionStartedAtUnixMs ?? sample.acquiredAtUnixMs, c.cancel.signal).catch(() => undefined);
          else void c.relay?.suspend('telemetry-stale').catch(() => undefined);
          const directory = await this.directory(c, readSignal);
          const dnsReady = this.ports.dns?.isReady(c.verified.intent.communityId) === true;
          const dnsAddresses = dnsReady ? c.directory.dns.filter(row => this.ports.monoMs() < row.expiresAtMono &&
            this.ports.wallMs() < row.expiresAtUnixMs && this.ports.wallMs() >= c.directory.observedAtUnixMs)
            .map(({dnsName, virtualIp, expiresAtUnixMs}) => ({dnsName, virtualIp, expiresAtUnixMs})) : [];
          return {...sample, bindings: [binding], directory, directoryObservedAtUnixMs: c.directory.observedAtUnixMs, dnsReady, dnsAddresses};
          } catch (error) { void c.relay?.suspend('telemetry-stale').catch(() => undefined); throw error; }
        }};
      } catch (error) {
        if (physical) c.closeNative = closeNative ?? physical.close;
        try { await this.retire(c); } catch { throw new EasyTierOperationError('cleanup-failed'); }
        if (error instanceof EasyTierOperationError) throw error;
        throw new EasyTierOperationError('connect-failed');
      }
    }};
  }
}

export function createCommunityEtGrantRuntime(root: () => string, dns?: CommunityEtGrantRuntimePorts['dns'], preferences?: CommunityEtGrantRuntimePorts['preferences'], relayPreferences?: CommunityRelayPreferenceStore,
  diagnostic?: CommunityEtGrantRuntimePorts['diagnostic']): CommunityEtGrantRuntime {
  const files = new CommunityEtOwnedFiles(root);
  return new CommunityEtGrantRuntime({target: serverId => readCommunityGrantTarget(root(), serverId),
    identities: serverId => files.identities(serverId), write: (...args) => files.write(...args),
    transport: new CommunityEtGrantTransport(undefined, diagnostic), diagnostic, dns, preferences, relayPreferences, wallMs: () => Date.now(), monoMs: () => performance.now()});
}
