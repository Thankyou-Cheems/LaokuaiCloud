import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyBracketedDeviceBinding, verifyCurrentDeviceBinding, type ProviderPeerObservation } from './communityDeviceBinding';
import { ContractError, publicKeyFingerprint, type CommunityGrantRecord } from './communityGrant';

function fixture() {
  const key = Buffer.alloc(32, 0x31).toString('base64');
  const scope = {serverInstanceId: 'backend', accountId: 'a', communityId: 'c', deviceId: 'd', nativeInstanceId: '11111111-1111-4111-8111-111111111111'};
  const current: CommunityGrantRecord = {scope, revision: 2, state: 'active', grant: {
    v: 1, requestId: 'req', scope, grantId: 'g', credentialId: 'opaque-management-id', revision: 2,
    networkName: 'n', networkRevision: 1, virtualIp: '10.77.1.2', bootstrapProfileId: 'b',
    issuedAtMs: 1000, serverTimeMs: 1000, renewAfterMs: 2000, expiresAtMs: 3000,
    credentialSecretB64: Buffer.alloc(32, 0x42).toString('base64'), publicKeyFingerprint: publicKeyFingerprint(key),
    policy: {reusable: false, allowRelay: false, allowedProxyCidrs: []},
  }};
  const observation: ProviderPeerObservation = {providerGeneration: 1, observedMonoMs: 2000, networkName: 'n',
    connections: [{peerId: 71, networkName: 'n', isClosed: false, secureAuthLevel: 2, peerIdentityType: 1, remotePublicKeyB64: key}],
    routes: [{peerId: 71, nativeInstanceId: scope.nativeInstanceId, virtualIp: '10.77.1.2', nextHopPeerId: 99}]};
  return {current, observation};
}
function verify(f: ReturnType<typeof fixture>, serverTime = 2000) {
  return verifyCurrentDeviceBinding(f.current, f.observation, serverTime, 2000, 1);
}
function rejects(fn: () => unknown, code: string) { assert.throws(fn, (e: unknown) => e instanceof ContractError && e.code === code); }
test('current record projects exact credential binding with relay next-hop and no media claim', () => {
  const b = verify(fixture()); assert.equal(b.peerId, 71); assert.equal(b.revision, 2);
  assert.equal(b.physicalDirectVerified, false); assert.equal('credentialSecretB64' in b, false);
});
test('expired grant cannot prove a device despite fresh provider observation', () => {
  rejects(() => verify(fixture(), 3000), 'inactive-binding-grant');
});
test('revoke-pending and revoked records cannot bind', () => {
  for (const state of ['revoke-pending', 'revoked'] as const) {
    const f = fixture(); f.current.state = state; f.current.grant = null;
    f.current.revocation = {grantId: 'g', credentialId: 'opaque-management-id', adminInstanceId: '22222222-2222-4222-8222-222222222222'};
    rejects(() => verify(f), 'inactive-binding-grant');
  }
});
test('stale record revision and foreign scope cannot be joined', () => {
  const f = fixture(); f.current.revision++;
  rejects(() => verify(f), 'invalid-grant-record');
  const other = fixture(); other.current.scope = {...other.current.scope, communityId: 'other'};
  rejects(() => verify(other), 'invalid-grant-record');
});
test('mixed provider key sample fails closed', () => {
  const f = fixture(); f.observation.connections.push({...f.observation.connections[0], remotePublicKeyB64: Buffer.alloc(32, 0x33).toString('base64')});
  rejects(() => verify(f), 'connection-evidence-conflict');
});
test('no remote key/route-only evidence does not authenticate', () => {
  const f = fixture(); f.observation.connections = []; rejects(() => verify(f), 'binding-unproven');
});
test('provider runtime generation and observation freshness remain mandatory', () => {
  const f = fixture(); f.observation.providerGeneration = 2; rejects(() => verify(f), 'provider-observation-mismatch');
  f.observation.providerGeneration = 1; f.observation.observedMonoMs = 2001;
  rejects(() => verify(f), 'provider-observation-mismatch');
});
test('bracketed identity/route samples must remain stable in one generation', () => {
  const f = fixture(); const after = structuredClone(f.observation);
  assert.equal(verifyBracketedDeviceBinding(f.current, f.observation, after, 2000, 2000, 1).peerId, 71);
  after.routes[0].nextHopPeerId++;
  rejects(() => verifyBracketedDeviceBinding(f.current, f.observation, after, 2000, 2000, 1), 'provider-sample-conflict');
});
test('accessor/sparse provider arrays are rejected before sampling any getter', () => {
  const f = fixture(); Object.defineProperty(f.observation.connections, '0', {get: () => { assert.fail('getter evaluated'); }});
  rejects(() => verify(f), 'provider-observation-mismatch');
  f.observation.connections = Array(1); rejects(() => verify(f), 'provider-observation-mismatch');
});
test('connection-level native network name cannot be borrowed from another community', () => {
  const f = fixture(); f.observation.connections[0].networkName = 'other';
  rejects(() => verify(f), 'connection-network-mismatch');
});
