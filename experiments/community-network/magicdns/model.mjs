/** Offline reference only. No socket, filesystem, ET process or OS DNS API. */
import {createHmac, createPrivateKey, createPublicKey, randomUUID, sign, verify} from 'node:crypto';

export const EXPERIMENT_ZONE_SUFFIX = 'lkc.invalid.';
export const MAX_DIRECTORY_TTL_MS = 10_000;
export const MAX_REQUEST_MS = 1_000;
export const MAX_DEVICES = 254;

export class DirectoryContractError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new DirectoryContractError(code); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const namespace = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
const clock = value => {
  exact(value, ['wallMs', 'monoMs']);
  if (!positive(value.wallMs) || !Number.isSafeInteger(value.monoMs) || value.monoMs < 0) fail('invalid-clock');
};
/** Accessors/prototypes/symbols must not introduce side effects at the trust seam. */
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid-shape');
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || !own.every(key => keys.includes(key))) fail('invalid-shape');
  for (const key of keys) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) fail('invalid-shape');
}
function boundedArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_DEVICES ||
      Reflect.ownKeys(value).length !== value.length + 1) fail('invalid-devices');
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(i)) ?? {}, 'value')) fail('invalid-devices');
}
function privateIpv4(value) {
  if (typeof value !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return false;
  const parts = value.split('.').map(Number);
  if (parts.some(n => n > 255) || parts.join('.') !== value) return false;
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}
function b64(value, maxBytes) {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4) fail('invalid-envelope');
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > maxBytes || bytes.toString('base64') !== value) fail('invalid-envelope');
  return bytes;
}
function privateKey(value) {
  const key = value?.type === 'private' ? value : createPrivateKey(value);
  if (key.asymmetricKeyType !== 'ed25519') fail('invalid-signing-key');
  return key;
}
function publicKey(value) {
  const key = value?.type === 'public' ? value : createPublicKey(value);
  if (key.asymmetricKeyType !== 'ed25519') fail('invalid-verification-key');
  return key;
}
const nameToken = value => typeof value === 'string' && /^[a-z]-[a-f0-9]{32}$/.test(value);
const sessionToken = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/**
 * SERVER TRUST SEAM, not authentication implementation: devices must be read
 * from the authenticated community session/grant/device store by a real adapter.
 * Never expose issue()/retireSession() to renderer, peers or HTTP request bodies.
 * Signing/HMAC keys below are dedicated DNS authority inputs, not ET credentials.
 */
export function createDirectoryAuthority(options) {
  exact(options, ['communityId', 'serverInstanceId', 'namespaceKey', 'signingPrivateKey', 'initialRevision']);
  if (!namespace(options.communityId) || !namespace(options.serverInstanceId) || !Buffer.isBuffer(options.namespaceKey) ||
      options.namespaceKey.length < 32 || !Number.isSafeInteger(options.initialRevision) || options.initialRevision < 0) fail('invalid-authority');
  const {communityId, serverInstanceId} = options, key = Buffer.from(options.namespaceKey), signer = privateKey(options.signingPrivateKey);
  const hash = (purpose, ...parts) => createHmac('sha256', key).update(JSON.stringify(['laokuai-magicdns-experiment-v1', purpose, serverInstanceId, communityId, ...parts])).digest('hex');
  const zone = `c-${hash('zone').slice(0, 32)}.${EXPERIMENT_ZONE_SUFFIX}`;
  let revision = options.initialRevision;
  const retired = new Set();
  return Object.freeze({
    zone,
    retireSession(sessionId) { if (!id(sessionId)) fail('invalid-session'); retired.add(sessionId); },
    issue(input) {
      exact(input, ['requestId', 'serverTimeMs', 'ttlMs', 'devices']);
      if (!id(input.requestId) || !positive(input.serverTimeMs) || !positive(input.ttlMs) || input.ttlMs > MAX_DIRECTORY_TTL_MS ||
          !Number.isSafeInteger(input.serverTimeMs + input.ttlMs) || !Number.isSafeInteger(revision + 1)) fail('invalid-directory');
      boundedArray(input.devices);
      const records = [], aliases = new Set(), addresses = new Set(), deviceIds = new Set(), sessions = new Set();
      for (const device of input.devices) {
        exact(device, ['accountId', 'deviceId', 'sessionId', 'authorizationEpoch', 'currentAuthorizationEpoch', 'issuedAtMs',
          'sessionExpiresAtMs', 'grantExpiresAtMs', 'sessionStatus', 'grantStatus', 'virtualIp']);
        if (![device.accountId, device.deviceId, device.sessionId].every(id) || !positive(device.authorizationEpoch) ||
            !positive(device.currentAuthorizationEpoch) || !positive(device.issuedAtMs) || !positive(device.sessionExpiresAtMs) ||
            !positive(device.grantExpiresAtMs) || device.issuedAtMs > input.serverTimeMs ||
            device.sessionExpiresAtMs <= device.issuedAtMs || device.grantExpiresAtMs <= device.issuedAtMs ||
            !['active', 'revoked'].includes(device.sessionStatus) || !['active', 'revoked'].includes(device.grantStatus) ||
            !privateIpv4(device.virtualIp)) fail('invalid-device');
        if (retired.has(device.sessionId) || device.sessionStatus !== 'active' || device.grantStatus !== 'active' ||
            device.authorizationEpoch !== device.currentAuthorizationEpoch || device.sessionExpiresAtMs <= input.serverTimeMs ||
            device.grantExpiresAtMs <= input.serverTimeMs) continue;
        const accountAlias = `u-${hash('account', device.accountId).slice(0, 32)}`;
        const deviceAlias = `d-${hash('device', device.accountId, device.deviceId).slice(0, 32)}`;
        const stableDevice = JSON.stringify([device.accountId, device.deviceId]);
        if (aliases.has(deviceAlias) || addresses.has(device.virtualIp) || deviceIds.has(stableDevice) || sessions.has(device.sessionId)) fail('ambiguous-directory');
        aliases.add(deviceAlias); addresses.add(device.virtualIp); deviceIds.add(stableDevice); sessions.add(device.sessionId);
        records.push({accountAlias, deviceAlias, ipv4: device.virtualIp, sessionBinding: hash('session', device.sessionId, device.authorizationEpoch),
          validUntilMs: Math.min(input.serverTimeMs + input.ttlMs, device.sessionExpiresAtMs, device.grantExpiresAtMs)});
      }
      records.sort((a, b) => a.deviceAlias.localeCompare(b.deviceAlias));
      const payload = {v: 1, communityId, serverInstanceId, requestId: input.requestId, revision: ++revision,
        serverTimeMs: input.serverTimeMs, expiresAtMs: input.serverTimeMs + input.ttlMs, zone, records};
      const bytes = Buffer.from(JSON.stringify(payload));
      return Object.freeze({payloadB64: bytes.toString('base64'), signatureB64: sign(null, bytes, signer).toString('base64')});
    },
  });
}

function verifiedPayload(envelope, verifier, scope) {
  exact(envelope, ['payloadB64', 'signatureB64']);
  const bytes = b64(envelope.payloadB64, 128 * 1024), signature = b64(envelope.signatureB64, 64);
  if (signature.length !== 64 || !verify(null, bytes, verifier, signature)) fail('untrusted-authority');
  let payload;
  try { payload = JSON.parse(bytes.toString('utf8')); } catch { fail('invalid-envelope'); }
  exact(payload, ['v', 'communityId', 'serverInstanceId', 'requestId', 'revision', 'serverTimeMs', 'expiresAtMs', 'zone', 'records']);
  if (payload.v !== 1 || payload.communityId !== scope.communityId || payload.serverInstanceId !== scope.serverInstanceId ||
      !id(payload.requestId) || !positive(payload.revision) || !positive(payload.serverTimeMs) || !positive(payload.expiresAtMs) ||
      payload.expiresAtMs <= payload.serverTimeMs || payload.expiresAtMs - payload.serverTimeMs > MAX_DIRECTORY_TTL_MS ||
      !/^c-[a-f0-9]{32}\.lkc\.invalid\.$/.test(payload.zone)) fail('invalid-directory');
  boundedArray(payload.records);
  const names = new Set(), addresses = new Set(), sessions = new Set();
  for (const row of payload.records) {
    exact(row, ['accountAlias', 'deviceAlias', 'ipv4', 'sessionBinding', 'validUntilMs']);
    if (!nameToken(row.accountAlias) || !row.accountAlias.startsWith('u-') || !nameToken(row.deviceAlias) || !row.deviceAlias.startsWith('d-') ||
        !privateIpv4(row.ipv4) || !sessionToken(row.sessionBinding) || !positive(row.validUntilMs) || row.validUntilMs <= payload.serverTimeMs ||
        row.validUntilMs > payload.expiresAtMs || names.has(row.deviceAlias) || addresses.has(row.ipv4) || sessions.has(row.sessionBinding)) fail('ambiguous-directory');
    names.add(row.deviceAlias); addresses.add(row.ipv4); sessions.add(row.sessionBinding);
  }
  return payload;
}

/**
 * CLIENT TRUST SEAM: caller pins the community's DNS authority key through its
 * authenticated HTTPS community metadata, never a key in the returned envelope.
 * Clock values are observations from the host; the model cannot authenticate them.
 */
export function createDirectoryCache(options) {
  exact(options, ['communityId', 'serverInstanceId', 'verificationKey', 'authorizationEpoch']);
  if (!namespace(options.communityId) || !namespace(options.serverInstanceId) || !positive(options.authorizationEpoch)) fail('invalid-cache');
  const verifier = publicKey(options.verificationKey), scope = {communityId: options.communityId, serverInstanceId: options.serverInstanceId};
  let epoch = options.authorizationEpoch, highestRevision = 0, active = null, lastClock = null;
  const pending = new Map();
  const invalidate = () => { active = null; pending.clear(); };
  const observeClock = value => {
    clock(value);
    if (lastClock && (value.wallMs < lastClock.wallMs || value.monoMs < lastClock.monoMs)) { invalidate(); fail('clock-rollback'); }
    lastClock = {...value};
  };
  const canonicalName = value => {
    if (typeof value !== 'string' || value.length > 253 || !/^[A-Za-z0-9.-]+$/.test(value)) return null;
    return value.toLowerCase().replace(/\.?$/, '.');
  };
  return Object.freeze({
    beginRequest(now) {
      observeClock(now);
      const ticket = Object.freeze({requestId: randomUUID()});
      pending.set(ticket, {epoch, start: {...now}});
      // New requests retire older in-flight results, preventing late replacement.
      for (const previous of pending.keys()) if (previous !== ticket) pending.delete(previous);
      return ticket;
    },
    accept(ticket, envelope, now) {
      const request = pending.get(ticket); pending.delete(ticket);
      // A retired callback cannot clear a newer authenticated result.
      if (!request || request.epoch !== epoch) fail('retired-request');
      try {
        observeClock(now);
        const elapsed = now.monoMs - request.start.monoMs;
        if (elapsed > MAX_REQUEST_MS || now.wallMs - request.start.wallMs > MAX_REQUEST_MS) fail('request-expired');
        const payload = verifiedPayload(envelope, verifier, scope);
        if (payload.requestId !== ticket.requestId || payload.revision <= highestRevision) fail('replayed-directory');
        if (active && payload.zone !== active.zone) fail('namespace-changed');
        const ttlMs = payload.expiresAtMs - payload.serverTimeMs;
        // Time differences, not server UTC equality: clock skew is tolerated.
        // Charge the entire request time and bound both local clocks independently.
        const charge = Math.max(elapsed, now.wallMs - request.start.wallMs);
        if (ttlMs <= charge) fail('directory-expired');
        const records = payload.records.map(row => ({...row,
          deadlineMono: now.monoMs + row.validUntilMs - payload.serverTimeMs - charge,
          deadlineWall: now.wallMs + row.validUntilMs - payload.serverTimeMs - charge}));
        highestRevision = payload.revision;
        active = {zone: payload.zone, records, deadlineMono: now.monoMs + ttlMs - charge, deadlineWall: now.wallMs + ttlMs - charge};
        return Object.freeze({zone: active.zone, revision: highestRevision, deviceCount: records.filter(r => r.deadlineMono > now.monoMs && r.deadlineWall > now.wallMs).length});
      } catch (error) { active = null; throw error; }
    },
    retireAuthorization(nextEpoch) {
      if (!positive(nextEpoch) || nextEpoch <= epoch) fail('invalid-authorization-epoch');
      epoch = nextEpoch; invalidate();
    },
    unavailable() { invalidate(); },
    resolve(queryName, now) {
      try { observeClock(now); } catch (error) { if (error instanceof DirectoryContractError) return {status: 'unavailable', reason: error.code}; throw error; }
      if (!active) return {status: 'unavailable', reason: 'no-authenticated-directory'};
      if (now.monoMs >= active.deadlineMono || now.wallMs >= active.deadlineWall) { active = null; return {status: 'unavailable', reason: 'expired'}; }
      const name = canonicalName(queryName);
      if (!name || !name.endsWith('.' + active.zone)) return {status: 'refused', reason: 'outside-community'};
      const alias = name.slice(0, -active.zone.length - 1);
      const fresh = active.records.filter(row => now.monoMs < row.deadlineMono && now.wallMs < row.deadlineWall);
      const devices = fresh.filter(row => row.deviceAlias === alias || row.accountAlias === alias);
      if (!devices.length) return {status: 'not-found'};
      if (devices.length !== 1) return {status: 'ambiguous', devices: devices.map(row => ({name: row.deviceAlias + '.' + active.zone, ipv4: row.ipv4}))};
      const row = devices[0];
      return {status: 'answer', ipv4: row.ipv4, ttlSeconds: Math.floor(Math.min(row.deadlineMono - now.monoMs, row.deadlineWall - now.wallMs) / 1000)};
    },
  });
}
