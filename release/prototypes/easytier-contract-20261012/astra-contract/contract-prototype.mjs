/**
 * UNINTEGRATED PURE CONTRACT PROTOTYPE. No network, filesystem, process, IPC,
 * credential issuance, native driver, key generation, or product import.
 * Validates DTO/state boundaries only. Trusted transports/provider evidence are
 * CALLER obligations. Syntactically valid fixture bytes are not ET credentials.
 */
import { createHash } from 'node:crypto';

export class ContractError extends Error {
  constructor(code) { super(code); this.name = 'ContractError'; this.code = code; }
}
const fail = code => { throw new ContractError(code); };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function exact(o, keys, code = 'invalid-shape') {
  if (!o || typeof o !== 'object' || Array.isArray(o) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(o))) fail(code);
  const found = Reflect.ownKeys(o);
  if (found.length !== keys.length || found.some(k => typeof k !== 'string' || !keys.includes(k)) ||
      keys.some(k => !own(o, k)) || found.some(k => !('value' in Object.getOwnPropertyDescriptor(o, k)))) fail(code);
}
const id = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const uuid = x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);
const natural = x => Number.isSafeInteger(x) && x >= 0;
const positive = x => natural(x) && x > 0;
const fingerprint = x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
function keyBytes(x) {
  if (typeof x !== 'string' || x.length !== 44) fail('invalid-key-format');
  const bytes = Buffer.from(x, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== x) fail('invalid-key-format');
  return bytes;
}
export function publicKeyFingerprint(publicKeyB64) {
  return createHash('sha256').update(keyBytes(publicKeyB64)).digest('hex');
}
function ipv4(x) {
  if (typeof x !== 'string') return false;
  const pieces = x.split('.');
  return pieces.length === 4 && pieces.every(p => /^(0|[1-9][0-9]{0,2})$/.test(p) && +p <= 255);
}
function privateIpv4(x) {
  if (!ipv4(x)) return false;
  const p = x.split('.').map(Number);
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
}
function clockValue(c) {
  exact(c, ['wallMs', 'monoMs'], 'invalid-clock');
  if (!natural(c.wallMs) || !natural(c.monoMs)) fail('invalid-clock');
  return c;
}
const SCOPE_KEYS = ['serverInstanceId', 'accountId', 'communityId', 'deviceId', 'nativeInstanceId'];
const INTENT_KEYS = [...SCOPE_KEYS, 'networkName', 'networkRevision', 'virtualIp', 'bootstrapProfileId'];
function scope(s) {
  exact(s, SCOPE_KEYS, 'invalid-scope');
  if (!SCOPE_KEYS.every(k => k === 'nativeInstanceId' ? uuid(s[k]) : id(s[k]))) fail('invalid-scope');
}
function sameScope(a, b) { return SCOPE_KEYS.every(k => a[k] === b[k]); }
function copiedScope(s) { return Object.fromEntries(SCOPE_KEYS.map(k => [k, s[k]])); }
function intent(s) {
  exact(s, INTENT_KEYS, 'invalid-intent'); scope(copiedScope(s));
  if (!id(s.networkName) || !positive(s.networkRevision) || !privateIpv4(s.virtualIp) || !id(s.bootstrapProfileId)) fail('invalid-intent');
}
const GRANT_KEYS = ['v', 'requestId', 'scope', 'grantId', 'credentialId', 'revision', 'networkName', 'networkRevision',
  'virtualIp', 'bootstrapProfileId', 'issuedAtMs', 'serverTimeMs', 'renewAfterMs', 'expiresAtMs', 'publicKeyFingerprint', 'credentialSecretB64', 'policy'];
function grantShape(g) {
  exact(g, GRANT_KEYS, 'invalid-grant-shape'); scope(g.scope);
  exact(g.policy, ['reusable', 'allowRelay', 'allowedProxyCidrs'], 'invalid-policy');
  if (g.v !== 1 || !id(g.requestId) || !id(g.grantId) || !id(g.credentialId) || !positive(g.revision) ||
      !id(g.networkName) || !positive(g.networkRevision) || !privateIpv4(g.virtualIp) || !id(g.bootstrapProfileId) ||
      !natural(g.issuedAtMs) || !natural(g.serverTimeMs) || !natural(g.renewAfterMs) || !natural(g.expiresAtMs) || !fingerprint(g.publicKeyFingerprint)) fail('invalid-grant');
  if (g.policy.reusable !== false || g.policy.allowRelay !== false || !Array.isArray(g.policy.allowedProxyCidrs) ||
      g.policy.allowedProxyCidrs.length !== 0) fail('unsafe-policy');
  keyBytes(g.credentialSecretB64);
}

/** Decode only renderer intent. No account, device, instance, key, or config accepted. */
export function parseRendererIntent(raw) {
  exact(raw, ['v', 'communityId', 'enabled'], 'invalid-renderer-intent');
  if (raw.v !== 1 || !id(raw.communityId) || typeof raw.enabled !== 'boolean') fail('invalid-renderer-intent');
  return Object.freeze({v: 1, communityId: raw.communityId, enabled: raw.enabled});
}

/** One gate per account/community/device/native instance. Constructor input is main-owned. */
export class MainGrantGate {
  #intent; #clock; #maxTtlMs; #epoch = 1; #seq = 0; #ticket = null;
  #active = null; #binding = null; #revoked = new Set(); #revisionFloor;
  #enabled = true; #closed = false; #status = 'waiting';
  constructor(trustedIntent, clock, {maxTtlMs = 3_600_000, revisionFloor = 0} = {}) {
    intent(trustedIntent);
    if (typeof clock !== 'function' || !positive(maxTtlMs) || !natural(revisionFloor)) fail('invalid-gate-options');
    this.#intent = structuredClone(trustedIntent); this.#clock = clock; this.#maxTtlMs = maxTtlMs; this.#revisionFloor = revisionFloor;
    clockValue(clock());
  }
  begin(operation, requestId) {
    this.tick();
    if (this.#closed || !this.#enabled || !['acquire', 'renew'].includes(operation) || !id(requestId)) fail('request-not-allowed');
    if (operation === 'renew' && !this.#active) fail('no-active-grant');
    if (operation === 'acquire' && this.#active) fail('active-grant-exists');
    const ticket = Object.freeze({operation, requestId, epoch: this.#epoch, sequence: ++this.#seq,
      startedMonoMs: clockValue(this.#clock()).monoMs});
    this.#ticket = ticket;
    return ticket; // Main-private handle; never a renderer capability.
  }
  accept(ticket, response) {
    this.tick();
    if (this.#closed || !this.#enabled || ticket !== this.#ticket || ticket?.epoch !== this.#epoch) fail('stale-response');
    grantShape(response);
    if (response.requestId !== ticket.requestId) fail('request-mismatch');
    if (!sameScope(response.scope, this.#intent)) fail('scope-mismatch');
    for (const k of ['networkName', 'networkRevision', 'virtualIp', 'bootstrapProfileId']) {
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
  revokeTrusted(event) {
    exact(event, ['v', 'scope', 'grantId'], 'invalid-revocation'); scope(event.scope);
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
  setEnabled(enabled) {
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
  acceptOwnedNode(observation, expectedRuntimeGeneration) {
    this.tick();
    if (!this.#active || this.#closed) fail('no-active-grant');
    exact(observation, ['nativeInstanceId', 'runtimeGeneration', 'networkName', 'peerId', 'virtualIp', 'publicKeyB64', 'observedMonoMs'], 'invalid-node-observation');
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
  snapshot() {
    this.tick();
    // Explicit allowlist. Never spread the private grant, native NodeInfo.config, or errors.
    return Object.freeze({v: 1, communityId: this.#intent.communityId, status: this.#status,
      virtualIp: this.#binding?.virtualIp ?? null, memberBindingVerified: false, physicalDirectVerified: false});
  }
}

/** Pure provider-observation join. Caller must authenticate both source boundaries
 * and derive expected from a CURRENT, unexpired, unrevoked server grant record.
 * This helper does not own the grant database or certify the observer transport.
 */
export function verifyDeviceBinding(expected, observation, nowMonoMs, expectedProviderGeneration) {
  const expectedKeys = [...SCOPE_KEYS, 'grantId', 'credentialId', 'publicKeyFingerprint', 'networkName', 'virtualIp', 'revision'];
  exact(expected, expectedKeys, 'invalid-binding-expected'); scope(copiedScope(expected));
  if (!id(expected.grantId) || !id(expected.credentialId) || !fingerprint(expected.publicKeyFingerprint) ||
      !id(expected.networkName) || !privateIpv4(expected.virtualIp) || !positive(expected.revision)) fail('invalid-binding-expected');
  exact(observation, ['providerGeneration', 'observedMonoMs', 'networkName', 'connections', 'routes'], 'invalid-provider-observation');
  if (!positive(expectedProviderGeneration) || observation.providerGeneration !== expectedProviderGeneration ||
      !natural(nowMonoMs) || !natural(observation.observedMonoMs) || observation.observedMonoMs > nowMonoMs ||
      nowMonoMs - observation.observedMonoMs > 5_000 || observation.networkName !== expected.networkName ||
      !Array.isArray(observation.connections) || !Array.isArray(observation.routes) || observation.connections.length > 64 || observation.routes.length > 64)
    fail('provider-observation-mismatch');
  const peers = new Set();
  const authenticatedIdentities = new Map();
  for (const c of observation.connections) {
    exact(c, ['peerId', 'isClosed', 'secureAuthLevel', 'peerIdentityType', 'remotePublicKeyB64'], 'invalid-connection');
    if (!positive(c.peerId) || c.peerId > 0xffffffff || typeof c.isClosed !== 'boolean' ||
        ![0, 1, 2, 3].includes(c.secureAuthLevel) || ![0, 1, 2].includes(c.peerIdentityType)) fail('invalid-connection');
    const observedFingerprint = publicKeyFingerprint(c.remotePublicKeyB64);
    if (!c.isClosed && c.secureAuthLevel >= 2) {
      const identity = `${c.peerIdentityType}:${observedFingerprint}`;
      if (authenticatedIdentities.has(c.peerId) && authenticatedIdentities.get(c.peerId) !== identity)
        fail('connection-evidence-conflict');
      authenticatedIdentities.set(c.peerId, identity);
    }
    const sameKey = observedFingerprint === expected.publicKeyFingerprint;
    if (sameKey && !c.isClosed && c.secureAuthLevel === 2 && c.peerIdentityType === 1) peers.add(c.peerId);
  }
  if (peers.size !== 1) fail(peers.size === 0 ? 'binding-unproven' : 'duplicate-key-owner');
  const peerId = [...peers][0];
  for (const r of observation.routes) {
    exact(r, ['peerId', 'nativeInstanceId', 'virtualIp', 'nextHopPeerId'], 'invalid-route');
    if (!positive(r.peerId) || r.peerId > 0xffffffff || !uuid(r.nativeInstanceId) || !privateIpv4(r.virtualIp) ||
        !natural(r.nextHopPeerId) || r.nextHopPeerId > 0xffffffff) fail('invalid-route');
  }
  const routes = observation.routes.filter(r => r.peerId === peerId);
  if (routes.length !== 1 || routes[0].nativeInstanceId !== expected.nativeInstanceId || routes[0].virtualIp !== expected.virtualIp ||
      observation.routes.some(r => r.peerId !== peerId && r.virtualIp === expected.virtualIp)) fail('route-binding-mismatch');
  return Object.freeze({v: 1, ...copiedScope(expected), grantId: expected.grantId, credentialId: expected.credentialId,
    revision: expected.revision, peerId, virtualIp: expected.virtualIp, publicKeyFingerprint: expected.publicKeyFingerprint,
    evidence: 'provider-connection-and-route', physicalDirectVerified: false});
}
