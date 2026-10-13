/** Pure contract only: no network, IPC, process, filesystem or native activation.
 * Derived from the reviewed astra-contract prototype in the SHA256-pinned handoff.
 * Trusted authentication, storage, issuer/key derivation and runtime are owner seams.
 */
import { createHash } from 'node:crypto';

import type { ProviderPeerObservation } from './communityDeviceBinding';

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
export interface RelayConsentV2 { v: 2; enabled: boolean; revision: number; bytesPerSecond: number }
export interface PrivateCommunityGrantV2 extends Omit<PrivateCommunityGrantV1, 'v' | 'policy'> {
  v: 2;
  policy: { reusable: false; allowRelay: boolean; allowedProxyCidrs: []; relay: RelayConsentV2 };
}
export type PrivateCommunityGrant = PrivateCommunityGrantV1 | PrivateCommunityGrantV2;
export const MEMBER_RELAY_MAX_BYTES_PER_SECOND = 1_048_576;
export function relayConsentShape(value: unknown): asserts value is RelayConsentV2 {
  exact<RelayConsentV2>(value, ['v','enabled','revision','bytesPerSecond'], 'invalid-relay-consent');
  if (value.v !== 2 || typeof value.enabled !== 'boolean' || !natural(value.revision) || !natural(value.bytesPerSecond) ||
      (value.enabled ? value.revision < 1 || value.bytesPerSecond < 1024 || value.bytesPerSecond > MEMBER_RELAY_MAX_BYTES_PER_SECOND : value.bytesPerSecond !== 0))
    fail('invalid-relay-consent');
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
/** Existing socket/SFU namespace may contain CJK letters. Preserve exact bytes;
 * account/request/key identifiers keep their separate ASCII grammar. */
export const communityIdentity = (x: unknown): x is string => typeof x === 'string' && x.length <= 128 &&
  /^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,127}$/u.test(x);

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
export const SCOPE_KEYS = ['serverInstanceId', 'accountId', 'communityId', 'deviceId', 'nativeInstanceId'] as const;
const INTENT_KEYS = [...SCOPE_KEYS, 'networkName', 'networkRevision', 'virtualIp', 'bootstrapProfileId'];
export function scope(s: unknown): asserts s is CommunityGrantScope {
  exact<CommunityGrantScope>(s, SCOPE_KEYS, 'invalid-scope');
  if (!SCOPE_KEYS.every(k => k === 'nativeInstanceId' ? uuid(s[k]) : k === 'serverInstanceId' || k === 'communityId' ? communityIdentity(s[k]) : id(s[k]))) fail('invalid-scope');
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
/** V1 validation stays strict. Only explicitly negotiated V2 carries relay consent. */
export function versionedGrantShape(g: unknown): asserts g is PrivateCommunityGrant {
  if (!g || typeof g !== 'object' || !('v' in g) || g.v !== 2) { grantShape(g); return; }
  exact<PrivateCommunityGrantV2>(g, GRANT_KEYS, 'invalid-grant-shape');
  exact(g.policy, ['reusable','allowRelay','allowedProxyCidrs','relay'], 'invalid-policy');
  relayConsentShape(g.policy.relay);
  if (g.policy.reusable !== false || typeof g.policy.allowRelay !== 'boolean' || g.policy.allowRelay !== g.policy.relay.enabled ||
      !safeArray(g.policy.allowedProxyCidrs, 0)) fail('unsafe-policy');
  grantShape({...g, v: 1, policy: {reusable:false,allowRelay:false,allowedProxyCidrs:[]}});
}

/** Fixed native API facts: Generate recovers an existing ID without extending it.
 * Renewal requires RPC Upsert with the SAME private key, followed by List readback.
 * No CLI renew exists. credentialId is an opaque management ID, never a public key.
 * reusable=false constrains concurrent peers; it does not bind physical hardware.
 */
export interface NativeAuthority {
  adminInstanceId: string;
  upstreamCommit: typeof COMMUNITY_ET_UPSTREAM_COMMIT;
  groups: string[];
}
export interface NativeCredentialReadback {
  id: string; groups: string[]; allowRelay: boolean; allowedProxyCidrs: string[];
  reusable: boolean; expiryUnix: number; publicKeyFingerprint: string;
}
/** Adapter-private metadata, NOT additional GenerateCredentialResponse fields.
 * The adapter must derive this fingerprint from the decoded X25519 public key.
 */
export interface PrivateNativeCredentialReceipt {
  credentialId: string; credentialSecretB64: string; expiryUnix: number;
  derivedPublicKeyFingerprint: string;
}
export interface CreateCredentialIntent {
  instance: string; credentialId: string; ttlSeconds: number; groups: string[];
  reusable: false; allowRelay: false; allowedProxyCidrs: [];
}
export interface ExtendCredentialIntent {
  instance: string; id: string; secret: string; expiryUnix: number; groups: string[];
  reusable: false; allowRelay: false; allowedProxyCidrs: [];
}
/** Product adapter capability receipt, not an upstream RPC response shape. */
export interface CredentialProviderCapability {
  instance: string; upstreamCommit: string; sameKeyUpsert: boolean;
  credentialStore: 'healthy' | 'unavailable';
}
/** Interface only; no product fake provider or network implementation here.
 * Transport exceptions must become stable error codes without serializing secrets.
 */
export interface CredentialProvider {
  inspectInstance(adminInstanceId: string): Promise<CredentialProviderCapability>;
  create(request: CreateCredentialIntent): Promise<PrivateNativeCredentialReceipt>;
  extendSameKey(request: ExtendCredentialIntent): Promise<{changed: boolean}>;
  read(credentialId: string, adminInstanceId: string): Promise<NativeCredentialReadback | null>;
  revoke(request: {credentialId: string; instance: string}): Promise<{success: boolean}>;
  observeAuthenticatedPeer(request: {instance: string; expectedProviderGeneration: number; scope: CommunityGrantScope}):
    Promise<ProviderPeerObservation | {status: 'pending'; code: 'no-connection-key' | 'unstable-sample'}>;
}
/** Derived from authenticated connection + current membership, never request body. */
export interface GrantAuthorization {
  scope: CommunityGrantScope; epoch: number; isMember: boolean;
}
export interface CommunityGrantRecord {
  scope: CommunityGrantScope; revision: number;
  state: 'prepared' | 'active' | 'revoke-pending' | 'revoked';
  grant: PrivateCommunityGrant | null;
  /** Secret-free durable cleanup intent; retained after active secret is discarded. */
  revocation?: {grantId: string; credentialId: string; adminInstanceId: string};
}
export interface CommunityGrantOperation {
  operation: 'acquire' | 'renew'; requestId: string; grantId: string; credentialId: string;
  intent: TrustedCommunityIntent; authority: NativeAuthority;
  priorRevision: number; revision: number; authorizationEpoch: number;
  issuedAtMs: number; renewAfterMs: number; expiresAtMs: number;
}
export function expiryUnixToMs(value: unknown): number {
  if (!positive(value) || !Number.isSafeInteger(value * 1000)) fail('invalid-native-expiry');
  return value * 1000;
}
function expiryMsToUnix(value: number): number {
  if (!positive(value) || value % 1000 !== 0) fail('invalid-native-expiry');
  return value / 1000;
}
function authorityShape(value: unknown): asserts value is NativeAuthority {
  exact<NativeAuthority>(value, ['adminInstanceId', 'upstreamCommit', 'groups'], 'invalid-authority');
  if (!uuid(value.adminInstanceId) || value.upstreamCommit !== COMMUNITY_ET_UPSTREAM_COMMIT ||
      !safeArray(value.groups, 32) || value.groups.length === 0 ||
      !value.groups.every(id) || new Set(value.groups).size !== value.groups.length) fail('invalid-authority');
}
/** Run before mutation; an unavailable/lost store is not an empty new generation. */
export function assertCredentialProviderCapability(value: unknown, authority: NativeAuthority): void {
  authorityShape(authority);
  exact<CredentialProviderCapability>(value, ['instance', 'upstreamCommit', 'sameKeyUpsert', 'credentialStore'], 'invalid-provider-capability');
  if (value.instance !== authority.adminInstanceId || value.upstreamCommit !== authority.upstreamCommit ||
      value.sameKeyUpsert !== true || value.credentialStore !== 'healthy') fail('provider-incompatible');
}
function authorize(value: unknown, expected: CommunityGrantScope, epoch: number): void {
  exact<GrantAuthorization>(value, ['scope', 'epoch', 'isMember'], 'invalid-authorization'); scope(value.scope);
  if (!sameScope(value.scope, expected) || !positive(value.epoch) || value.epoch !== epoch || value.isMember !== true)
    fail('authorization-retired');
}
export function recordShape(value: unknown): asserts value is CommunityGrantRecord {
  const keys = ['scope', 'revision', 'state', 'grant'];
  if (value && typeof value === 'object' && own(value, 'revocation')) keys.push('revocation');
  exact<CommunityGrantRecord>(value, keys, 'invalid-grant-record'); scope(value.scope);
  if (!natural(value.revision) || !['prepared', 'active', 'revoke-pending', 'revoked'].includes(value.state)) fail('invalid-grant-record');
  if (value.grant !== null) {
    versionedGrantShape(value.grant);
    if (!sameScope(value.scope, value.grant.scope) || value.revision !== value.grant.revision) fail('invalid-grant-record');
  }
  if ((value.state === 'active') !== (value.grant !== null)) fail('invalid-grant-record');
  if (value.state === 'revoke-pending' || value.state === 'revoked') {
    exact<NonNullable<CommunityGrantRecord['revocation']>>(value.revocation,
      ['grantId', 'credentialId', 'adminInstanceId'], 'invalid-revocation-record');
    if (!id(value.revocation.grantId) || !id(value.revocation.credentialId) || !uuid(value.revocation.adminInstanceId))
      fail('invalid-revocation-record');
  } else if (own(value, 'revocation')) fail('invalid-grant-record');
}
function operationShape(value: unknown): asserts value is CommunityGrantOperation {
  exact<CommunityGrantOperation>(value, ['operation', 'requestId', 'grantId', 'credentialId', 'intent', 'authority',
    'priorRevision', 'revision', 'authorizationEpoch', 'issuedAtMs', 'renewAfterMs', 'expiresAtMs'], 'invalid-operation');
  intent(value.intent); authorityShape(value.authority);
  if (!['acquire', 'renew'].includes(value.operation) || !id(value.requestId) || !id(value.grantId) || !id(value.credentialId) ||
      !natural(value.priorRevision) || !positive(value.revision) || value.revision !== value.priorRevision + 1 ||
      !positive(value.authorizationEpoch) || !natural(value.issuedAtMs) || !natural(value.renewAfterMs) ||
      !positive(value.expiresAtMs) || value.issuedAtMs >= value.renewAfterMs || value.renewAfterMs >= value.expiresAtMs ||
      value.expiresAtMs - value.issuedAtMs > 3_600_000) fail('invalid-operation');
  expiryMsToUnix(value.issuedAtMs); expiryMsToUnix(value.expiresAtMs);
}
function checkOperationCurrent(op: CommunityGrantOperation, record: CommunityGrantRecord, auth: GrantAuthorization): void {
  operationShape(op); recordShape(record); authorize(auth, op.intent, op.authorizationEpoch);
  if (!sameScope(record.scope, op.intent) || record.revision !== op.priorRevision ||
      record.state === 'revoked' || record.state === 'revoke-pending') fail('operation-retired');
  if (op.operation === 'acquire' && record.state !== 'prepared') fail('active-grant-exists');
  if (op.operation === 'renew') {
    const old = record.grant;
    if (!old || old.grantId !== op.grantId || old.credentialId !== op.credentialId ||
        old.networkName !== op.intent.networkName || old.networkRevision !== op.intent.networkRevision ||
        old.virtualIp !== op.intent.virtualIp || old.bootstrapProfileId !== op.intent.bootstrapProfileId)
      fail('renewal-identity-changed');
    if (op.issuedAtMs >= old.expiresAtMs || op.expiresAtMs <= old.expiresAtMs) fail('renewal-not-extended');
  }
}
/** Persist the immutable operation and fixed IDs BEFORE issuing this command.
 * Serialize per scope/credential; after an unknown outcome, read/recover this ID.
 * This planner neither persists records nor performs real credential issuance.
 */
export function planCommunityCredentialOperation(op: CommunityGrantOperation, record: CommunityGrantRecord, auth: GrantAuthorization):
  {kind: 'Generate'; request: CreateCredentialIntent} | {kind: 'Upsert'; request: ExtendCredentialIntent} {
  checkOperationCurrent(op, record, auth);
  const shared = {instance: op.authority.adminInstanceId, groups: [...op.authority.groups],
    reusable: false as const, allowRelay: false as const, allowedProxyCidrs: [] as []};
  if (op.operation === 'acquire') return {kind: 'Generate', request: {...shared, credentialId: op.credentialId,
    ttlSeconds: (op.expiresAtMs - op.issuedAtMs) / 1000}};
  return {kind: 'Upsert', request: {...shared, id: op.credentialId, secret: record.grant!.credentialSecretB64,
    expiryUnix: expiryMsToUnix(op.expiresAtMs)}};
}
/** Must be called against the latest persisted record and authorization epoch
 * AFTER native completion/readback, under the same serialized transaction.
 * On any failure after a possible mutation, owner must compensate/reconcile revoke.
 * Generate's existing-ID expiry is checked here; changed=false alone is irrelevant.
 */
export function commitCommunityCredentialReadback(op: CommunityGrantOperation, current: CommunityGrantRecord, auth: GrantAuthorization,
  receipt: unknown, readback: unknown, serverTimeMs: number): CommunityGrantRecord {
  checkOperationCurrent(op, current, auth);
  exact<PrivateNativeCredentialReceipt>(receipt, ['credentialId', 'credentialSecretB64', 'expiryUnix', 'derivedPublicKeyFingerprint'], 'invalid-native-receipt');
  exact<NativeCredentialReadback>(readback, ['id', 'groups', 'allowRelay', 'allowedProxyCidrs', 'reusable', 'expiryUnix', 'publicKeyFingerprint'], 'invalid-native-readback');
  keyBytes(receipt.credentialSecretB64);
  const nativeExpiresAtMs = expiryUnixToMs(receipt.expiryUnix);
  if (receipt.credentialId !== op.credentialId || !fingerprint(receipt.derivedPublicKeyFingerprint) ||
      readback.id !== op.credentialId || readback.publicKeyFingerprint !== receipt.derivedPublicKeyFingerprint ||
      expiryUnixToMs(readback.expiryUnix) !== nativeExpiresAtMs ||
      (op.operation === 'renew' && nativeExpiresAtMs !== op.expiresAtMs))
    fail('native-readback-mismatch');
  if (readback.reusable !== false || readback.allowRelay !== false || !safeArray(readback.allowedProxyCidrs, 0) ||
      readback.allowedProxyCidrs.length !== 0 || !safeArray(readback.groups, 32) ||
      readback.groups.length !== op.authority.groups.length || !readback.groups.every(id) ||
      new Set(readback.groups).size !== readback.groups.length || !op.authority.groups.every(g => readback.groups.includes(g)))
    fail('unsafe-native-policy');
  if (!natural(serverTimeMs) || serverTimeMs < op.issuedAtMs || serverTimeMs >= nativeExpiresAtMs ||
      serverTimeMs >= op.renewAfterMs || op.renewAfterMs >= nativeExpiresAtMs ||
      nativeExpiresAtMs - serverTimeMs > op.expiresAtMs - op.issuedAtMs ||
      (current.grant && serverTimeMs >= current.grant.expiresAtMs)) fail('invalid-grant-time');
  if (current.grant && (receipt.credentialSecretB64 !== current.grant.credentialSecretB64 ||
      receipt.derivedPublicKeyFingerprint !== current.grant.publicKeyFingerprint)) fail('renewal-identity-changed');
  const grant: PrivateCommunityGrantV1 = {v: 1, requestId: op.requestId, scope: copiedScope(op.intent),
    grantId: op.grantId, credentialId: op.credentialId, revision: op.revision,
    networkName: op.intent.networkName, networkRevision: op.intent.networkRevision,
    virtualIp: op.intent.virtualIp, bootstrapProfileId: op.intent.bootstrapProfileId,
    // Generate determines native expiry relative to its execution time, not the
    // application's request start. Never manufacture expiry from the planned TTL.
    issuedAtMs: serverTimeMs, renewAfterMs: op.renewAfterMs, expiresAtMs: nativeExpiresAtMs, serverTimeMs,
    publicKeyFingerprint: receipt.derivedPublicKeyFingerprint, credentialSecretB64: receipt.credentialSecretB64,
    policy: {reusable: false, allowRelay: false, allowedProxyCidrs: []}};
  return {scope: copiedScope(op.intent), revision: op.revision, state: 'active', grant};
}
/** Commit tombstone before revocation RPC; retain cleanup work on unknown/failure.
 * Only a matching active grant retires the record. Old revoke cannot kill new acquire.
 */
export function retireCommunityGrant(current: CommunityGrantRecord, grantId: string, authority: NativeAuthority): CommunityGrantRecord {
  recordShape(current); authorityShape(authority); if (!id(grantId)) fail('invalid-revocation');
  if (current.state !== 'active' || current.grant!.grantId !== grantId) return structuredClone(current);
  if (!Number.isSafeInteger(current.revision + 1)) fail('invalid-grant-record');
  return {scope: copiedScope(current.scope), revision: current.revision + 1, state: 'revoke-pending', grant: null,
    revocation: {grantId, credentialId: current.grant!.credentialId, adminInstanceId: authority.adminInstanceId}};
}
/** Correct-instance absence readback confirms removal, not network propagation. */
export function confirmCommunityGrantRevoked(current: CommunityGrantRecord, evidence: unknown): CommunityGrantRecord {
  recordShape(current);
  exact<{instance: string; credentialId: string; readback: NativeCredentialReadback | null}>(evidence,
    ['instance', 'credentialId', 'readback'], 'invalid-revocation-readback');
  if (current.state !== 'revoke-pending' || evidence.instance !== current.revocation!.adminInstanceId ||
      evidence.credentialId !== current.revocation!.credentialId || evidence.readback !== null) fail('revocation-unconfirmed');
  return {...structuredClone(current), state: 'revoked'};
}
