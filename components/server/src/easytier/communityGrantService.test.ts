import assert from 'node:assert/strict';
import { createDecipheriv, createPrivateKey, createPublicKey } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createCommunityMemberAuthorizer, type ExistingCommunityAuthServices } from './communityGrantAuth';
import { CommunityGrantService, type CommunityGrantServiceProvider } from './communityGrantService';
import { communityScopeKey, communityVaultKey, SqliteCommunityGrantStore } from './communityGrantStore';
import {
  COMMUNITY_ET_UPSTREAM_COMMIT, ContractError, grantShape, publicKeyFingerprint, type CommunityGrantScope,
  type NativeAuthority, type CreateCredentialIntent, type ExtendCredentialIntent, type NativeCredentialReadback, type PrivateNativeCredentialReceipt,
} from './communityGrant';
import type { ProviderPeerObservation } from './communityDeviceBinding';
import { COMMUNITY_DNS_MAX_AGE_MS, communityDnsZone } from './communityDnsNames';

const INSTANCE='11111111-1111-4111-8111-111111111111';
const ADMIN='22222222-2222-4222-8222-222222222222';
const BODY={v:1 as const,communityId:'community',deviceId:'device',nativeInstanceId:INSTANCE};
const START=1_000_000;
const AUTHORITY: NativeAuthority={adminInstanceId:ADMIN,upstreamCommit:COMMUNITY_ET_UPSTREAM_COMMIT,groups:['community-member']};

/** Fake provider only in pure tests; never exported or selected by product code. */
function fixture(communityId: string = BODY.communityId, databasePath = ':memory:') {
  const db=new DatabaseSync(databasePath),store=new SqliteCommunityGrantStore(db,communityVaultKey('PURE-TEST-VAULT-SECRET-01234567890123456789'));
  store.initSchema();
  const control={wall:START,mono:0,enabled:true,writes:true,member:true,serverVersion:0,userVersion:0,generation:1,
    relayEnabled:false,relayAfterApplyFail:false,relayBeforeApplyFail:false,relayCount:0,
    retainRevoked:false,upsertExtends:true,lateSample:false,wrongRoute:false,createCount:0,observeCount:0,revokeIds:[] as string[]};
  const services: ExistingCommunityAuthServices={
    verifyAccessToken:bearer=>{
      if (!['alice','alice-next','bob'].includes(bearer)) return null;
      const who=bearer==='bob'?'bob':'alice';
      return {grytUserId:who,serverUserId:'server-'+who,serverHost:'test.invalid',tokenVersion:0,userTokenVersion:0,
        iat:START/1000+(bearer==='alice-next'?1:-1),exp:START/1000+600};
    },
    getServerConfig:async()=>({token_version:control.serverVersion}),
    checkSessionAllowed:async identity=>({ok:true,user:{gryt_user_id:identity.grytUserId,server_user_id:identity.serverUserId,
      is_active:control.member,token_version:control.userVersion}}),
  };
  const auth=createCommunityMemberAuthorizer(services,{communityId,serverHost:'test.invalid'},()=>control.wall);
  const entries=new Map<string,{receipt:PrivateNativeCredentialReceipt;readback:NativeCredentialReadback;publicB64:string}>();
  let afterCreate: (()=>Promise<void>)|null=null;
  let duringExtend: (()=>void)|null=null;
  let afterObserve: ((sample: ProviderPeerObservation)=>Promise<void>)|null=null;
  const provider: CommunityGrantServiceProvider={
    inspectInstance:async instance=>({instance,upstreamCommit:COMMUNITY_ET_UPSTREAM_COMMIT,sameKeyUpsert:true,credentialStore:'healthy'}),
    create:async (request:CreateCredentialIntent)=>{
      control.createCount++;
      const secret=Buffer.alloc(32,control.createCount).toString('base64');
      const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b656e04220420','hex'),Buffer.from(secret,'base64')]),format:'der',type:'pkcs8'});
      const publicB64=createPublicKey(privateKey).export({format:'der',type:'spki'}).subarray(12).toString('base64');
      const fp=publicKeyFingerprint(publicB64),expiryUnix=Math.floor(control.wall/1000)+request.ttlSeconds;
      const receipt={credentialId:request.credentialId,credentialSecretB64:secret,expiryUnix,derivedPublicKeyFingerprint:fp};
      entries.set(request.credentialId,{receipt,publicB64,readback:{id:request.credentialId,groups:[...request.groups],allowRelay:false,
        allowedProxyCidrs:[],reusable:false,expiryUnix,publicKeyFingerprint:fp}});
      if (afterCreate) await afterCreate();
      return structuredClone(receipt);
    },
    extendSameKey:async (request:ExtendCredentialIntent)=>{
      duringExtend?.();
      const entry=entries.get(request.id)!;
      assert.equal(request.secret,entry.receipt.credentialSecretB64);
      if (control.upsertExtends) {entry.readback.expiryUnix=request.expiryUnix;entry.receipt.expiryUnix=request.expiryUnix;}
      entry.readback.allowRelay=request.allowRelay;
      return {changed:control.upsertExtends};
    },
    setRelayPolicySameKey:async request=>{
      control.relayCount++;
      if (control.relayBeforeApplyFail) throw new Error('fixture-before-apply');
      const entry=entries.get(request.id)!;
      assert.equal(request.secret,entry.receipt.credentialSecretB64);
      entry.readback.allowRelay=request.allowRelay;entry.readback.expiryUnix=request.expiryUnix;entry.receipt.expiryUnix=request.expiryUnix;
      if (control.relayAfterApplyFail) throw new Error('fixture-unknown-result');
      return {changed:true};
    },
    read:async credentialId=>structuredClone(entries.get(credentialId)?.readback??null),
    revoke:async request=>{control.revokeIds.push(request.credentialId);if (!control.retainRevoked) entries.delete(request.credentialId);return {success:true};},
    observeAuthenticatedPeer:async request=>{
      control.observeCount++;
      if (control.lateSample) control.mono+=6000;
      const entry=[...entries.values()][0];
      const sample: ProviderPeerObservation={providerGeneration:control.generation,observedMonoMs:control.mono,networkName:'network',
        connections:[{peerId:77,networkName:'network',isClosed:false,secureAuthLevel:2,peerIdentityType:1,remotePublicKeyB64:entry.publicB64}],
        routes:[{peerId:77,nativeInstanceId:request.scope.nativeInstanceId,virtualIp:control.wrongRoute?'10.77.0.99':'10.77.0.2',nextHopPeerId:77}]};
      if (afterObserve) await afterObserve(sample);
      return sample;
    },
  };
  const service=new CommunityGrantService({serverInstanceId:communityId===BODY.communityId?'backend':communityId,communityId,networkName:'network',networkRevision:1,
    bootstrapProfileId:'public-2.7',virtualIpPool:['10.77.0.2','10.77.0.3'],authority:AUTHORITY,ttlSeconds:120,
    enabled:()=>control.enabled,credentialWritesEnabled:()=>control.writes,runtimeGeneration:()=>control.generation,relayPolicyV2Enabled:()=>control.relayEnabled},store,provider,auth,
    {wallMs:()=>control.wall,monoMs:()=>control.mono});
  return {db,store,service,control,entries,services,auth,setAfterCreate:(value:typeof afterCreate)=>{afterCreate=value;},setDuringExtend:(value:typeof duringExtend)=>{duringExtend=value;},setAfterObserve:(value:typeof afterObserve)=>{afterObserve=value;}};
}
const code=(expected:string)=>(error:unknown)=>error instanceof ContractError && error.code===expected;
test('opt-in node directory verifies all current member keys with one issuer sample and preserves legacy bytes',async()=>{
  const f=fixture();try {
    await f.service.session('alice',BODY);const a=await f.service.acquire('alice',{...BODY,requestId:'nodes-a'});
    const bob={...BODY,deviceId:'bob-device',nativeInstanceId:'33333333-3333-4333-8333-333333333333'};
    await f.service.session('bob',bob);const b=await f.service.acquire('bob',{...bob,requestId:'nodes-b'});
    f.setAfterObserve(async sample=>{
      sample.connections=[a,b].map((grant,index)=>({...sample.connections[0],peerId:index===0?77:88,remotePublicKeyB64:f.entries.get(grant.credentialId)!.publicB64}));
      sample.routes=[a,b].map((grant,index)=>({peerId:index===0?77:88,nativeInstanceId:grant.scope.nativeInstanceId,virtualIp:grant.virtualIp,nextHopPeerId:index===0?77:88}));
    });
    const legacy=JSON.stringify(await f.service.directory('alice',{v:1,communityId:'community'}));
    assert.equal(f.control.observeCount,0);
    const result=await f.service.directory('alice',{v:1,communityId:'community',includeBindings:true});
    assert.equal(f.control.observeCount,1);assert.equal(result.bindings!.members.length,2);
    assert.deepEqual(result.bindings!.members.map(row=>row.peerId).sort(),[77,88]);
    assert.ok(result.bindings!.members.every(row=>row.expiresAtMs<=START+5000));
    for(const forbidden of ['accountId','deviceId','credentialId','publicKeyFingerprint','secret','nativeInstanceId'])assert.ok(!JSON.stringify(result).includes(forbidden));
    assert.equal(JSON.stringify(await f.service.directory('alice',{v:1,communityId:'community'})),legacy);
    f.setAfterObserve(async sample=>{sample.connections[0].secureAuthLevel=1;});
    const unproven=await f.service.directory('alice',{v:1,communityId:'community',includeBindings:true});
    assert.deepEqual(unproven.bindings!.members,[]);assert.equal(unproven.members.length,2);
    f.control.wall=a.expiresAtMs;
    assert.deepEqual((await f.service.directory('alice',{v:1,communityId:'community',includeBindings:true})).bindings!.members,[]);
  }finally{f.db.close();}
});
test('node directory refuses retired membership, stale graphs, provider outage and revocation during observation',async()=>{
  for(const failure of ['membership','late','outage','revoke','collision']) {
    const f=fixture();try {
      await f.service.session('alice',BODY);const g=await f.service.acquire('alice',{...BODY,requestId:'node-fail'});
      f.setAfterObserve(async sample=>{
        if(failure==='membership')f.control.userVersion=1;
        if(failure==='late')f.control.mono+=6000;
        if(failure==='outage')throw new Error('fixture-outage');
        if(failure==='revoke')await f.service.revoke('alice',{...BODY,requestId:'node-revoke',grantId:g.grantId});
        if(failure==='collision')sample.connections.push({...sample.connections[0],peerId:78});
      });
      if(failure==='membership')await assert.rejects(f.service.directory('alice',{v:1,communityId:'community',includeBindings:true}),code('auth-retired'));
      else {
        const result=await f.service.directory('alice',{v:1,communityId:'community',includeBindings:true});
        assert.deepEqual(result.bindings!.members,[]);
        assert.equal(result.members.length,failure==='revoke'?0:1);
      }
    }finally{f.db.close();}
  }
});
test('node proofs recheck the exact grant after the final viewer authorization await',async()=>{
  const f=fixture();try {
    await f.service.session('alice',BODY);const grant=await f.service.acquire('alice',{...BODY,requestId:'node-epoch'});
    const original=f.services.checkSessionAllowed;let reads=0,retired=false;
    f.services.checkSessionAllowed=async identity=>{
      reads++;
      // viewer read, remote-session read, final viewer read
      if(reads===3&&!retired) {retired=true;await f.service.revoke('alice',{...BODY,requestId:'node-epoch-revoke',grantId:grant.grantId});}
      return original(identity);
    };
    const result=await f.service.directory('alice',{v:1,communityId:'community',includeBindings:true});
    assert.equal(retired,true);assert.deepEqual(result.bindings!.members,[]);assert.deepEqual(result.members,[]);
  }finally{f.db.close();}
});
test('relay defaults off, needs explicit consent, and leaves ordinary admission/renewal working',async()=>{
  const f=fixture();try{
    await f.service.session('alice',BODY);const g=await f.service.acquire('alice',{...BODY,requestId:'relay-baseline'});
    await assert.rejects(f.service.relay('alice',{...BODY,v:2,requestId:'relay-on',grantId:g.grantId,expectedConsentRevision:0,enabled:true,bytesPerSecond:65536}),code('relay-v2-disabled'));
    assert.equal(f.control.relayCount,0);assert.equal(f.store.relayState(g.scope).consent.revision,0);
    f.control.wall+=80000;const renewed=await f.service.renew('alice',{...BODY,requestId:'normal-renew',grantId:g.grantId});
    assert.equal(renewed.v,1);assert.equal(renewed.policy.allowRelay,false);assert.equal(f.control.revokeIds.length,0);
  }finally{f.db.close();}
});
test('V2 consent toggles relay on/off with exact same key, credential, device IP and ordinary membership',async()=>{
  const f=fixture();try{
    f.control.relayEnabled=true;await f.service.session('alice',BODY);
    const g=await f.service.acquire('alice',{...BODY,requestId:'initial'});
    const request={...BODY,v:2 as const,requestId:'relay-on',grantId:g.grantId,expectedConsentRevision:0,enabled:true,bytesPerSecond:65536};
    const enabled=await f.service.relay('alice',request);
    assert.equal(enabled.grant.v,2);assert.equal(enabled.grant.policy.allowRelay,true);assert.equal(enabled.consent.revision,1);
    assert.throws(()=>grantShape(enabled.grant),code('invalid-policy'));
    assert.equal(enabled.grant.credentialSecretB64,g.credentialSecretB64);assert.equal(enabled.grant.virtualIp,g.virtualIp);assert.equal(enabled.grant.credentialId,g.credentialId);
    await assert.rejects(f.service.relayRenew('alice',{...BODY,v:2,requestId:'too-early',grantId:g.grantId}),code('renewal-not-extended'));
    assert.equal(f.store.relayState(g.scope).pending,null);assert.equal(f.control.relayCount,1);
    assert.deepEqual(await f.service.relay('alice',request),enabled);assert.equal(f.control.relayCount,1);
    await assert.rejects(f.service.relay('alice',{...request,requestId:'stale'}),code('relay-consent-conflict'));
    const disabled=await f.service.relay('alice',{...request,requestId:'relay-off',expectedConsentRevision:1,enabled:false,bytesPerSecond:0});
    assert.equal(disabled.grant.policy.allowRelay,false);assert.equal(disabled.consent.revision,2);assert.equal(disabled.grant.publicKeyFingerprint,g.publicKeyFingerprint);
    assert.equal(f.store.load(g.scope).record.grant!.v,1);
    assert.equal(f.control.revokeIds.length,0);assert.equal(f.control.createCount,1);
    assert.equal(f.store.directory('community',f.control.wall).length,1);
  }finally{f.db.close();}
});
test('unknown relay Upsert keeps active ET and pending policy, then reconciles readback without revoke',async()=>{
  const f=fixture();try{
    f.control.relayEnabled=true;await f.service.session('alice',BODY);const g=await f.service.acquire('alice',{...BODY,requestId:'baseline'});
    f.control.relayAfterApplyFail=true;
    await assert.rejects(f.service.relay('alice',{...BODY,v:2,requestId:'uncertain',grantId:g.grantId,expectedConsentRevision:0,enabled:true,bytesPerSecond:65536}),/fixture-unknown-result/);
    assert.equal(f.store.load(g.scope).record.state,'active');assert.equal(f.store.load(g.scope).record.grant!.v,1);
    assert.equal(f.store.relayState(g.scope).pending?.target.enabled,true);
    assert.equal(f.store.expectedActiveCredentials(f.control.wall)[0].pendingAllowRelay,true);assert.equal(f.control.revokeIds.length,0);
    const reconciled=await f.service.relayStatus('alice',{...BODY,v:2,requestId:'status',grantId:g.grantId});
    assert.equal(reconciled.grant.policy.allowRelay,true);assert.equal(f.store.relayState(g.scope).pending,null);assert.equal(f.control.relayCount,1);
    assert.equal(f.store.load(g.scope).record.state,'active');
  }finally{f.db.close();}
});
test('failed relay mutation before application retries exactly without retiring or issuing new keys',async()=>{
  const f=fixture();try{
    f.control.relayEnabled=true;await f.service.session('alice',BODY);const g=await f.service.acquire('alice',{...BODY,requestId:'baseline'});
    const request={...BODY,v:2 as const,requestId:'retry',grantId:g.grantId,expectedConsentRevision:0,enabled:true,bytesPerSecond:65536};
    f.control.relayBeforeApplyFail=true;await assert.rejects(f.service.relay('alice',request),/fixture-before-apply/);
    f.control.relayBeforeApplyFail=false;const result=await f.service.relay('alice',request);
    assert.equal(result.consent.revision,1);assert.equal(result.grant.credentialSecretB64,g.credentialSecretB64);assert.equal(result.grant.policy.allowRelay,true);
    assert.equal(f.control.createCount,1);assert.equal(f.control.revokeIds.length,0);
  }finally{f.db.close();}
});
test('relay renewal keeps true policy; legacy renew/acquire downgrade safely and other members keep V1',async()=>{
  const f=fixture();try{
    f.control.relayEnabled=true;await f.service.session('alice',BODY);const g=await f.service.acquire('alice',{...BODY,requestId:'baseline'});
    await f.service.relay('alice',{...BODY,v:2,requestId:'on',grantId:g.grantId,expectedConsentRevision:0,enabled:true,bytesPerSecond:65536});
    f.control.wall+=80000;const relayRenewed=await f.service.relayRenew('alice',{...BODY,v:2,requestId:'relay-renew',grantId:g.grantId});
    assert.equal(relayRenewed.grant.policy.allowRelay,true);assert.ok(relayRenewed.grant.expiresAtMs>g.expiresAtMs);
    const bob={...BODY,deviceId:'bob',nativeInstanceId:'33333333-3333-4333-8333-333333333333'};
    await f.service.session('bob',bob);const other=await f.service.acquire('bob',{...bob,requestId:'bob-acquire'});assert.equal(other.policy.allowRelay,false);
    f.control.wall+=10000;const ordinary=await f.service.renew('alice',{...BODY,requestId:'old-client-renew',grantId:g.grantId});
    assert.equal(ordinary.v,1);assert.equal(ordinary.policy.allowRelay,false);assert.equal(f.control.revokeIds.length,0);
    await f.service.relay('alice',{...BODY,v:2,requestId:'on-again',grantId:g.grantId,expectedConsentRevision:1,enabled:true,bytesPerSecond:65536});
    const old=await f.service.acquire('alice',{...BODY,requestId:'old-client-acquire'});assert.equal(old.v,1);assert.equal(old.policy.allowRelay,false);
    assert.equal(old.credentialSecretB64,g.credentialSecretB64);assert.equal(f.control.revokeIds.length,0);
  }finally{f.db.close();}
});
test('disabling the V2 deployment gate downgrades existing relay renewal while retaining ordinary ET',async()=>{
  const f=fixture();try{
    f.control.relayEnabled=true;await f.service.session('alice',BODY);const g=await f.service.acquire('alice',{...BODY,requestId:'baseline'});
    await f.service.relay('alice',{...BODY,v:2,requestId:'on',grantId:g.grantId,expectedConsentRevision:0,enabled:true,bytesPerSecond:65536});
    f.control.relayEnabled=false;f.control.wall+=80000;
    const renewed=await f.service.relayRenew('alice',{...BODY,v:2,requestId:'off-renew',grantId:g.grantId});
    assert.equal(renewed.grant.policy.allowRelay,false);assert.equal(renewed.consent.enabled,true);assert.equal(f.control.revokeIds.length,0);
    assert.equal(renewed.grant.credentialId,g.credentialId);
  }finally{f.db.close();}
});
test('relay request uses existing authenticated membership/session and refuses a different device',async()=>{
  const f=fixture();try{
    f.control.relayEnabled=true;await f.service.session('alice',BODY);const g=await f.service.acquire('alice',{...BODY,requestId:'baseline'});
    const request={...BODY,v:2 as const,requestId:'on',grantId:g.grantId,expectedConsentRevision:0,enabled:true,bytesPerSecond:65536};
    await assert.rejects(f.service.relay('alice',{...request,deviceId:'wrong-device'}),code('session-required'));
    f.control.member=false;await assert.rejects(f.service.relay('alice',request),code('membership-required'));
    assert.equal(f.control.relayCount,0);assert.equal(f.control.revokeIds.length,0);
  }finally{f.db.close();}
});
test('V2 consent and unknown qualification survive reopening actual SQLite, without secret in preference rows',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'laokuai-relay-store-test-')),path=join(directory,'fixture.db');
  const f=fixture('community',path);let closed=false,reopened:ReturnType<typeof fixture>|null=null;
  try{
    f.control.relayEnabled=true;await f.service.session('alice',BODY);const g=await f.service.acquire('alice',{...BODY,requestId:'baseline'});
    f.control.relayAfterApplyFail=true;
    await assert.rejects(f.service.relay('alice',{...BODY,v:2,requestId:'unknown-persisted',grantId:g.grantId,expectedConsentRevision:0,enabled:true,bytesPerSecond:65536}),/fixture-unknown-result/);
    const sealed=f.db.prepare('SELECT sealed_state FROM community_et_relay_preferences').get()!.sealed_state as string;
    assert.equal(sealed.includes(g.credentialSecretB64),false);assert.equal(sealed.includes('bytesPerSecond'),false);
    f.db.close();closed=true;
    reopened=fixture('community',path);for(const [key,entry] of f.entries) reopened.entries.set(key,structuredClone(entry));
    const result=await reopened.service.relayStatus('alice',{...BODY,v:2,requestId:'restored',grantId:g.grantId});
    assert.equal(result.consent.revision,1);assert.equal(result.grant.policy.allowRelay,true);
    assert.equal(result.grant.credentialSecretB64,g.credentialSecretB64);assert.equal(result.grant.virtualIp,g.virtualIp);
    assert.equal(reopened.control.createCount,0);assert.equal(reopened.control.relayCount,0);assert.equal(reopened.control.revokeIds.length,0);
  }finally{if(!closed)f.db.close();reopened?.db.close();rmSync(directory,{recursive:true,force:true});}
});
test('withdrawal after an unknown true mutation reconciles then updates false without retiring ordinary ET',async()=>{
  const f=fixture();try{
    f.control.relayEnabled=true;await f.service.session('alice',BODY);const g=await f.service.acquire('alice',{...BODY,requestId:'baseline'});
    f.control.relayAfterApplyFail=true;
    await assert.rejects(f.service.relay('alice',{...BODY,v:2,requestId:'unknown',grantId:g.grantId,expectedConsentRevision:0,enabled:true,bytesPerSecond:65536}),/fixture-unknown-result/);
    f.control.relayAfterApplyFail=false;f.control.relayEnabled=false;
    const off=await f.service.relay('alice',{...BODY,v:2,requestId:'withdraw',grantId:g.grantId,expectedConsentRevision:1,enabled:false,bytesPerSecond:0});
    assert.equal(off.grant.policy.allowRelay,false);assert.equal(off.consent.enabled,false);assert.equal(off.consent.revision,2);
    assert.equal(f.store.load(g.scope).record.state,'active');assert.equal(f.control.revokeIds.length,0);
    assert.equal(off.grant.credentialId,g.credentialId);
  }finally{f.db.close();}
});
test('legacy renewal unknown downgrade retains V2 active record and recovers a V1 grant without revocation',async()=>{
  const f=fixture();try{
    f.control.relayEnabled=true;await f.service.session('alice',BODY);const g=await f.service.acquire('alice',{...BODY,requestId:'baseline'});
    await f.service.relay('alice',{...BODY,v:2,requestId:'enable',grantId:g.grantId,expectedConsentRevision:0,enabled:true,bytesPerSecond:65536});
    f.control.wall+=80000;f.control.relayAfterApplyFail=true;
    await assert.rejects(f.service.renew('alice',{...BODY,requestId:'legacy-unknown',grantId:g.grantId}),/fixture-unknown-result/);
    assert.equal(f.store.load(g.scope).record.state,'active');assert.equal(f.store.load(g.scope).record.grant!.policy.allowRelay,true);
    assert.equal(f.store.relayState(g.scope).pending?.target.enabled,false);assert.equal(f.control.revokeIds.length,0);
    f.control.relayAfterApplyFail=false;
    // Reconciliation sees the already extended expiry. Ordinary acquisition
    // restores the V1 DTO without extending again or generating a second key.
    const restored=await f.service.acquire('alice',{...BODY,requestId:'legacy-recover'});
    assert.equal(restored.v,1);assert.equal(restored.policy.allowRelay,false);assert.ok(restored.expiresAtMs>g.expiresAtMs);
    assert.equal(restored.credentialSecretB64,g.credentialSecretB64);assert.equal(restored.virtualIp,g.virtualIp);assert.equal(f.control.revokeIds.length,0);
  }finally{f.db.close();}
});
test('real CJK namespace crosses existing member auth, service and durable device allocation unchanged',async()=>{
  const real='老蒯聊_5000_default',f=fixture(real);try {
    const result=await f.service.session('alice',{...BODY,communityId:real});
    assert.equal(result.intent.communityId,real);assert.equal(result.intent.serverInstanceId,real);
    assert.equal(result.intent.accountId,'alice');assert.equal(result.serverUserId,'server-alice');
    assert.equal(f.control.createCount,0);
    const body={...BODY,communityId:real},grant=await f.service.acquire('alice',{...body,requestId:'real-namespace-grant'});
    const binding=await f.service.binding('alice',{...body,grantId:grant.grantId});
    assert.equal(grant.scope.communityId,real);assert.deepEqual(binding.scope,grant.scope);
    assert.equal(binding.serverUserId,'server-alice');assert.equal(binding.physicalDirectVerified,false);
    await assert.rejects(f.service.session('alice',{...BODY,communityId:'另一个社区'}),code('community-forbidden'));
  }finally{f.db.close();}
});

test('session is idempotent, account comes from existing bearer, and no native write occurs',async()=>{
  const f=fixture();try {
    const a=await f.service.session('alice',BODY),b=await f.service.session('alice',BODY);
    assert.deepEqual(a,b);assert.equal(a.intent.accountId,'alice');assert.equal(a.serverUserId,'server-alice');
    assert.equal(f.store.sessionForScope(a.intent)!.authorizationEpoch,1);assert.equal(f.control.createCount,0);
    assert.equal('sessionId' in a,false);
  }finally {f.db.close();}
});
test('directory exposes only active authenticated ET registrations and keeps device addresses stable',async()=>{
  const f=fixture();try {
    await f.service.session('alice',BODY);
    await f.service.session('bob',{...BODY,deviceId:'device-bob',nativeInstanceId:'33333333-3333-4333-8333-333333333333'});
    assert.deepEqual(f.store.directory('community',START),[]);
    await f.service.acquire('alice',{...BODY,requestId:'directory-alice'});
    await f.service.acquire('bob',{...BODY,deviceId:'device-bob',nativeInstanceId:'33333333-3333-4333-8333-333333333333',requestId:'directory-bob'});
    assert.deepEqual(f.store.directory('community',START),[
      {serverUserId:'server-alice',virtualIp:'10.77.0.2'},
      {serverUserId:'server-bob',virtualIp:'10.77.0.3'},
    ]);
    await f.service.session('alice',BODY);
    assert.deepEqual(f.store.directory('community',START),[
      {serverUserId:'server-alice',virtualIp:'10.77.0.2'},
      {serverUserId:'server-bob',virtualIp:'10.77.0.3'},
    ]);
    assert.deepEqual(f.store.directory('other-community',START),[]);
    assert.deepEqual((await f.service.directory('alice',{v:1,communityId:'community'})).members,f.store.directory('community',START));
    await assert.rejects(f.service.directory('alice',{v:1,communityId:'other-community'}),code('community-forbidden'));
    f.control.member=false;
    await assert.rejects(f.service.directory('alice',{v:1,communityId:'community'}),code('membership-required'));
    f.control.member=true;f.control.wall+=120001;
    assert.deepEqual(f.store.directory('community',f.control.wall),[]);
  }finally {f.db.close();}
});
test('directory preserves multiple devices and removes revoked allocations without freeing stable reservations',async()=>{
  const f=fixture();try {
    const second={...BODY,deviceId:'second-device',nativeInstanceId:'33333333-3333-4333-8333-333333333333'};
    const first=await f.service.session('alice',BODY),other=await f.service.session('alice',second);
    assert.notEqual(first.intent.virtualIp,other.intent.virtualIp);
    const a=await f.service.acquire('alice',{...BODY,requestId:'first'});
    await f.service.acquire('alice',{...second,requestId:'second'});
    assert.deepEqual(f.store.directory('community',START),[
      {serverUserId:'server-alice',virtualIp:'10.77.0.2'}, {serverUserId:'server-alice',virtualIp:'10.77.0.3'},
    ]);
    await f.service.revoke('alice',{...BODY,requestId:'revoke-first',grantId:a.grantId});
    assert.deepEqual(f.store.directory('community',START),[{serverUserId:'server-alice',virtualIp:'10.77.0.3'}]);
    const reopened=new SqliteCommunityGrantStore(f.db,communityVaultKey('PURE-TEST-VAULT-SECRET-01234567890123456789'));
    reopened.initSchema();
    assert.equal(reopened.registerDevice('alice','community','device',INSTANCE,['10.77.0.2','10.77.0.3']),first.intent.virtualIp);
    assert.throws(()=>reopened.registerDevice('alice','community','device',second.nativeInstanceId,['10.77.0.2','10.77.0.3']),code('device-instance-mismatch'));
  }finally {f.db.close();}
});
test('directory retains confirmed addresses during same-key renewal without borrowing its future expiry',async()=>{
  const f=fixture();try{
    await f.service.session('alice',BODY);const grant=await f.service.acquire('alice',{...BODY,requestId:'acquire'});
    f.control.wall+=80000;
    f.setDuringExtend(()=>{
      assert.deepEqual(f.store.directory('community',f.control.wall),[{serverUserId:'server-alice',virtualIp:'10.77.0.2'}]);
      assert.deepEqual(f.store.directory('community',grant.expiresAtMs),[]);
      assert.equal(f.store.dnsDirectory('community',grant.expiresAtMs-1).members[0].dnsExpiresAtMs,grant.expiresAtMs);
    });
    await f.service.renew('alice',{...BODY,requestId:'renew-directory',grantId:grant.grantId});
  }finally{f.db.close();}
});
test('opt-in DNS uses persistent per-device aliases; legacy response and device rows stay exact',async()=>{
  const f=fixture();try{
    await f.service.session('alice',BODY);await f.service.acquire('alice',{...BODY,requestId:'dns-acquire'});
    const before=f.db.prepare('SELECT * FROM community_et_devices').all();
    const legacy=await f.service.directory('alice',{v:1,communityId:'community'});
    assert.deepEqual(legacy,{v:1,communityId:'community',members:[{serverUserId:'server-alice',virtualIp:'10.77.0.2'}]});
    const first=await f.service.directory('alice',{v:1,communityId:'community',includeDnsNames:true});
    assert.ok('dns' in first);assert.ok(communityDnsZone(first.dns.zone));assert.equal(first.dns.serverTimeMs,START);
    assert.equal(first.dns.maxAgeMs,COMMUNITY_DNS_MAX_AGE_MS);assert.equal(first.members.length,1);
    assert.match(first.members[0].dnsName,/^d-[a-f0-9]{32}\.c-[a-f0-9]{32}\.lan\.voice\.ruikang\.wang\.$/);
    assert.equal(first.members[0].dnsName.endsWith(first.dns.zone),true);
    assert.equal(first.members[0].dnsExpiresAtMs,START+COMMUNITY_DNS_MAX_AGE_MS);
    assert.deepEqual(f.db.prepare('SELECT * FROM community_et_devices').all(),before);
    const reopened=new SqliteCommunityGrantStore(f.db,communityVaultKey('PURE-TEST-VAULT-SECRET-01234567890123456789'));reopened.initSchema();
    const after=reopened.dnsDirectory('community',START);assert.equal(after.zone,first.dns.zone);assert.deepEqual(after.members,first.members);
    assert.deepEqual(await f.service.directory('alice',{v:1,communityId:'community'}),legacy);
    for(const field of ['authorizations','accountId','deviceId','sessionId','nativeInstanceId','credentialId','tokenDigest','serverTokenVersion','userTokenVersion'])
      assert.equal(JSON.stringify(first).includes('"'+field+'"'),false,field);
    assert.equal(first.members[0].dnsName.includes('alice'),false);assert.equal(first.members[0].dnsName.includes('device'),false);
  }finally{f.db.close();}
});
test('DNS zone and aliases survive closing and reopening the actual SQLite file',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'laokuai-dns-store-test-')),f=fixture('community',join(directory,'fixture.db'));
  let originalClosed=false,reopened: DatabaseSync|null=null;
  try{
    await f.service.session('alice',BODY);await f.service.acquire('alice',{...BODY,requestId:'dns-durable'});
    const first=f.store.dnsDirectory('community',START),devices=f.db.prepare('SELECT * FROM community_et_devices').all();
    f.db.close();originalClosed=true;
    reopened=new DatabaseSync(join(directory,'fixture.db'));
    const store=new SqliteCommunityGrantStore(reopened,communityVaultKey('PURE-TEST-VAULT-SECRET-01234567890123456789'));store.initSchema();
    assert.deepEqual(store.dnsDirectory('community',START),first);
    assert.deepEqual(reopened.prepare('SELECT * FROM community_et_devices').all(),devices);
  }finally{
    reopened?.close();if(!originalClosed)f.db.close();
    rmSync(directory,{recursive:true,force:true});
  }
});
test('each device of one account has its own name; no account shortcut or shared IP is invented',async()=>{
  const f=fixture();try{
    const second={...BODY,deviceId:'second-device',nativeInstanceId:'33333333-3333-4333-8333-333333333333'};
    await f.service.session('alice',BODY);await f.service.session('alice',second);
    await f.service.acquire('alice',{...BODY,requestId:'dns-first'});await f.service.acquire('alice',{...second,requestId:'dns-second'});
    const result=await f.service.directory('alice',{v:1,communityId:'community',includeDnsNames:true});assert.ok('dns' in result);
    assert.equal(result.members.length,2);assert.equal(new Set(result.members.map(m=>m.dnsName)).size,2);
    assert.equal(new Set(result.members.map(m=>m.virtualIp)).size,2);assert.equal(new Set(result.members.map(m=>m.serverUserId)).size,1);
    const initial=result.members[0].dnsName;
    f.control.wall+=1001;
    await f.service.session('alice-next',BODY);
    const refreshed=await f.service.directory('alice-next',{v:1,communityId:'community',includeDnsNames:true});assert.ok('dns' in refreshed);
    assert.equal(refreshed.members.find(m=>m.virtualIp==='10.77.0.2')!.dnsName,initial);
  }finally{f.db.close();}
});
test('DNS expiry uses confirmed grant and session bounds; revoke removes records but retains the alias reservation',async()=>{
  const f=fixture();try{
    await f.service.session('alice',BODY);const grant=await f.service.acquire('alice',{...BODY,requestId:'dns-ttl'});
    f.control.wall=grant.expiresAtMs-2000;
    const response=await f.service.directory('alice',{v:1,communityId:'community',includeDnsNames:true});assert.ok('dns' in response);
    assert.equal(response.members[0].dnsExpiresAtMs,grant.expiresAtMs);
    const name=response.members[0].dnsName;
    await f.service.revoke('alice',{...BODY,requestId:'dns-revoke',grantId:grant.grantId});
    const revoked=await f.service.directory('alice',{v:1,communityId:'community',includeDnsNames:true});assert.ok('dns' in revoked);assert.deepEqual(revoked.members,[]);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM community_et_dns_devices').get()!.n,1);
    await f.service.acquire('alice',{...BODY,requestId:'dns-reacquire'});
    const again=await f.service.directory('alice',{v:1,communityId:'community',includeDnsNames:true});assert.ok('dns' in again);
    assert.equal(again.members[0].dnsName,name);
    const stored=f.store.sessionForScope(grant.scope)!;
    f.store.createSession({...stored,tokenDigest:'b'.repeat(64),issuedAtMs:f.control.wall-1,expiresAtMs:f.control.wall+1000,serverTokenVersion:0,userTokenVersion:0});
    const capped=await f.service.directory('alice',{v:1,communityId:'community',includeDnsNames:true});assert.ok('dns' in capped);
    assert.equal(capped.members[0].dnsExpiresAtMs,f.control.wall+1000);
  }finally{f.db.close();}
});
test('server clock rollback cannot publish a grant whose confirmed time is now in the future',async()=>{
  const f=fixture();try{
    await f.service.session('alice',BODY);await f.service.acquire('alice',{...BODY,requestId:'dns-clock'});
    f.control.wall=START-1;
    const future=await f.service.directory('alice',{v:1,communityId:'community',includeDnsNames:true});assert.ok('dns' in future);
    assert.deepEqual(future.members,[]);
    f.control.wall=START;
    const current=await f.service.directory('alice',{v:1,communityId:'community',includeDnsNames:true});assert.ok('dns' in current);
    assert.equal(current.members.length,1);
  }finally{f.db.close();}
});
test('DNS alias follows the stable device rather than the current address',async()=>{
  const f=fixture();try{
    await f.service.session('alice',BODY);await f.service.acquire('alice',{...BODY,requestId:'dns-before-address'});
    const first=f.store.dnsDirectory('community',START),name=first.members[0].dnsName;
    f.db.prepare('UPDATE community_et_devices SET virtual_ip=? WHERE account_id=? AND community_id=? AND device_id=?').run('10.77.0.3','alice','community','device');
    f.control.wall+=1001;
    await f.service.session('alice-next',BODY);await f.service.acquire('alice-next',{...BODY,requestId:'dns-after-address'});
    const after=await f.service.directory('alice-next',{v:1,communityId:'community',includeDnsNames:true});assert.ok('dns' in after);
    assert.equal(after.members[0].virtualIp,'10.77.0.3');assert.equal(after.members[0].dnsName,name);assert.equal(after.dns.zone,first.zone);
    assert.equal(f.db.prepare('SELECT alias FROM community_et_dns_devices').get()!.alias+'.'+first.zone,name);
  }finally{f.db.close();}
});

test('friendly negotiation preserves old response bytes and every existing allocation/session/grant table',async()=>{
  const f=fixture();try{
    await f.service.session('alice',BODY);await f.service.acquire('alice',{...BODY,requestId:'friendly-compat'});
    const query={v:1 as const,communityId:'community',includeDnsNames:true as const};
    const legacy=JSON.stringify(await f.service.directory('alice',query));
    const tables=['community_et_devices','community_et_grants','community_et_sessions','community_et_dns_zones','community_et_dns_devices'];
    const snapshots=tables.map(table=>f.db.prepare(`SELECT * FROM ${table}`).all());
    const friendly=await f.service.directory('alice',{...query,dnsNameStyle:'friendly'});assert.ok('dns' in friendly);
    assert.match(friendly.dns.zone,/^lk-[a-f0-9]{8}\.internal\.$/);
    assert.match(friendly.members[0].dnsName,/^[a-z]{3,12}-[1-9][0-9]{1,2}\.lk-[a-f0-9]{8}\.internal\.$/);
    assert.equal(friendly.dns.maxAgeMs,COMMUNITY_DNS_MAX_AGE_MS);
    assert.equal(friendly.members[0].dnsExpiresAtMs,START+COMMUNITY_DNS_MAX_AGE_MS);
    assert.equal(JSON.stringify(await f.service.directory('alice',query)),legacy);
    tables.forEach((table,index)=>assert.deepEqual(f.db.prepare(`SELECT * FROM ${table}`).all(),snapshots[index],table));
    for(const field of ['authorizations','accountId','deviceId','sessionId','nativeInstanceId','credentialId','tokenDigest','serverTokenVersion','userTokenVersion'])
      assert.equal(JSON.stringify(friendly).includes('"'+field+'"'),false,field);
  }finally{f.db.close();}
});

test('friendly names persist across real SQLite reopen, address and display identifier changes',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'laokuai-friendly-dns-test-')),f=fixture('community',join(directory,'fixture.db'));
  let originalClosed=false,reopened:DatabaseSync|null=null;
  try{
    await f.service.session('alice',BODY);await f.service.acquire('alice',{...BODY,requestId:'friendly-before'});
    const first=f.store.dnsDirectory('community',START,'friendly');
    f.db.prepare('UPDATE community_et_devices SET virtual_ip=? WHERE account_id=?').run('10.77.0.3','alice');
    f.control.wall+=1001;
    const verify=f.services.verifyAccessToken;
    f.services.verifyAccessToken=bearer=>{
      const identity=verify(bearer);return identity?{...identity,serverUserId:'renamed-display-identifier'}:null;
    };
    await f.service.session('alice-next',BODY);await f.service.acquire('alice-next',{...BODY,requestId:'friendly-after'});
    const after=await f.service.directory('alice-next',{v:1,communityId:'community',includeDnsNames:true,dnsNameStyle:'friendly'});assert.ok('dns' in after);
    assert.equal(after.members[0].dnsName,first.members[0].dnsName);assert.equal(after.members[0].virtualIp,'10.77.0.3');
    assert.equal(after.members[0].serverUserId,'renamed-display-identifier');assert.equal(after.dns.zone,first.zone);
    const privateDirectory=f.store.dnsDirectory('community',f.control.wall,'friendly');
    f.db.close();originalClosed=true;reopened=new DatabaseSync(join(directory,'fixture.db'));
    const store=new SqliteCommunityGrantStore(reopened,communityVaultKey('PURE-TEST-VAULT-SECRET-01234567890123456789'));store.initSchema();
    assert.deepEqual(store.dnsDirectory('community',f.control.wall,'friendly'),privateDirectory);
  }finally{reopened?.close();if(!originalClosed)f.db.close();rmSync(directory,{recursive:true,force:true});}
});

test('friendly names distinguish devices and accounts and retain reservations through revoke and expiry',async()=>{
  const f=fixture();try{
    const second={...BODY,deviceId:'second-device',nativeInstanceId:'33333333-3333-4333-8333-333333333333'};
    await f.service.session('alice',BODY);await f.service.session('bob',second);
    const grant=await f.service.acquire('alice',{...BODY,requestId:'friendly-a'});
    await f.service.acquire('bob',{...second,requestId:'friendly-b'});
    const query={v:1 as const,communityId:'community',includeDnsNames:true as const,dnsNameStyle:'friendly' as const};
    const first=await f.service.directory('alice',query);assert.ok('dns' in first);
    assert.equal(new Set(first.members.map(member=>member.dnsName)).size,2);
    const name=first.members.find(member=>member.serverUserId==='server-alice')!.dnsName;
    f.control.wall=grant.expiresAtMs-1000;
    const capped=await f.service.directory('alice',query);assert.ok('dns' in capped);assert.equal(capped.members[0].dnsExpiresAtMs,grant.expiresAtMs);
    await f.service.revoke('alice',{...BODY,requestId:'friendly-revoke',grantId:grant.grantId});
    const revoked=await f.service.directory('alice',query);assert.ok('dns' in revoked);assert.deepEqual(revoked.members.map(member=>member.serverUserId),['server-bob']);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM community_et_friendly_dns_devices').get()!.n,2);
    await f.service.acquire('alice',{...BODY,requestId:'friendly-reacquire'});
    const again=await f.service.directory('alice',query);assert.ok('dns' in again);assert.equal(again.members[0].dnsName,name);
    f.control.wall+=120001;
    const expired=await f.service.directory('alice',query);assert.ok('dns' in expired);assert.deepEqual(expired.members,[]);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM community_et_friendly_dns_devices').get()!.n,2);
  }finally{f.db.close();}
});

test('friendly names distinguish two devices sharing one account without an account hostname shortcut',async()=>{
  const f=fixture();try{
    const second={...BODY,deviceId:'second-device',nativeInstanceId:'33333333-3333-4333-8333-333333333333'};
    await f.service.session('alice',BODY);await f.service.session('alice',second);
    await f.service.acquire('alice',{...BODY,requestId:'friendly-device-a'});await f.service.acquire('alice',{...second,requestId:'friendly-device-b'});
    const result=await f.service.directory('alice',{v:1,communityId:'community',includeDnsNames:true,dnsNameStyle:'friendly'});assert.ok('dns' in result);
    assert.equal(result.members.length,2);assert.equal(new Set(result.members.map(member=>member.dnsName)).size,2);
    assert.equal(new Set(result.members.map(member=>member.serverUserId)).size,1);
    assert.equal(new Set(result.members.map(member=>member.virtualIp)).size,2);
  }finally{f.db.close();}
});

test('corrupt friendly reservations fail closed without affecting legacy DNS or numeric addresses',async()=>{
  const f=fixture();try{
    await f.service.session('alice',BODY);await f.service.acquire('alice',{...BODY,requestId:'friendly-corrupt'});
    const old=f.store.dnsDirectory('community',START);
    f.store.dnsDirectory('community',START,'friendly');
    f.db.prepare('UPDATE community_et_friendly_dns_devices SET alias=?').run('account-name-27');
    await assert.rejects(f.service.directory('alice',{v:1,communityId:'community',includeDnsNames:true,dnsNameStyle:'friendly'}),code('grant-store-corrupt'));
    assert.deepEqual(f.store.dnsDirectory('community',START),old);
    assert.equal((await f.service.directory('alice',{v:1,communityId:'community'})).members.length,1);
  }finally{f.db.close();}
});

test('friendly publication rechecks membership and session epochs across asynchronous authorization',async()=>{
  const f=fixture();try{
    await f.service.session('alice',BODY);await f.service.acquire('alice',{...BODY,requestId:'friendly-race'});
    const query={v:1 as const,communityId:'community',includeDnsNames:true as const,dnsNameStyle:'friendly' as const};
    const check=f.services.checkSessionAllowed;let reads=0;
    f.services.checkSessionAllowed=async identity=>{
      const result=await check(identity);
      if(++reads===2){f.control.wall+=1001;await f.service.session('alice-next',BODY);}
      return result;
    };
    const retired=await f.service.directory('alice',query);assert.ok('dns' in retired);assert.deepEqual(retired.members,[]);
    f.services.checkSessionAllowed=check;
    const current=await f.service.directory('alice-next',query);assert.ok('dns' in current);assert.equal(current.members.length,1);
    f.control.userVersion=1;
    await assert.rejects(f.service.directory('alice-next',query),code('auth-retired'));
    f.control.userVersion=0;f.control.member=false;
    await assert.rejects(f.service.directory('alice-next',query),code('membership-required'));
  }finally{f.db.close();}
});

test('fixed friendly zone is bound to one trusted community; generic scopes remain separately persisted',()=>{
  const f=fixture();try{
    const store=new SqliteCommunityGrantStore(f.db,communityVaultKey('PURE-TEST-VAULT-SECRET-01234567890123456789'),'trusted-community');store.initSchema();
    const preferred=store.dnsDirectory('trusted-community',START,'friendly');assert.equal(preferred.zone,'lk.internal.');
    const a=store.dnsDirectory('community-a',START,'friendly'),b=store.dnsDirectory('community-b',START,'friendly');
    assert.notEqual(a.zone,b.zone);assert.match(a.zone,/^lk-[a-f0-9]{8}\.internal\.$/);
    assert.deepEqual(store.dnsDirectory('community-a',START,'friendly'),a);
    const rebound=new SqliteCommunityGrantStore(f.db,communityVaultKey('PURE-TEST-VAULT-SECRET-01234567890123456789'),'community-a');
    assert.throws(()=>rebound.dnsDirectory('trusted-community',START,'friendly'),code('grant-store-corrupt'));
    f.db.prepare('UPDATE community_et_friendly_dns_zones SET zone=? WHERE community_id=?').run('evil.internal.','community-b');
    assert.throws(()=>store.dnsDirectory('community-b',START,'friendly'),code('grant-store-corrupt'));
  }finally{f.db.close();}
});
test('current remote membership and token revocation are checked before DNS publication',async()=>{
  const f=fixture();try{
    const bob={...BODY,deviceId:'bob-device',nativeInstanceId:'33333333-3333-4333-8333-333333333333'};
    await f.service.session('alice',BODY);await f.service.session('bob',bob);
    await f.service.acquire('alice',{...BODY,requestId:'dns-alice'});await f.service.acquire('bob',{...bob,requestId:'dns-bob'});
    const check=f.services.checkSessionAllowed;
    f.services.checkSessionAllowed=identity=>identity.grytUserId==='bob'?Promise.resolve({ok:false,code:'membership_required'}):check(identity);
    const removed=await f.service.directory('alice',{v:1,communityId:'community',includeDnsNames:true});assert.ok('dns' in removed);
    assert.deepEqual(removed.members.map(m=>m.serverUserId),['server-alice']);
    f.services.checkSessionAllowed=async identity=>{
      const result=await check(identity);if(result.ok&&identity.grytUserId==='bob')result.user.token_version=1;return result;
    };
    const retired=await f.service.directory('alice',{v:1,communityId:'community',includeDnsNames:true});assert.ok('dns' in retired);
    assert.deepEqual(retired.members.map(m=>m.serverUserId),['server-alice']);
    f.services.checkSessionAllowed=identity=>identity.grytUserId==='bob'?Promise.reject(Error('private-db-failure')):check(identity);
    await assert.rejects(f.service.directory('alice',{v:1,communityId:'community',includeDnsNames:true}),code('auth-unavailable'));
  }finally{f.db.close();}
});
test('grant revoke during asynchronous directory authorization cannot publish the old DNS record',async()=>{
  const f=fixture();try{
    const bob={...BODY,deviceId:'bob-device',nativeInstanceId:'33333333-3333-4333-8333-333333333333'};
    await f.service.session('alice',BODY);await f.service.session('bob',bob);
    await f.service.acquire('alice',{...BODY,requestId:'dns-race-alice'});const grant=await f.service.acquire('bob',{...bob,requestId:'dns-race-bob'});
    const check=f.services.checkSessionAllowed;let once=false;
    f.services.checkSessionAllowed=async identity=>{
      const result=await check(identity);
      if(identity.grytUserId==='bob'&&!once){once=true;await f.service.revoke('bob',{...bob,requestId:'dns-race-revoke',grantId:grant.grantId});}
      return result;
    };
    const result=await f.service.directory('alice',{v:1,communityId:'community',includeDnsNames:true});assert.ok('dns' in result);
    assert.deepEqual(result.members.map(m=>m.serverUserId),['server-alice']);
  }finally{f.db.close();}
});
test('viewer permission change during a DNS read retires the whole response',async()=>{
  const f=fixture();try{
    await f.service.session('alice',BODY);await f.service.acquire('alice',{...BODY,requestId:'dns-viewer-race'});
    const check=f.services.checkSessionAllowed;let reads=0;
    f.services.checkSessionAllowed=async identity=>{
      const result=await check(identity);
      if(++reads===2)f.control.member=false;
      return result;
    };
    await assert.rejects(f.service.directory('alice',{v:1,communityId:'community',includeDnsNames:true}),code('membership-required'));
  }finally{f.db.close();}
});
test('old sealed sessions remain v1-compatible but DNS requires renewed version metadata',async()=>{
  const f=fixture();try{
    const registered=await f.service.session('alice',BODY);await f.service.acquire('alice',{...BODY,requestId:'dns-legacy'});
    const old=f.store.sessionForScope(registered.intent)!;
    const legacy={tokenDigest:old.tokenDigest,serverUserId:old.serverUserId,issuedAtMs:old.issuedAtMs,expiresAtMs:old.expiresAtMs,intent:old.intent};
    f.store.createSession(legacy);
    assert.equal((await f.service.directory('alice',{v:1,communityId:'community'})).members.length,1);
    const hidden=await f.service.directory('alice',{v:1,communityId:'community',includeDnsNames:true});assert.ok('dns' in hidden);assert.deepEqual(hidden.members,[]);
    await f.service.session('alice',BODY);
    const verified=await f.service.directory('alice',{v:1,communityId:'community',includeDnsNames:true});assert.ok('dns' in verified);assert.equal(verified.members.length,1);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM community_et_devices').get()!.n,1);
  }finally{f.db.close();}
});
test('original sealed session shape remains readable by older servers; DNS metadata faults do not corrupt LAN state',async()=>{
  const f=fixture();try{
    const registered=await f.service.session('alice',BODY),grant=await f.service.acquire('alice',{...BODY,requestId:'dns-rollback'});
    const current=f.store.sessionForScope(registered.intent)!;
    const encoded=f.db.prepare('SELECT sealed_session FROM community_et_sessions WHERE session_id=?').get(current.sessionId)!.sealed_session as string;
    const bytes=Buffer.from(encoded,'base64'),decipher=createDecipheriv('aes-256-gcm',communityVaultKey('PURE-TEST-VAULT-SECRET-01234567890123456789'),bytes.subarray(0,12));
    decipher.setAAD(Buffer.from('session:'+current.sessionId));decipher.setAuthTag(bytes.subarray(12,28));
    const raw=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
    assert.deepEqual(Object.keys(raw).sort(),['sessionId','tokenDigest','serverUserId','authorizationEpoch','issuedAtMs','expiresAtMs','intent'].sort());
    f.db.prepare('UPDATE community_et_dns_session_auth SET sealed_authorization=?').run('tampered');
    await assert.rejects(f.service.directory('alice',{v:1,communityId:'community',includeDnsNames:true}),code('grant-store-corrupt'));
    assert.equal((await f.service.directory('alice',{v:1,communityId:'community'})).members.length,1);
    assert.equal((await f.service.binding('alice',{...BODY,grantId:grant.grantId})).peerId,77);
  }finally{f.db.close();}
});
test('corrupt reserved names fail closed and independent communities cannot reuse a zone',async()=>{
  const f=fixture();try{
    await f.service.session('alice',BODY);await f.service.acquire('alice',{...BODY,requestId:'dns-corrupt'});
    const own=f.store.dnsDirectory('community',START),other=f.store.dnsDirectory('other-community',START);
    assert.notEqual(own.zone,other.zone);
    f.db.prepare('UPDATE community_et_dns_devices SET alias=?').run('attacker.custom-domain');
    await assert.rejects(f.service.directory('alice',{v:1,communityId:'community',includeDnsNames:true}),code('grant-store-corrupt'));
    assert.equal((await f.service.directory('alice',{v:1,communityId:'community'})).members.length,1);
  }finally{f.db.close();}
});
test('existing auth rejects stale server/user versions, member removal, wrong host and DB failure',async()=>{
  const f=fixture();try {
    f.control.serverVersion=1;await assert.rejects(f.auth('alice','community'),code('auth-retired'));
    f.control.serverVersion=0;f.control.userVersion=1;await assert.rejects(f.auth('alice','community'),code('auth-retired'));
    f.control.userVersion=0;f.control.member=false;await assert.rejects(f.auth('alice','community'),code('membership-required'));
    f.control.member=true;f.services.getServerConfig=async()=>{throw new Error('database-private-details');};
    await assert.rejects(f.auth('alice','community'),code('auth-unavailable'));
    const auth=createCommunityMemberAuthorizer({...f.services,verifyAccessToken:()=>({grytUserId:'alice',serverUserId:'server-alice',
      serverHost:'wrong.invalid',tokenVersion:0,iat:999,exp:1600})},{communityId:'community',serverHost:'test.invalid'},()=>START);
    await assert.rejects(auth('alice','community'),code('auth-required'));
  }finally {f.db.close();}
});
test('disabled has priority; write activation is explicit and blocks fake success',async()=>{
  const f=fixture();try {
    f.control.enabled=false;await assert.rejects(f.service.session('',{} as typeof BODY),code('community-et-disabled'));
    f.control.enabled=true;await f.service.session('alice',BODY);f.control.writes=false;
    await assert.rejects(f.service.acquire('alice',{...BODY,requestId:'acquire'}),code('native-activation-required'));
    assert.equal(f.control.createCount,0);
  }finally {f.db.close();}
});
test('same-key renewal reads actual expiry and preserves grant/credential identity',async()=>{
  const f=fixture();try {
    await f.service.session('alice',BODY);const first=await f.service.acquire('alice',{...BODY,requestId:'first'});
    f.control.wall+=80000;const renewed=await f.service.renew('alice',{...BODY,requestId:'renew',grantId:first.grantId});
    assert.equal(renewed.grantId,first.grantId);assert.equal(renewed.credentialId,first.credentialId);
    assert.equal(renewed.credentialSecretB64,first.credentialSecretB64);assert.equal(renewed.revision,first.revision+1);
    assert.ok(renewed.expiresAtMs>first.expiresAtMs);assert.equal(f.control.createCount,1);
  }finally {f.db.close();}
});
test('unchanged Upsert expiry cannot be presented as a renewed grant',async()=>{
  const f=fixture();try {
    await f.service.session('alice',BODY);const first=await f.service.acquire('alice',{...BODY,requestId:'first'});
    f.control.wall+=80000;f.control.upsertExtends=false;
    await assert.rejects(f.service.renew('alice',{...BODY,requestId:'renew',grantId:first.grantId}),code('native-readback-mismatch'));
    assert.equal(f.store.load(first.scope).record.grant,null);assert.equal(f.store.cleanup(first.grantId)!.confirmed,false);
  }finally {f.db.close();}
});
test('old revoke never kills a newer acquire; revoke succeeds only after absent List readback',async()=>{
  const f=fixture();try {
    await f.service.session('alice',BODY);const old=await f.service.acquire('alice',{...BODY,requestId:'old'});
    f.control.retainRevoked=true;
    await assert.rejects(f.service.revoke('alice',{...BODY,requestId:'revoke',grantId:old.grantId}),code('revocation-unconfirmed'));
    f.control.retainRevoked=false;assert.deepEqual(await f.service.revoke('alice',{...BODY,requestId:'retry',grantId:old.grantId}),{v:1,revoked:true});
    const current=await f.service.acquire('alice',{...BODY,requestId:'new'});
    await f.service.revoke('alice',{...BODY,requestId:'old-again',grantId:old.grantId});
    assert.ok(f.entries.has(current.credentialId));assert.equal(f.store.load(current.scope).record.grant!.grantId,current.grantId);
    assert.equal(f.control.revokeIds.includes(current.credentialId),false);
  }finally {f.db.close();}
});
test('membership removed during provider completion retires the response and persists cleanup',async()=>{
  const f=fixture();try {
    await f.service.session('alice',BODY);f.setAfterCreate(async()=>{f.control.member=false;});
    await assert.rejects(f.service.acquire('alice',{...BODY,requestId:'late'}),code('membership-required'));
    const scope: CommunityGrantScope={serverInstanceId:'backend',accountId:'alice',communityId:BODY.communityId,deviceId:BODY.deviceId,nativeInstanceId:BODY.nativeInstanceId};
    assert.equal(f.store.load(scope).record.grant,null);assert.equal(f.store.cleanups().length,1);
  }finally {f.db.close();}
});
test('new bearer session invalidates late response and does not repeat an unknown native operation',async()=>{
  const f=fixture();try {
    await f.service.session('alice',BODY);
    f.setAfterCreate(async()=>{f.control.wall+=1000;await f.service.session('alice-next',BODY);});
    await assert.rejects(f.service.acquire('alice',{...BODY,requestId:'old-operation'}),code('session-required'));
    f.setAfterCreate(null);const grant=await f.service.acquire('alice-next',{...BODY,requestId:'new-operation'});
    assert.equal(f.control.createCount,2);assert.equal(f.entries.size,1);assert.equal(f.store.load(grant.scope).record.grant!.grantId,grant.grantId);
  }finally {f.db.close();}
});
test('unknown provider outcome retains durable dispatched IDs and reconciles before fresh acquisition',async()=>{
  const f=fixture();try {
    const session=await f.service.session('alice',BODY);
    f.setAfterCreate(async()=>{
      const state=f.store.load(session.intent);
      assert.equal(state.operation!.stage,'dispatched');
      assert.ok(f.entries.has(state.operation!.plan.credentialId));
      throw new Error('synthetic-unknown-outcome');
    });
    await assert.rejects(f.service.acquire('alice',{...BODY,requestId:'unknown'}));
    assert.equal(f.store.load(session.intent).record.grant,null);assert.equal(f.store.cleanups().length,1);
    f.setAfterCreate(null);const fresh=await f.service.acquire('alice',{...BODY,requestId:'fresh'});
    assert.equal(f.entries.size,1);assert.ok(f.entries.has(fresh.credentialId));
    assert.equal(f.store.cleanups()[0].confirmed,true);
  }finally {f.db.close();}
});
test('device/native collisions, cross-community and cross-account requests fail closed',async()=>{
  const f=fixture();try {
    await f.service.session('alice',BODY);
    await assert.rejects(f.service.session('bob',BODY),code('device-instance-conflict'));
    await assert.rejects(f.service.acquire('bob',{...BODY,requestId:'steal'}),code('session-required'));
    await assert.rejects(f.service.session('alice',{...BODY,communityId:'other'}),code('community-forbidden'));
    await assert.rejects(f.service.session('alice',{...BODY,nativeInstanceId:ADMIN}),code('device-instance-mismatch'));
  }finally {f.db.close();}
});
test('binding joins current authenticated key and route, returns exact own-device proof only',async()=>{
  const f=fixture();try {
    await f.service.session('alice',BODY);const grant=await f.service.acquire('alice',{...BODY,requestId:'grant'});
    const proof=await f.service.binding('alice',{...BODY,grantId:grant.grantId});
    assert.deepEqual(Object.keys(proof).sort(),['v','serverUserId','scope','grantId','credentialId','revision','peerId','virtualIp','publicKeyFingerprint','physicalDirectVerified'].sort());
    assert.equal(proof.serverUserId,'server-alice');assert.equal(proof.publicKeyFingerprint,grant.publicKeyFingerprint);
    assert.equal(proof.physicalDirectVerified,false);
    f.control.wrongRoute=true;await assert.rejects(f.service.binding('alice',{...BODY,grantId:grant.grantId}),code('route-binding-mismatch'));
    f.control.wrongRoute=false;f.control.lateSample=true;await assert.rejects(f.service.binding('alice',{...BODY,grantId:grant.grantId}),code('binding-pending'));
    f.control.wall=grant.expiresAtMs;await assert.rejects(f.service.binding('alice',{...BODY,grantId:grant.grantId}),code('inactive-binding-grant'));
  }finally {f.db.close();}
});
test('private SQLite state is encrypted and tampering is rejected',async()=>{
  const f=fixture();try {
    const session=await f.service.session('alice',BODY);const grant=await f.service.acquire('alice',{...BODY,requestId:'private'});
    const encoded=f.db.prepare('SELECT sealed_state FROM community_et_grants').get()!.sealed_state as string;
    assert.equal(encoded.includes(grant.credentialSecretB64),false);
    f.db.prepare('UPDATE community_et_grants SET sealed_state=? WHERE scope_key=?').run(encoded.slice(0,-8)+'AAAAAAAA',communityScopeKey(session.intent));
    assert.throws(()=>f.store.load(grant.scope),code('grant-store-corrupt'));
  }finally {f.db.close();}
});
test('lease takeover blocks stale writer and stale release cannot release current owner',()=>{
  const f=fixture();try {
    const scope={serverInstanceId:'backend',accountId:'alice',communityId:'community',deviceId:'device',nativeInstanceId:INSTANCE};
    const old=f.store.claim(scope,START);assert.throws(()=>f.store.claim(scope,START+1),code('grant-operation-busy'));
    const current=f.store.claim(scope,START+120001);f.store.release(old);
    f.store.assertLease(current,START+120002);assert.throws(()=>f.store.assertLease(old,START+120002),code('grant-operation-retired'));
  }finally {f.db.close();}
});
