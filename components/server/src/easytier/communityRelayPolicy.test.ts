import assert from 'node:assert/strict';
import test from 'node:test';
import { ContractError, grantShape, relayConsentShape } from './communityGrant';
import { parseRelayRequest } from './communityRelayPolicy';

const BODY={v:2,communityId:'community',deviceId:'device',nativeInstanceId:'11111111-1111-4111-8111-111111111111',requestId:'request',grantId:'grant',expectedConsentRevision:0,enabled:true,bytesPerSecond:65536};
test('V2 relay request is explicit, bounded, scoped and rejects native credential/role overrides',()=>{
  assert.deepEqual(parseRelayRequest(BODY),BODY);
  for(const patch of [{v:1},{enabled:'true'},{bytesPerSecond:0},{bytesPerSecond:1048577},{enabled:false,bytesPerSecond:65536},{expectedConsentRevision:-1},{accountId:'other'},{allowRelay:true},{credentialSecretB64:'secret'}])
    assert.throws(()=>parseRelayRequest({...BODY,...patch}),ContractError);
  assert.doesNotThrow(()=>parseRelayRequest({...BODY,enabled:false,bytesPerSecond:0}));
});
test('relay consent requires revision and nonzero native budget; V1 contract remains strict',()=>{
  assert.doesNotThrow(()=>relayConsentShape({v:2,enabled:false,revision:0,bytesPerSecond:0}));
  assert.throws(()=>relayConsentShape({v:2,enabled:true,revision:0,bytesPerSecond:65536}),ContractError);
  assert.throws(()=>grantShape({v:2,policy:{allowRelay:true}}),ContractError);
});
