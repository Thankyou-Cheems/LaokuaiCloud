/** Pure contract only: no network, IPC, process, filesystem or native activation.
 * Derived from the reviewed astra-contract prototype in the SHA256-pinned handoff.
 * Trusted authentication, storage, issuer/key derivation and runtime are owner seams.
 */
import { createHash } from 'node:crypto';

export interface CommunityGrantScope {
  serverInstanceId: string; accountId: string; communityId: string; deviceId: string; nativeInstanceId: string;
}
export interface TrustedCommunityIntent extends CommunityGrantScope {
  networkName: string; networkRevision: number; virtualIp: string; bootstrapProfileId: string;
}
export interface CommunityCredentialPolicy { reusable: false; allowRelay: false; allowedProxyCidrs: [] }
/** Private server-to-main DTO. Never put it in renderer IPC, logs or public state. */
export interface PrivateCommunityGrantV1 {
  v: 1; requestId: string; scope: CommunityGrantScope; grantId: string; credentialId: string; revision: number;
  networkName: string; networkRevision: number; virtualIp: string; bootstrapProfileId: string;
  issuedAtMs: number; serverTimeMs: number; renewAfterMs: number; expiresAtMs: number;
  publicKeyFingerprint: string; credentialSecretB64: string; policy: CommunityCredentialPolicy;
}
export interface GrantClock { wallMs: number; monoMs: number }
export interface CommunityPublicState {
  v: 1; communityId: string;
  status: 'waiting' | 'granted' | 'native-observed' | 'expired' | 'revoked' | 'disabled' | 'closed';
  virtualIp: string | null; memberBindingVerified: false; physicalDirectVerified: false;
}
export const COMMUNITY_ET_UPSTREAM_COMMIT = '8b7f1f0196edb5b580829ed5f135050fb5853478';


export class ContractError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'ContractError'; this.code = code; }
}
export function fail(code: string): never { throw new ContractError(code); }
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
export function exact<T extends object = Record<string, unknown>>(o: unknown, keys: readonly string[], code = 'invalid-shape'): asserts o is T {
  if (!o || typeof o !== 'object' || Array.isArray(o) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(o))) fail(code);
  const found = Reflect.ownKeys(o);
  if (found.length !== keys.length || found.some(k => typeof k !== 'string' || !keys.includes(k)) ||
      keys.some(k => !own(o, k)) || found.some(k => !('value' in Object.getOwnPropertyDescriptor(o, k)!))) fail(code);
}
/** Reject sparse/accessor/custom-property arrays before reading any elements. */
export function safeArray(value: unknown, maxLength: number): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maxLength) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === value.length + 1 && keys.every(k => k === 'length' ||
    (typeof k === 'string' && /^(0|[1-9][0-9]*)$/.test(k) && Number(k) < value.length &&
      'value' in Object.getOwnPropertyDescriptor(value, k)!));
}
export const id = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
export const uuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);
export const natural = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
export const positive = (x: unknown): x is number => natural(x) && x > 0;
export const fingerprint = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
export function keyBytes(x: unknown): Buffer {
  if (typeof x !== 'string' || x.length !== 44) fail('invalid-key-format');
  const bytes = Buffer.from(x, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== x) fail('invalid-key-format');
  return bytes;
}
export function publicKeyFingerprint(publicKeyB64: unknown): string {
  return createHash('sha256').update(keyBytes(publicKeyB64)).digest('hex');
}
function ipv4(x: unknown): x is string {
  if (typeof x !== 'string') return false;
  const pieces = x.split('.');
  return pieces.length === 4 && pieces.every(p => /^(0|[1-9][0-9]{0,2})$/.test(p) && +p <= 255);
}
export function privateIpv4(x: unknown): x is string {
  if (!ipv4(x)) return false;
  const p = x.split('.').map(Number);
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
}
function clockValue(c: unknown): GrantClock {
  exact<GrantClock>(c, ['wallMs', 'monoMs'], 'invalid-clock');
  if (!natural(c.wallMs) || !natural(c.monoMs)) fail('invalid-clock');
  return c;
}
export const SCOPE_KEYS = ['serverInstanceId', 'accountId', 'communityId', 'deviceId', 'nativeInstanceId'] as const;
const INTENT_KEYS = [...SCOPE_KEYS, 'networkName', 'networkRevision', 'virtualIp', 'bootstrapProfileId'];
export function scope(s: unknown): asserts s is CommunityGrantScope {
  exact<CommunityGrantScope>(s, SCOPE_KEYS, 'invalid-scope');
  if (!SCOPE_KEYS.every(k => k === 'nativeInstanceId' ? uuid(s[k]) : id(s[k]))) fail('invalid-scope');
}
export function sameScope(a: CommunityGrantScope, b: CommunityGrantScope): boolean { return SCOPE_KEYS.every(k => a[k] === b[k]); }
export function copiedScope(s: CommunityGrantScope): CommunityGrantScope { return Object.fromEntries(SCOPE_KEYS.map(k => [k, s[k]])) as unknown as CommunityGrantScope; }
export function intent(s: unknown): asserts s is TrustedCommunityIntent {
  exact<TrustedCommunityIntent>(s, INTENT_KEYS, 'invalid-intent'); scope(copiedScope(s));
  if (!id(s.networkName) || !positive(s.networkRevision) || !privateIpv4(s.virtualIp) || !id(s.bootstrapProfileId)) fail('invalid-intent');
}
const GRANT_KEYS = ['v', 'requestId', 'scope', 'grantId', 'credentialId', 'revision', 'networkName', 'networkRevision',
  'virtualIp', 'bootstrapProfileId', 'issuedAtMs', 'serverTimeMs', 'renewAfterMs', 'expiresAtMs', 'publicKeyFingerprint', 'credentialSecretB64', 'policy'];
export function grantShape(g: unknown): asserts g is PrivateCommunityGrantV1 {
  exact<PrivateCommunityGrantV1>(g, GRANT_KEYS, 'invalid-grant-shape'); scope(g.scope);
  exact(g.policy, ['reusable', 'allowRelay', 'allowedProxyCidrs'], 'invalid-policy');
  if (g.v !== 1 || !id(g.requestId) || !id(g.grantId) || !id(g.credentialId) || !positive(g.revision) ||
      !id(g.networkName) || !positive(g.networkRevision) || !privateIpv4(g.virtualIp) || !id(g.bootstrapProfileId) ||
      !natural(g.issuedAtMs) || !natural(g.serverTimeMs) || !natural(g.renewAfterMs) || !natural(g.expiresAtMs) || !fingerprint(g.publicKeyFingerprint)) fail('invalid-grant');
  if (g.policy.reusable !== false || g.policy.allowRelay !== false || !safeArray(g.policy.allowedProxyCidrs, 0) ||
      g.policy.allowedProxyCidrs.length !== 0) fail('unsafe-policy');
  keyBytes(g.credentialSecretB64);
}


export interface GrantTicket { readonly operation: 'acquire' | 'renew'; readonly requestId: string;
  readonly epoch: number; readonly sequence: number; readonly startedMonoMs: number }
export interface OwnedNodeObservation { nativeInstanceId: string; runtimeGeneration: number; networkName: string;
  peerId: number; virtualIp: string; publicKeyB64: string; observedMonoMs: number }
/** Decode only renderer intent. No account, device, instance, key, or config accepted. */
export function parseRendererIntent(raw: unknown): Readonly<{v: 1; communityId: string; enabled: boolean}> {
  exact(raw, ['v', 'communityId', 'enabled'], 'invalid-renderer-intent');
  if (raw.v !== 1 || !id(raw.communityId) || typeof raw.enabled !== 'boolean') fail('invalid-renderer-intent');
  return Object.freeze({v: 1, communityId: raw.communityId, enabled: raw.enabled});
}

/** One gate per account/community/device/native instance. Constructor input is main-owned. */
export class MainGrantGate {
  #intent: TrustedCommunityIntent; #clock: () => GrantClock; #maxTtlMs: number;
  #epoch = 1; #seq = 0; #ticket: GrantTicket | null = null;
  #active: {grant: PrivateCommunityGrantV1; deadlineMono: number; deadlineWall: number} | null = null;
  #binding: {peerId: number; virtualIp: string; runtimeGeneration: number; observedMonoMs: number} | null = null;
  #revoked = new Set<string>(); #revisionFloor: number;
  #enabled = true; #closed = false; #status: CommunityPublicState['status'] = 'waiting';
  constructor(trustedIntent: TrustedCommunityIntent, clock: () => GrantClock, {maxTtlMs = 3_600_000, revisionFloor = 0} = {}) {
    intent(trustedIntent);
    if (typeof clock !== 'function' || !positive(maxTtlMs) || !natural(revisionFloor)) fail('invalid-gate-options');
    this.#intent = structuredClone(trustedIntent); this.#clock = clock; this.#maxTtlMs = maxTtlMs; this.#revisionFloor = revisionFloor;
    clockValue(clock());
  }
  begin(operation: 'acquire' | 'renew', requestId: string): GrantTicket {
    this.tick();
    if (this.#closed || !this.#enabled || !['acquire', 'renew'].includes(operation) || !id(requestId)) fail('request-not-allowed');
    if (operation === 'renew' && !this.#active) fail('no-active-grant');
    if (operation === 'acquire' && this.#active) fail('active-grant-exists');
    const ticket = Object.freeze({operation, requestId, epoch: this.#epoch, sequence: ++this.#seq,
      startedMonoMs: clockValue(this.#clock()).monoMs});
    this.#ticket = ticket;
    return ticket; // Main-private handle; never a renderer capability.
  }
  accept(ticket: GrantTicket, response: unknown): Readonly<CommunityPublicState> {
    this.tick();
    if (this.#closed || !this.#enabled || ticket !== this.#ticket || ticket?.epoch !== this.#epoch) fail('stale-response');
    grantShape(response);
    if (response.requestId !== ticket.requestId) fail('request-mismatch');
    if (!sameScope(response.scope, this.#intent)) fail('scope-mismatch');
    for (const k of ['networkName', 'networkRevision', 'virtualIp', 'bootstrapProfileId'] as const) {
      if (response[k] !== this.#intent[k]) fail('network-intent-mismatch');
    }
    if (this.#revoked.has(response.grantId)) fail('grant-revoked');
    const now = clockValue(this.#clock());
    const elapsed = now.monoMs - ticket.startedMonoMs;
    if (elapsed < 0 || elapsed > 30_000) fail('response-too-late');
    // Server timestamps are not compared with the possibly skewed client clock.
    // Subtract the whole request age conservatively; never extend by transit time.
    const remaining = response.expiresAtMs - response.serverTimeMs - elapsed;
    if (response.issuedAtMs > response.serverTimeMs || remaining <= 0 ||
        response.issuedAtMs >= response.renewAfterMs || response.renewAfterMs >= response.expiresAtMs ||
        response.expiresAtMs - response.issuedAtMs > this.#maxTtlMs) fail('invalid-grant-time');
    if (response.revision <= this.#revisionFloor) fail('stale-revision');
    if (ticket.operation === 'renew') {
      if (!this.#active) fail('renewal-after-expiry');
      const old = this.#active.grant;
      if (response.grantId !== old.grantId || response.credentialId !== old.credentialId ||
          response.publicKeyFingerprint !== old.publicKeyFingerprint || response.credentialSecretB64 !== old.credentialSecretB64)
        fail('renewal-identity-changed');
      if (response.expiresAtMs <= old.expiresAtMs) fail('renewal-not-extended');
    }
    if (!Number.isSafeInteger(now.monoMs + remaining) || !Number.isSafeInteger(now.wallMs + remaining)) fail('invalid-grant-time');
    this.#active = {grant: structuredClone(response), deadlineMono: now.monoMs + remaining, deadlineWall: now.wallMs + remaining};
    this.#revisionFloor = response.revision; this.#ticket = null; this.#binding = null; this.#status = 'granted';
    return this.snapshot();
  }
  revokeTrusted(event: unknown): Readonly<CommunityPublicState> {
    exact<{v: number; scope: CommunityGrantScope; grantId: string}>(event, ['v', 'scope', 'grantId'], 'invalid-revocation'); scope(event.scope);
    if (event.v !== 1 || !id(event.grantId) || !sameScope(event.scope, this.#intent)) fail('scope-mismatch');
    if (this.#closed) return this.snapshot();
    // Caller must authenticate this event against the exact backend/connection.
    this.#revoked.add(event.grantId);
    if (!this.#enabled) return this.snapshot(); // User intent remains disabled.
    // With no active grant an acquire response has not identified its grant yet.
    // Keep its ticket: accept() checks the exact grantId against this tombstone.
    // Thus an old revocation cannot cancel an unrelated new acquisition.
    if (this.#active?.grant.grantId === event.grantId) {
      this.#ticket = null; this.#epoch++;
      this.#active = null; this.#binding = null; this.#status = 'revoked';
    }
    return this.snapshot();
  }
  setEnabled(enabled: boolean): Readonly<CommunityPublicState> {
    if (typeof enabled !== 'boolean') fail('invalid-enabled');
    if (this.#closed) return this.snapshot(); // Terminal; neither toggle can reopen/relabel it.
    if (enabled === this.#enabled) return this.snapshot();
    this.#enabled = enabled; this.#epoch++; this.#ticket = null;
    if (!enabled) { this.#active = null; this.#binding = null; this.#status = 'disabled'; }
    else if (!this.#closed) this.#status = 'waiting';
    return this.snapshot();
  }
  close() { this.#closed = true; this.#enabled = false; this.#epoch++; this.#ticket = null; this.#active = null; this.#binding = null; this.#status = 'closed'; }
  invalidateNativeRuntime() {
    // A process restart invalidates measurements, not the configured instance UUID.
    this.#binding = null; this.#epoch++; this.#ticket = null;
    if (this.#active) this.#status = 'granted';
  }
  tick() {
    const now = clockValue(this.#clock());
    if (this.#active && (now.wallMs >= this.#active.deadlineWall || now.monoMs >= this.#active.deadlineMono)) {
      this.#active = null; this.#binding = null; this.#ticket = null; this.#epoch++; this.#status = 'expired';
    }
    if (this.#binding && now.monoMs - this.#binding.observedMonoMs > 5_000) {
      this.#binding = null; if (this.#active) this.#status = 'granted';
    }
    return this.#status;
  }
  acceptOwnedNode(observation: unknown, expectedRuntimeGeneration: number): Readonly<CommunityPublicState> {
    this.tick();
    if (!this.#active || this.#closed) fail('no-active-grant');
    exact<OwnedNodeObservation>(observation, ['nativeInstanceId', 'runtimeGeneration', 'networkName', 'peerId', 'virtualIp', 'publicKeyB64', 'observedMonoMs'], 'invalid-node-observation');
    const now = clockValue(this.#clock());
    if (observation.nativeInstanceId !== this.#intent.nativeInstanceId || observation.networkName !== this.#intent.networkName ||
        observation.virtualIp !== this.#intent.virtualIp || !positive(expectedRuntimeGeneration) ||
        observation.runtimeGeneration !== expectedRuntimeGeneration || !positive(observation.peerId) || observation.peerId > 0xffffffff ||
        !natural(observation.observedMonoMs) || observation.observedMonoMs > now.monoMs || now.monoMs - observation.observedMonoMs > 5_000)
      fail('node-observation-mismatch');
    if (publicKeyFingerprint(observation.publicKeyB64) !== this.#active.grant.publicKeyFingerprint) fail('key-mismatch');
    this.#binding = {peerId: observation.peerId, virtualIp: observation.virtualIp, runtimeGeneration: observation.runtimeGeneration,
      observedMonoMs: observation.observedMonoMs};
    this.#status = 'native-observed';
    return this.snapshot(); // Observation alone is NOT a server-verified member binding.
  }
  /** Main-only copy, intended solely for the config builder; never expose through IPC. */
  privateGrantForConfig(): PrivateCommunityGrantV1 | null {
    this.tick();
    return this.#active ? structuredClone(this.#active.grant) : null;
  }
  snapshot(): Readonly<CommunityPublicState> {
    this.tick();
    // Explicit allowlist. Never spread the private grant, native NodeInfo.config, or errors.
    return Object.freeze({v: 1, communityId: this.#intent.communityId, status: this.#status,
      virtualIp: this.#binding?.virtualIp ?? null, memberBindingVerified: false, physicalDirectVerified: false});
  }
}
