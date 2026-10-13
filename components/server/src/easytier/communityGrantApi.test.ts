import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCommunityGrantRequest } from './communityGrantApi';
import { ContractError } from './communityGrant';

const base = {v:1 as const,communityId:'community',deviceId:'device',nativeInstanceId:'11111111-1111-4111-8111-111111111111'};
test('single owner session contract has community/device/native scope, no session capability', () => {
  assert.deepEqual(parseCommunityGrantRequest('session',base),base);
});
test('real existing CJK community ID reaches the canonical HTTP parser unchanged', () => {
  const value={...base,communityId:'老蒯聊_5000_default'};
  assert.deepEqual(parseCommunityGrantRequest('session',value),value);
  assert.throws(()=>parseCommunityGrantRequest('session',{...value,deviceId:'另一个设备'}));
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
test('directory has only the community scope and rejects client identity or address claims', () => {
  const body={v:1 as const,communityId:'community'};
  assert.deepEqual(parseCommunityGrantRequest('directory',body),body);
  for (const extra of [{serverUserId:'attacker'},{virtualIp:'10.77.1.2'},{deviceId:'device'}])
    assert.throws(()=>parseCommunityGrantRequest('directory',{...body,...extra}), ContractError);
});
test('DNS names are explicit opt-in; a member can neither supply a hostname nor relax the flag', () => {
  const body={v:1 as const,communityId:'community',includeDnsNames:true as const};
  assert.deepEqual(parseCommunityGrantRequest('directory',body),body);
  for (const flag of [false,undefined,null,'true',1]) assert.throws(()=>parseCommunityGrantRequest('directory',{...body,includeDnsNames:flag}),ContractError);
  for (const extra of [{dnsName:'victim.example'},{zone:'foreign.example'},{hostname:'attacker'},{dnsExpiresAtMs:9999999}])
    assert.throws(()=>parseCommunityGrantRequest('directory',{...body,...extra}),ContractError);
  let called=false;const accessor={...body};
  Object.defineProperty(accessor,'includeDnsNames',{get:()=>{called=true;return true;}});
  assert.throws(()=>parseCommunityGrantRequest('directory',accessor),ContractError);assert.equal(called,false);
});
test('friendly DNS negotiation requires the exact style and explicit DNS opt-in', () => {
  const base={v:1 as const,communityId:'community'},body={...base,includeDnsNames:true as const,dnsNameStyle:'friendly' as const};
  assert.deepEqual(parseCommunityGrantRequest('directory',body),body);
  assert.throws(()=>parseCommunityGrantRequest('directory',{...base,dnsNameStyle:'friendly'}),ContractError);
  for(const dnsNameStyle of [undefined,null,false,1,'legacy','Friendly','friendly '])
    assert.throws(()=>parseCommunityGrantRequest('directory',{...body,dnsNameStyle}),ContractError);
  for(const includeDnsNames of [undefined,false,null,'true',1])
    assert.throws(()=>parseCommunityGrantRequest('directory',{...body,includeDnsNames}),ContractError);
  Object.defineProperty(body,'dnsNameStyle',{get:()=>assert.fail('style getter must not run')});
  assert.throws(()=>parseCommunityGrantRequest('directory',body),ContractError);
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
