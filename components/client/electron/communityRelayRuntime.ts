import { randomUUID } from 'node:crypto';

import type { CommunityRelayState, RelayPreferenceV1, StoredRelayPreference } from '../src/lib/communityRelay';
import { communityIdentity, exact, grantShape, MainGrantGate, natural, type PrivateCommunityGrantV1, sameScope, type TrustedCommunityIntent } from './communityEtGrant';

export interface RelayConsentV2 { v: 2; enabled: boolean; revision: number; bytesPerSecond: number }
export interface RelayBudgetReceipt {
  schemaVersion: 1; capability: 'member-relay-budget-lease-v1'; instanceId: string;
  bytesPerSec: number | null; leaseRemainingMs: number; maxLeaseMs: 15000; applied: boolean;
}
export type ApplyRelayBudget = (bytesPerSecond: number, leaseMs: number, signal: AbortSignal) => Promise<RelayBudgetReceipt>;
export interface CommunityRelayPreferenceStore {
  read(scopeKey: string): StoredRelayPreference | null;
  write(scopeKey: string, value: StoredRelayPreference): void;
}
const GRANT_KEYS = ['v', 'requestId', 'scope', 'grantId', 'credentialId', 'revision', 'networkName', 'networkRevision',
  'virtualIp', 'bootstrapProfileId', 'issuedAtMs', 'serverTimeMs', 'renewAfterMs', 'expiresAtMs', 'publicKeyFingerprint', 'credentialSecretB64', 'policy'];
export function relayConsent(value: unknown): asserts value is RelayConsentV2 {
  exact<RelayConsentV2>(value, ['v', 'enabled', 'revision', 'bytesPerSecond']);
  if (value.v !== 2 || typeof value.enabled !== 'boolean' || !natural(value.revision) ||
      (value.enabled ? value.revision < 1 || !validRelayBudget(value.bytesPerSecond) : value.bytesPerSecond !== 0)) throw new Error('invalid-relay-consent');
}
export const validRelayBudget = (value: unknown): value is number => natural(value) && value >= 1024 && value <= 1048576;
export function parseRelayPreference(value: unknown): RelayPreferenceV1 {
  exact<RelayPreferenceV1>(value, ['v', 'serverId', 'enabled', 'bytesPerSecond']);
  if (value.v !== 1 || !communityIdentity(value.serverId) || typeof value.enabled !== 'boolean' ||
      (value.enabled ? !validRelayBudget(value.bytesPerSecond) : value.bytesPerSecond !== 0)) throw new Error('invalid-relay-preference');
  return structuredClone(value);
}
/** Validate qualification independently, then project ordinary LAN permissions for
 * the unchanged strict V1 gate. This does not claim issuer allowRelay is false. */
export function parseRelayResponse(value: unknown, previous: PrivateCommunityGrantV1, intent: TrustedCommunityIntent,
  requestId: string, startedMono: number, wallMs: number, monoMs: number): {grant: PrivateCommunityGrantV1; consent: RelayConsentV2; confirmed: RelayConsentV2} {
  exact<{v: number; consent: RelayConsentV2; grant: Record<string, unknown>}>(value, ['v', 'consent', 'grant']);
  if (value.v !== 2) throw new Error('invalid-relay-response');
  relayConsent(value.consent); exact(value.grant, GRANT_KEYS);
  const policy = value.grant.policy;
  exact<{reusable: boolean; allowRelay: boolean; allowedProxyCidrs: unknown[]; relay: RelayConsentV2}>(policy,
    ['reusable', 'allowRelay', 'allowedProxyCidrs', 'relay']);
  relayConsent(policy.relay);
  if (value.grant.v !== 2 || policy.reusable !== false || policy.allowRelay !== policy.relay.enabled ||
      policy.relay.revision > value.consent.revision) throw new Error('invalid-relay-policy');
  const projected = {...value.grant, v: 1, policy: {reusable: false, allowRelay: false, allowedProxyCidrs: policy.allowedProxyCidrs}};
  grantShape(projected);
  if (projected.requestId !== requestId || !sameScope(projected.scope, previous.scope) ||
      ['grantId', 'credentialId', 'publicKeyFingerprint', 'credentialSecretB64', 'networkName', 'networkRevision', 'virtualIp', 'bootstrapProfileId']
        .some(k => projected[k as keyof PrivateCommunityGrantV1] !== previous[k as keyof PrivateCommunityGrantV1]) || projected.revision < previous.revision)
    throw new Error('relay-grant-mismatch');
  // A temporary strict gate validates scope, keys, TTL and transit without relaxing V1.
  const clock = {wallMs, monoMs: startedMono};
  const gate = new MainGrantGate(intent, () => clock, {maxTtlMs: 300000});
  const ticket = gate.begin('acquire', requestId); clock.monoMs = monoMs; gate.accept(ticket, projected);
  if (projected.revision === previous.revision && ['issuedAtMs', 'renewAfterMs', 'expiresAtMs']
    .some(k => projected[k as keyof PrivateCommunityGrantV1] !== previous[k as keyof PrivateCommunityGrantV1])) throw new Error('relay-grant-mismatch');
  if (projected.expiresAtMs < previous.expiresAtMs) throw new Error('relay-grant-mismatch');
  return {grant: projected, consent: structuredClone(value.consent), confirmed: structuredClone(policy.relay)};
}
export function parseRelayBudgetReceipt(value: unknown, instanceId: string, budget: number, leaseMs: number): RelayBudgetReceipt {
  exact<RelayBudgetReceipt>(value, ['schemaVersion', 'capability', 'instanceId', 'bytesPerSec', 'leaseRemainingMs', 'maxLeaseMs', 'applied']);
  if (value.schemaVersion !== 1 || value.capability !== 'member-relay-budget-lease-v1' || value.instanceId !== instanceId ||
      value.bytesPerSec !== budget || value.maxLeaseMs !== 15000 || value.applied !== true || !natural(value.leaseRemainingMs) ||
      (budget === 0 ? leaseMs !== 0 || value.leaseRemainingMs !== 0 : leaseMs < 1 || leaseMs > 15000 || value.leaseRemainingMs < 1 || value.leaseRemainingMs > leaseMs))
    throw new Error('native-relay-unconfirmed');
  return structuredClone(value);
}
export interface CommunityRelayPorts {
  serverId: string; intent: TrustedCommunityIntent; grant(): PrivateCommunityGrantV1 | null;
  post(operation: 'relay' | 'relay-renew' | 'relay-status', body: unknown, signal: AbortSignal): Promise<unknown>;
  accept(grant: PrivateCommunityGrantV1, startedMono: number): void;
  /** Serialize credential mutations with the ordinary LAN renewal path. */
  mutate?(work: () => Promise<void>, signal: AbortSignal): Promise<void>;
  wallMs(): number; monoMs(): number;
  save?(preference: StoredRelayPreference): void;
}
/** Optional controller. Every positive native lease requires a new authenticated
 * reply and a fresh owned telemetry sample. No voice state or timer can renew it. */
export class CommunityRelayRuntime {
  private desired: StoredRelayPreference = {enabled: false, bytesPerSecond: 0};
  private state: CommunityRelayState;
  private apply: ApplyRelayBudget | null = null;
  private ready = false; private epoch = 0; private cancel = new AbortController();
  private nativeTail: Promise<void> = Promise.resolve(); private flight: Promise<void> | null = null;
  private nextMono = -Infinity; private deadlineMono = 0; private deadlineWall = 0; private sampleMono = -Infinity; private sampleWall = 0;
  private needSync = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private withdrawalRetry: ReturnType<typeof setTimeout> | null = null;
  constructor(private ports: CommunityRelayPorts, stored?: StoredRelayPreference | null) {
    if (stored && typeof stored.enabled === 'boolean' && (stored.enabled ? validRelayBudget(stored.bytesPerSecond) : stored.bytesPerSecond === 0)) this.desired = {...stored};
    this.state = {v: 1, serverId: ports.serverId, desiredEnabled: this.desired.enabled, desiredBytesPerSecond: this.desired.bytesPerSecond,
      status: this.desired.enabled ? 'waiting' : 'off', reason: 'not-connected', confirmedEnabled: false,
      localBudgetApplied: false, bytesPerSecond: 0, leaseExpiresAtMs: null};
  }
  snapshot(): CommunityRelayState {
    if (this.state.localBudgetApplied && (this.ports.monoMs() >= this.deadlineMono || this.ports.wallMs() >= this.deadlineWall ||
        this.ports.monoMs() < this.sampleMono || this.ports.wallMs() < this.sampleWall)) void this.suspend('telemetry-stale');
    return {...this.state};
  }
  private inactive(status: CommunityRelayState['status'], reason: CommunityRelayState['reason']): void {
    this.state = {...this.state, desiredEnabled: this.desired.enabled, desiredBytesPerSecond: this.desired.bytesPerSecond,
      status, reason, confirmedEnabled: false, localBudgetApplied: false, bytesPerSecond: 0, leaseExpiresAtMs: null};
    if (this.watchdog) clearTimeout(this.watchdog); this.watchdog = null;
  }
  private native(budget: number, lease: number, epoch: number): Promise<RelayBudgetReceipt> {
    const apply = this.apply;
    const work = this.nativeTail.catch(() => undefined).then(async () => {
      if (!apply || (budget > 0 && (epoch !== this.epoch || this.ports.monoMs() < this.sampleMono || this.ports.monoMs() - this.sampleMono >= 5000 ||
          this.ports.wallMs() < this.sampleWall || this.ports.wallMs() - this.sampleWall >= 5000))) throw new Error('native-relay-unavailable');
      const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 1500);
      try { return parseRelayBudgetReceipt(await apply(budget, lease, abort.signal), this.ports.intent.nativeInstanceId, budget, lease); }
      finally { clearTimeout(timer); }
    });
    this.nativeTail = work.then(() => undefined, () => undefined); return work;
  }
  async attach(apply?: ApplyRelayBudget): Promise<void> {
    this.apply = apply ?? null; this.ready = false; this.epoch++; this.nextMono = -Infinity;
    this.inactive(this.desired.enabled ? 'waiting' : 'off', null);
    if (!this.apply) { this.inactive('unavailable', 'native-unsupported'); return; }
    const epoch = this.epoch;
    try { await this.native(0, 0, epoch); if (epoch === this.epoch) this.ready = true; }
    catch { if (epoch === this.epoch) this.inactive('unavailable', 'native-unsupported'); }
  }
  async set(preference: StoredRelayPreference): Promise<CommunityRelayState> {
    let persistenceFailed = false;
    try { this.ports.save?.(preference); }
    catch {
      // Failed storage cannot authorize enable. Withdrawal must still close the
      // live gate, even when persisting the user's false intent fails.
      if (preference.enabled) throw new Error('relay-preference-storage-unavailable');
      persistenceFailed = true;
    }
    this.desired = {...preference}; this.needSync = true;
    this.epoch++; this.cancel.abort(); this.cancel = new AbortController(); this.nextMono = -Infinity;
    this.inactive(preference.enabled ? 'waiting' : 'off', this.apply ? null : 'not-connected');
    const epoch = this.epoch;
    try { if (this.apply) await this.native(0, 0, epoch); if (!this.ready && this.apply && epoch === this.epoch) this.inactive('unavailable', 'native-unsupported'); }
    catch { if (epoch === this.epoch) this.inactive('unavailable', 'native-unconfirmed'); }
    if (!preference.enabled && epoch === this.epoch) await this.withdraw(epoch);
    if (persistenceFailed) throw new Error('relay-preference-storage-unavailable');
    return this.snapshot();
  }
  private retryWithdrawal(): void {
    if (this.withdrawalRetry || this.desired.enabled || !this.apply || !this.needSync) return;
    this.withdrawalRetry = setTimeout(() => {
      this.withdrawalRetry = null;
      if (!this.desired.enabled && this.apply && this.needSync) void this.withdraw(this.epoch);
    }, 5000);
    this.withdrawalRetry.unref?.();
  }
  /** Withdrawal needs authenticated scope/key, but no working ET telemetry.
   * It can only reduce qualification and never applies a positive local budget. */
  private async withdraw(epoch: number): Promise<void> {
    if (this.desired.enabled || epoch !== this.epoch || !this.ports.grant()) return;
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 1000);
    const signal = AbortSignal.any([abort.signal, this.cancel.signal]);
    const work = async () => { try {
      if (signal.aborted || epoch !== this.epoch || this.desired.enabled) throw new Error('stale-relay-response');
      let previous = this.ports.grant()!;
      const request = async (operation: 'relay-status' | 'relay', extra = {}) => {
        const requestId = randomUUID(), started = Math.floor(this.ports.monoMs());
        const value = await this.ports.post(operation, {v: 2, communityId: previous.scope.communityId, deviceId: previous.scope.deviceId,
          nativeInstanceId: previous.scope.nativeInstanceId, grantId: previous.grantId, requestId, ...extra}, signal);
        if (this.desired.enabled || epoch !== this.epoch || signal.aborted) throw new Error('stale-relay-response');
        const parsed = parseRelayResponse(value, previous, this.ports.intent, requestId, started, this.ports.wallMs(), Math.floor(this.ports.monoMs()));
        if (parsed.grant.revision > previous.revision) this.ports.accept(parsed.grant, started);
        previous = this.ports.grant()!; if (!previous) throw new Error('relay-grant-mismatch'); return parsed;
      };
      let reply = await request('relay-status');
      if (reply.consent.enabled || reply.confirmed.enabled || reply.confirmed.revision !== reply.consent.revision)
        reply = await request('relay', {expectedConsentRevision: reply.consent.revision, enabled: false, bytesPerSecond: 0});
      if (reply.consent.enabled || reply.confirmed.enabled) throw new Error('withdrawal-unconfirmed');
      this.needSync = false;
      if (this.withdrawalRetry) clearTimeout(this.withdrawalRetry); this.withdrawalRetry = null;
    } catch {
      if (epoch === this.epoch && !this.desired.enabled) {
        // Local zero remains in force; retain intent and retry without telemetry.
        this.needSync = true; this.retryWithdrawal();
      }
    } finally { clearTimeout(timer); } };
    try { await (this.ports.mutate ? this.ports.mutate(work, signal) : work()); }
    catch { if (epoch === this.epoch && !this.desired.enabled) { this.needSync = true; this.retryWithdrawal(); } }
    finally { clearTimeout(timer); }
  }
  async suspend(reason: CommunityRelayState['reason'] = 'telemetry-stale'): Promise<void> {
    this.epoch++; this.cancel.abort(); this.cancel = new AbortController(); this.nextMono = -Infinity;
    this.inactive(this.desired.enabled ? 'suspended' : 'off', reason);
    const epoch = this.epoch;
    try { if (this.apply) await this.native(0, 0, epoch); }
    catch { if (epoch === this.epoch) this.inactive('unavailable', 'native-unconfirmed'); }
    if (!this.desired.enabled && this.needSync) this.retryWithdrawal();
  }
  async detach(): Promise<void> {
    await this.suspend('not-connected'); this.apply = null; this.ready = false;
    if (this.withdrawalRetry) clearTimeout(this.withdrawalRetry); this.withdrawalRetry = null;
  }
  async observe(observedMono: number, observedWall: number, signal: AbortSignal): Promise<void> {
    if (!this.ready || !this.apply) return;
    const now = Math.floor(this.ports.monoMs()), wall = this.ports.wallMs();
    if (!natural(observedMono) || !natural(observedWall) || now < observedMono || now - observedMono >= 5000 || wall < observedWall || wall - observedWall >= 5000 || signal.aborted) {
      await this.suspend(); return;
    }
    this.sampleMono = observedMono; this.sampleWall = observedWall;
    if (!this.desired.enabled && !this.needSync) return;
    if (now < this.nextMono || this.flight) return;
    const epoch = this.epoch, abort = new AbortController(), timer = setTimeout(() => abort.abort(), 1000);
    const combined = AbortSignal.any([signal, this.cancel.signal, abort.signal]);
    const valid = () => {
      if (epoch !== this.epoch || combined.aborted || this.ports.monoMs() < observedMono || this.ports.monoMs() - observedMono >= 5000 ||
          this.ports.wallMs() < observedWall || this.ports.wallMs() - observedWall >= 5000) throw new Error('stale-relay-response');
    };
    const transaction = async () => {
      try {
        valid();
        let previous = this.ports.grant(); if (!previous) throw new Error('relay-grant-mismatch');
        const request = async (operation: 'relay' | 'relay-renew' | 'relay-status', extra = {}) => {
          const requestId = randomUUID(), started = Math.floor(this.ports.monoMs());
          const value = await this.ports.post(operation, {v: 2, communityId: previous!.scope.communityId, deviceId: previous!.scope.deviceId,
            nativeInstanceId: previous!.scope.nativeInstanceId, grantId: previous!.grantId, requestId, ...extra}, combined);
          valid(); const parsed = parseRelayResponse(value, previous!, this.ports.intent, requestId, started, this.ports.wallMs(), Math.floor(this.ports.monoMs()));
          if (parsed.grant.revision > previous!.revision) this.ports.accept(parsed.grant, started);
          previous = this.ports.grant(); if (!previous) throw new Error('relay-grant-mismatch'); return parsed;
        };
        let reply!: ReturnType<typeof parseRelayResponse>;
        const authorization = async () => {
          valid(); previous = this.ports.grant(); if (!previous) throw new Error('relay-grant-mismatch');
          reply = await request('relay-status');
          if (reply.consent.enabled !== this.desired.enabled || reply.consent.bytesPerSecond !== this.desired.bytesPerSecond ||
              (this.desired.enabled && (!reply.confirmed.enabled || reply.confirmed.revision !== reply.consent.revision || reply.confirmed.bytesPerSecond !== this.desired.bytesPerSecond))) {
            reply = await request('relay', {expectedConsentRevision: reply.consent.revision, ...this.desired});
          } else if (this.desired.enabled) reply = await request('relay-renew');
        };
        await (this.ports.mutate ? this.ports.mutate(authorization, combined) : authorization());
        valid();
        // The native command has its own bounded deadline. The optional HTTPS
        // timeout must not expire after a valid reply and revoke its result.
        clearTimeout(timer);
        if (!this.desired.enabled || !reply.confirmed.enabled || reply.consent.enabled !== this.desired.enabled ||
            reply.confirmed.revision !== reply.consent.revision || reply.confirmed.bytesPerSecond !== this.desired.bytesPerSecond) {
          await this.native(0, 0, epoch); valid();
          this.inactive(this.desired.enabled ? 'unavailable' : 'off', this.desired.enabled ? 'backend-unavailable' : null);
        } else {
          const lease = Math.floor(Math.min(10000, reply.grant.expiresAtMs - reply.grant.serverTimeMs - (this.ports.monoMs() - now)));
          if (lease < 1000) throw new Error('relay-grant-mismatch');
          const started = Math.floor(this.ports.monoMs()), startedWall = this.ports.wallMs();
          const receipt = await this.native(reply.confirmed.bytesPerSecond, lease, epoch); valid();
          const remaining = receipt.leaseRemainingMs - (this.ports.monoMs() - started);
          if (remaining <= 0) throw new Error('native-relay-unconfirmed');
          // A watchdog closes stale telemetry. It never renews qualification.
          this.deadlineMono = Math.min(started + receipt.leaseRemainingMs, observedMono + 5000);
          this.deadlineWall = Math.min(startedWall + receipt.leaseRemainingMs, observedWall + 5000);
          this.state = {...this.state, status: 'active', reason: null, confirmedEnabled: true, localBudgetApplied: true,
            bytesPerSecond: receipt.bytesPerSec!, leaseExpiresAtMs: this.deadlineWall};
          if (this.watchdog) clearTimeout(this.watchdog);
          this.watchdog = setTimeout(() => { void this.suspend(); }, Math.max(1, this.deadlineMono - this.ports.monoMs()));
          this.watchdog.unref?.();
        }
        this.needSync = false; this.nextMono = now + 4000;
      } catch (error) {
        if (epoch !== this.epoch) {
          // Cancelling HTTP does not undo an issuer mutation already dispatched.
          // Reconcile after the late enable/renew settles; never restore local budget.
          if (!this.desired.enabled && this.apply) { this.needSync = true; this.retryWithdrawal(); }
          return;
        }
        const mismatch = error instanceof Error && /grant|policy|shape|scope|key|time|revision/.test(error.message);
        await this.suspend(mismatch ? 'grant-mismatch' : 'backend-unavailable');
        if (!mismatch) this.inactive('unavailable', 'backend-unavailable');
        this.nextMono = now + 5000;
      } finally { clearTimeout(timer); }
    };
    const work = transaction();
    this.flight = work; try { await work; } finally { if (this.flight === work) this.flight = null; }
  }
}
