import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCommunityGrantRequest } from './communityGrantApi';
import { ContractError } from './communityGrant';

const base = {v:1 as const,communityId:'community',deviceId:'device',nativeInstanceId:'11111111-1111-4111-8111-111111111111'};
test('single owner session contract has community/device/native scope, no session capability', () => {
  assert.deepEqual(parseCommunityGrantRequest('session',base),base);
});
test('acquire includes request ID and renew/revoke include current grant ID', () => {
  const acquire = {...base,requestId:'request'};
  assert.deepEqual(parseCommunityGrantRequest('acquire',acquire),acquire);
  for (const operation of ['renew','revoke'] as const) {
    const body = {...acquire,grantId:'grant'};
    assert.deepEqual(parseCommunityGrantRequest(operation,body),body);
  }
});
test('binding requires live grant reference and no client peer/IP evidence', () => {
  const body = {...base,grantId:'grant'};
  assert.deepEqual(parseCommunityGrantRequest('binding',body),body);
  for (const extra of [{peerId:1},{virtualIp:'10.77.1.2'}]) {
    assert.throws(() => parseCommunityGrantRequest('binding',{...body,...extra}), ContractError);
  }
});
for (const field of ['accountId','serverUserId','sessionId','networkName','adminInstanceId','credentialSecretB64','rpcUrl','bootstrap']) {
  test(`reject client-provided ${field}`, () => {
    assert.throws(() => parseCommunityGrantRequest('session',{...base,[field]:'untrusted'}), ContractError);
  });
}
test('invalid UUID and missing renewal identity are rejected', () => {
  assert.throws(() => parseCommunityGrantRequest('session',{...base,nativeInstanceId:'not-uuid'}), ContractError);
  assert.throws(() => parseCommunityGrantRequest('renew',{...base,requestId:'request'}), ContractError);
});
test('accessor and mutable caller objects cannot change validated body', () => {
  const request = {...base}; const parsed = parseCommunityGrantRequest('session',request);
  request.deviceId = 'other'; assert.equal(parsed.deviceId,'device');
  Object.defineProperty(request,'deviceId',{get:() => assert.fail('getter must not run')});
  assert.throws(() => parseCommunityGrantRequest('session',request), ContractError);
});
