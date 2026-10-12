import assert from 'node:assert/strict';
import test from 'node:test';
import {COMMUNITY_ET_UPSTREAM_COMMIT} from '../easytier/communityGrant';
import {parseCommunityEtDeployment} from './communityEt';

function fixture() {
  const adminInstanceId = '11111111-1111-4111-8111-111111111111';
  return {schemaVersion: 1, approved: true, expiresAtUnixMs: 2000000, credentialWritesApproved: false,
    trustedServerOrigin: 'https://test.invalid', nativeRuntimeGeneration: 1234,
    service: {serverInstanceId: 'backend', communityId: 'community', networkName: 'network', networkRevision: 1,
      bootstrapProfileId: 'profile', virtualIpPool: ['10.77.1.2', '10.77.1.3'],
      authority: {adminInstanceId, upstreamCommit: COMMUNITY_ET_UPSTREAM_COMMIT, groups: ['community-member']}, ttlSeconds: 300},
    provider: {adminInstanceId, expectedVersion: '2.7.0-8b7f1f01', endpoint: {host: '127.0.0.1', port: 15890, timeoutMs: 1000}},
    managementSocketPath: null};
}
test('trusted deployment keeps credential mutations disabled until explicitly approved', () => {
  const f = fixture(), result = parseCommunityEtDeployment(f, 1000000);
  assert.equal(result.credentialWritesApproved, false);
  f.service.virtualIpPool[0] = '10.77.1.8'; assert.equal(result.service.virtualIpPool[0], '10.77.1.2');
});
test('real existing CJK namespace is preserved by deployment parsing', () => {
  const f=fixture();f.service.serverInstanceId='老蒯聊_5000_default';f.service.communityId=f.service.serverInstanceId;
  const parsed=parseCommunityEtDeployment(f,1000000);
  assert.equal(parsed.service.communityId,'老蒯聊_5000_default');
  assert.equal(parsed.credentialWritesApproved,false);
});
const cases: Array<[string, (f: ReturnType<typeof fixture>) => void]> = [
  ['approval', f => f.approved = false], ['expiry', f => f.expiresAtUnixMs = 1000000],
  ['http', f => f.trustedServerOrigin = 'http://test.invalid'], ['userinfo', f => f.trustedServerOrigin = 'https://user@test.invalid'],
  ['old version', f => f.provider.expectedVersion = '2.6.4'], ['old/private RPC', f => f.provider.endpoint.port = 15888],
  ['public RPC', f => f.provider.endpoint.host = '0.0.0.0'], ['test-only RPC', f => f.provider.endpoint.port = 15889],
  ['provider deadline mismatch', f => f.provider.endpoint.timeoutMs = 1001],
  ['large grant TTL', f => f.service.ttlSeconds = 301], ['public virtual IP', f => f.service.virtualIpPool[0] = '1.2.3.4'],
  ['duplicate IP', f => f.service.virtualIpPool[1] = f.service.virtualIpPool[0]], ['wrong native scope', f => f.provider.adminInstanceId = 'other'],
  ['invalid runtime generation', f => f.nativeRuntimeGeneration = 0],
];
for (const [name, mutate] of cases) test('deployment rejects ' + name, () => {
  const f = fixture(); mutate(f); assert.throws(() => parseCommunityEtDeployment(f, 1000000));
});
test('no private issuer seed or native store path is accepted in deployment provider', () => {
  const f = fixture(); const provider = {...f.provider, nativeCredentialFile: '/root/private-seeds.json'};
  assert.throws(() => parseCommunityEtDeployment({...f, provider}, 1000000));
});
test('only exact approved local management socket is accepted; no helper is created', () => {
  const f = fixture();
  assert.equal(parseCommunityEtDeployment({...f, managementSocketPath: '/run/laokuai-community-et/public-management.sock'}, 1000000).provider.endpoint.port, 15890);
  assert.throws(() => parseCommunityEtDeployment({...f, managementSocketPath: '/var/run/docker.sock'}, 1000000));
});
