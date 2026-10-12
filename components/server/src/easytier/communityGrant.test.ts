import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCredentialProviderCapability, COMMUNITY_ET_UPSTREAM_COMMIT, commitCommunityCredentialReadback, confirmCommunityGrantRevoked,
  ContractError, expiryUnixToMs, planCommunityCredentialOperation, publicKeyFingerprint, retireCommunityGrant,
  type CommunityGrantOperation, type CommunityGrantRecord, type CredentialProvider, type GrantAuthorization,
  type NativeCredentialReadback, type PrivateNativeCredentialReceipt,
} from './communityGrant';

const NATIVE = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const SECRET = Buffer.alloc(32, 0x42).toString('base64'); // Synthetic public fixture, not a keypair.
const FP = publicKeyFingerprint(Buffer.alloc(32, 0x31).toString('base64'));
function fixture() {
  const scope = {serverInstanceId: 'backend-one', accountId: 'a', communityId: 'c', deviceId: 'd', nativeInstanceId: NATIVE};
  const record: CommunityGrantRecord = {scope, revision: 7, state: 'prepared', grant: null};
  const auth: GrantAuthorization = {scope, epoch: 5, isMember: true};
  const op: CommunityGrantOperation = {operation: 'acquire', requestId: 'req', grantId: 'grant', credentialId: 'opaque-id',
    intent: {...scope, networkName: 'network', networkRevision: 1, virtualIp: '10.77.1.2', bootstrapProfileId: 'profile'},
    authority: {adminInstanceId: ADMIN, upstreamCommit: COMMUNITY_ET_UPSTREAM_COMMIT, groups: ['members']},
    priorRevision: 7, revision: 8, authorizationEpoch: 5, issuedAtMs: 2_000_000, renewAfterMs: 2_030_000, expiresAtMs: 2_060_000};
  const receipt: PrivateNativeCredentialReceipt = {credentialId: op.credentialId, credentialSecretB64: SECRET,
    expiryUnix: 2060, derivedPublicKeyFingerprint: FP};
  const readback: NativeCredentialReadback = {id: op.credentialId, groups: ['members'], allowRelay: false,
    allowedProxyCidrs: [], reusable: false, expiryUnix: 2060, publicKeyFingerprint: FP};
  return {op, record, auth, receipt, readback};
}
function commit(f: ReturnType<typeof fixture>) {
  return commitCommunityCredentialReadback(f.op, f.record, f.auth, f.receipt, f.readback, f.op.issuedAtMs);
}
function rejects(fn: () => unknown, code: string) {
  assert.throws(fn, (e: unknown) => e instanceof ContractError && e.code === code && !e.message.includes(SECRET));
}
function renewal() {
  const f = fixture(); f.record = commit(f);
  f.op = {...f.op, operation: 'renew', priorRevision: 8, revision: 9, issuedAtMs: 2_010_000,
    renewAfterMs: 2_050_000, expiresAtMs: 2_090_000};
  f.receipt.expiryUnix = 2090; f.readback.expiryUnix = 2090;
  return f;
}
test('fixed-ID Generate targets selected admin instance with least privilege', () => {
  const f = fixture(); const p = planCommunityCredentialOperation(f.op, f.record, f.auth);
  assert.equal(p.kind, 'Generate'); assert.equal(p.request.instance, ADMIN);
  assert.equal(p.request.reusable, false); assert.equal(p.request.allowRelay, false);
  assert.deepEqual(p.request.allowedProxyCidrs, []); assert.equal(commit(f).revision, 8);
});
test('unknown outcome reuses the immutable operation ID instead of issuing a second ID', () => {
  const f = fixture(); assert.deepEqual(planCommunityCredentialOperation(f.op, f.record, f.auth), planCommunityCredentialOperation(f.op, f.record, f.auth));
});
test('create uses actual native expiry after RPC delay rather than inventing app expiry', () => {
  const f = fixture(); f.receipt.expiryUnix = 2061; f.readback.expiryUnix = 2061;
  const r = commitCommunityCredentialReadback(f.op, f.record, f.auth, f.receipt, f.readback, 2_001_000);
  assert.equal(r.grant!.expiresAtMs, 2_061_000); assert.equal(r.grant!.issuedAtMs, 2_001_000);
});
test('native readback cannot extend a create beyond its requested TTL budget', () => {
  const f = fixture(); f.receipt.expiryUnix = 2061; f.readback.expiryUnix = 2061;
  rejects(() => commit(f), 'invalid-grant-time');
});
test('fake provider is test-only; changed=false Upsert requires exact readback', async () => {
  const f = renewal(); const calls: string[] = [];
  const provider: CredentialProvider = {
    inspectInstance: async instance => ({instance, upstreamCommit: COMMUNITY_ET_UPSTREAM_COMMIT, sameKeyUpsert: true, credentialStore: 'healthy'}),
    create: async () => { throw new Error('forbidden-test-generate'); },
    extendSameKey: async req => { calls.push(req.id); assert.equal(req.secret, SECRET); return {changed: false}; },
    read: async (id, instance) => { assert.equal(id, f.op.credentialId); assert.equal(instance, ADMIN); return f.readback; },
    revoke: async () => ({success: false}),
    observeAuthenticatedPeer: async () => ({status: 'pending', code: 'no-connection-key'}),
  };
  assertCredentialProviderCapability(await provider.inspectInstance(ADMIN), f.op.authority);
  const p = planCommunityCredentialOperation(f.op, f.record, f.auth);
  assert.equal(p.kind, 'Upsert'); if (p.kind !== 'Upsert') assert.fail();
  assert.equal((await provider.extendSameKey(p.request)).changed, false);
  const actual = await provider.read(f.op.credentialId, ADMIN);
  assert.equal(commitCommunityCredentialReadback(f.op, f.record, f.auth, f.receipt, actual, f.op.issuedAtMs).revision, 9);
  assert.deepEqual(calls, ['opaque-id']);
});
test('Generate existing-ID old expiry cannot masquerade as extension', () => {
  const f = renewal(); f.readback.expiryUnix = 2060; f.receipt.expiryUnix = 2060;
  rejects(() => commit(f), 'native-readback-mismatch');
});
test('member exit during provider call rejects late receipt', () => {
  const f = fixture(); f.auth.isMember = false; rejects(() => commit(f), 'authorization-retired');
});
test('changed authorization epoch rejects receipt even when currently a member', () => {
  const f = fixture(); f.auth.epoch++; rejects(() => commit(f), 'authorization-retired');
});
for (const field of ['accountId', 'communityId', 'deviceId', 'nativeInstanceId', 'serverInstanceId'] as const) {
  test(`trusted authorization cannot cross ${field}`, () => {
    const f = fixture(); f.auth.scope = {...f.auth.scope, [field]: field === 'nativeInstanceId' ? ADMIN : 'other'};
    rejects(() => planCommunityCredentialOperation(f.op, f.record, f.auth), 'authorization-retired');
  });
}
test('stale persisted revision rejects second commit', () => {
  const f = fixture(); f.record = commit(f); rejects(() => commit(f), 'operation-retired');
});
test('terminal revoke rejects late Upsert readback', () => {
  const f = renewal(); f.record = retireCommunityGrant(f.record, f.op.grantId, f.op.authority);
  rejects(() => commit(f), 'operation-retired');
  f.record = confirmCommunityGrantRevoked(f.record, {instance: ADMIN, credentialId: f.op.credentialId, readback: null});
  rejects(() => planCommunityCredentialOperation(f.op, f.record, f.auth), 'operation-retired');
});
test('old revoke preserves unrelated active grant and newly prepared acquire', () => {
  const f = fixture(); assert.deepEqual(retireCommunityGrant(f.record, 'old-grant', f.op.authority), f.record);
  f.record = commit(f); assert.deepEqual(retireCommunityGrant(f.record, 'old-grant', f.op.authority), f.record);
});
test('revocation is unconfirmed while correct-instance credential remains', () => {
  const f = fixture(); f.record = retireCommunityGrant(commit(f), 'grant', f.op.authority);
  rejects(() => confirmCommunityGrantRevoked(f.record, {instance: ADMIN, credentialId: f.op.credentialId, readback: f.readback}), 'revocation-unconfirmed');
  assert.equal(confirmCommunityGrantRevoked(f.record, {instance: ADMIN, credentialId: f.op.credentialId, readback: null}).state, 'revoked');
  assert.deepEqual(f.record.revocation, {grantId: 'grant', credentialId: 'opaque-id', adminInstanceId: ADMIN});
  assert.equal(JSON.stringify(f.record).includes(SECRET), false);
  rejects(() => confirmCommunityGrantRevoked(f.record, {instance: NATIVE, credentialId: 'opaque-id', readback: null}), 'revocation-unconfirmed');
});
for (const patch of [{reusable: true}, {allowRelay: true}, {allowedProxyCidrs: ['10.0.0.0/8']}, {groups: ['admin']}, {groups: ['members', 'members']}]) {
  test(`native policy readback rejects ${JSON.stringify(patch)}`, () => {
    const f = fixture(); Object.assign(f.readback, patch); rejects(() => commit(f), 'unsafe-native-policy');
  });
}
test('derived public-key mismatch fails closed without interpreting credential ID', () => {
  const f = fixture(); f.readback.publicKeyFingerprint = 'f'.repeat(64); rejects(() => commit(f), 'native-readback-mismatch');
});
test('same-key renewal rejects rotated private key', () => {
  const f = renewal(); f.receipt.credentialSecretB64 = Buffer.alloc(32, 0x43).toString('base64');
  rejects(() => commit(f), 'renewal-identity-changed');
});
test('upstream pin mismatch and unaligned native expiry are rejected', () => {
  const f = fixture(); rejects(() => planCommunityCredentialOperation({...f.op, authority: {...f.op.authority, upstreamCommit: 'wrong'} as unknown as typeof f.op.authority}, f.record, f.auth), 'invalid-authority');
  f.op.expiresAtMs++; rejects(() => planCommunityCredentialOperation(f.op, f.record, f.auth), 'invalid-native-expiry');
});
for (const value of [Number.MAX_SAFE_INTEGER, '2060', -1, 0, 1.5]) test(`reject unsafe expiry ${value}`, () => {
  rejects(() => expiryUnixToMs(value), 'invalid-native-expiry');
});
test('unknown native field and getter receipt are rejected without evaluating secrets', () => {
  const f = fixture(); rejects(() => commitCommunityCredentialReadback(f.op, f.record, f.auth, {...f.receipt, secretDump: SECRET}, f.readback, f.op.issuedAtMs), 'invalid-native-receipt');
  Object.defineProperty(f.receipt, 'credentialSecretB64', {get: () => { assert.fail('getter evaluated'); }});
  rejects(() => commit(f), 'invalid-native-receipt');
});
test('provider late response cannot commit expired record', () => {
  const f = renewal(); rejects(() => commitCommunityCredentialReadback(f.op, f.record, f.auth, f.receipt, f.readback, 2_060_000), 'invalid-grant-time');
});
test('native group array getters and hidden policy fields cannot enter private state', () => {
  const f = fixture(); Object.defineProperty(f.readback.groups, '0', {get: () => { assert.fail('getter evaluated'); }});
  rejects(() => commit(f), 'unsafe-native-policy');
  const other = fixture(); Object.assign(other.readback.allowedProxyCidrs, {secretDump: SECRET});
  rejects(() => commit(other), 'unsafe-native-policy');
});
for (const patch of [{instance: ''}, {upstreamCommit: 'wrong'}, {sameKeyUpsert: false}, {credentialStore: 'unavailable'}]) {
  test(`provider capability rejects ${JSON.stringify(patch)}`, () => {
    const f = fixture(); const capability = {instance: ADMIN, upstreamCommit: COMMUNITY_ET_UPSTREAM_COMMIT,
      sameKeyUpsert: true, credentialStore: 'healthy', ...patch};
    rejects(() => assertCredentialProviderCapability(capability, f.op.authority), 'provider-incompatible');
  });
}
