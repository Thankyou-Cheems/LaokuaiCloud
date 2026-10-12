import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveCredentialFingerprint, FixedInstanceCredentialProvider, type FixedCredentialProviderConfig } from './communityCredentialProvider';
import { COMMUNITY_ET_UPSTREAM_COMMIT, ContractError, publicKeyFingerprint, type CreateCredentialIntent } from './communityGrant';
import { pbBytes, pbNumber, pbString, type CommunityRpcTransport, type RpcMethod } from './communityRpcWire';

const ADMIN='22222222-2222-4222-8222-222222222222';
const DEVICE='11111111-1111-4111-8111-111111111111';
const configuration=(): FixedCredentialProviderConfig=>({upstreamCommit:COMMUNITY_ET_UPSTREAM_COMMIT,adminInstanceId:ADMIN,
  expectedVersion:'2.7.0-8b7f1f01',networkName:'network',
  endpoint:{host:'127.0.0.1',port:15890,timeoutMs:1000},runtimeGeneration:()=>1,expectedActiveCredentials:()=>[]});
const code=(expected:string)=>(error:unknown)=>error instanceof ContractError && error.code===expected;

test('RFC7748 existing X25519 secret derives the decoded public-key fingerprint',()=>{
  const secret=Buffer.from('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a','hex');
  const publicKey=Buffer.from('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a','hex');
  assert.equal(deriveCredentialFingerprint(secret.toString('base64')),publicKeyFingerprint(publicKey.toString('base64')));
});
test('trusted configuration rejects external endpoints, old versions and unknown fields before I/O',()=>{
  let calls=0;const wire: CommunityRpcTransport={call:async()=>{calls++;throw new Error('must-not-call');}};
  const invalid=[{...configuration(),expectedVersion:'2.6.4-8428a89d'},
    {...configuration(),endpoint:{host:'0.0.0.0',port:15890,timeoutMs:1000}},
    {...configuration(),rpcUrl:'https://untrusted.invalid'},
    {...configuration(),endpoint:{host:'127.0.0.1',port:15890,timeoutMs:1000,extra:true}}];
  for (const c of invalid) assert.throws(()=>new FixedInstanceCredentialProvider(c as FixedCredentialProviderConfig,wire),code('invalid-provider-config'));
  assert.equal(calls,0);
});
test('one-based NodeInfo7/ListCredentials3 accept a native empty repeated-field response',async()=>{
  const methods: RpcMethod[]=[];
  const wire: CommunityRpcTransport={call:async method=>{
    methods.push(method);
    if (method.service==='PeerManageRpc'&&method.index===7) return pbBytes(1,Buffer.concat([pbNumber(1,42),pbString(6,ADMIN),pbString(9,'2.7.0-8b7f1f01')]));
    assert.deepEqual(method,{service:'CredentialManageRpc',index:3});return Buffer.alloc(0);
  }};
  const provider=new FixedInstanceCredentialProvider(configuration(),wire);
  assert.equal((await provider.inspectInstance(ADMIN)).credentialStore,'healthy');
  assert.equal(await provider.read('opaque-management-id',ADMIN),null);
  assert.deepEqual(methods.map(m=>m.index),[7,3,3]);
});
test('lost native store with active ledger and unsafe Generate policy fail before mutation',async()=>{
  let calls=0;const wire: CommunityRpcTransport={call:async method=>{
    if (method.service==='CredentialManageRpc'&&method.index!==3) calls++;
    return method.service==='PeerManageRpc'?pbBytes(1,Buffer.concat([pbNumber(1,42),pbString(6,ADMIN),pbString(9,'2.7.0-8b7f1f01')])):Buffer.alloc(0);
  }};
  const c=configuration();c.expectedActiveCredentials=()=>[{credentialId:'opaque-id',publicKeyFingerprint:'a'.repeat(64),expiresAtMs:1000}];
  const lost=new FixedInstanceCredentialProvider(c,wire);
  await assert.rejects(lost.inspectInstance(ADMIN),code('issuer-store-unavailable'));
  const healthy=new FixedInstanceCredentialProvider(configuration(),wire);
  await assert.rejects(healthy.create({instance:ADMIN,credentialId:'opaque-id',ttlSeconds:120,groups:['group'],
    reusable:true,allowRelay:false,allowedProxyCidrs:[]} as unknown as CreateCredentialIntent),code('unsafe-native-request'));
  await assert.rejects(healthy.read('opaque-id',DEVICE),code('invalid-admin-instance'));assert.equal(calls,0);
});
test('actual decoder brackets Noise connections around route and rejects contradictory sampling',async()=>{
  let peerReads=0;
  const wire: CommunityRpcTransport={call:async method=>{
    if (method.index===7) return pbBytes(1,Buffer.concat([pbNumber(1,42),pbString(6,ADMIN),pbString(9,'2.7.0-8b7f1f01')]));
    if (method.index===1) {
      peerReads++;const key=Buffer.alloc(32,peerReads===1?1:2);
      const conn=Buffer.concat([pbNumber(3,77),pbString(9,'network'),pbBytes(12,key),pbNumber(13,2),pbNumber(14,1)]);
      return pbBytes(1,Buffer.concat([pbNumber(1,77),pbBytes(2,conn)]));
    }
    assert.deepEqual(method,{service:'PeerManageRpc',index:3});
    return pbBytes(1,Buffer.concat([pbNumber(1,77),pbBytes(2,pbBytes(1,pbNumber(1,0x0a4d0002))),pbString(8,DEVICE)]));
  }};
  const provider=new FixedInstanceCredentialProvider(configuration(),wire);
  const sample=await provider.observeAuthenticatedPeer({instance:ADMIN,expectedProviderGeneration:1,
    scope:{serverInstanceId:'backend',accountId:'account',communityId:'community',deviceId:'device',nativeInstanceId:DEVICE}});
  assert.deepEqual(sample,{status:'pending',code:'unstable-sample'});
});
