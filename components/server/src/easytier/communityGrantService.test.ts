import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createCommunityMemberAuthorizer, type ExistingCommunityAuthServices } from './communityGrantAuth';
import { CommunityGrantService, type CommunityGrantServiceProvider } from './communityGrantService';
import { communityScopeKey, communityVaultKey, SqliteCommunityGrantStore } from './communityGrantStore';
import {
  COMMUNITY_ET_UPSTREAM_COMMIT, ContractError, publicKeyFingerprint, type CommunityGrantScope,
  type NativeAuthority, type CreateCredentialIntent, type ExtendCredentialIntent, type NativeCredentialReadback, type PrivateNativeCredentialReceipt,
} from './communityGrant';
import type { ProviderPeerObservation } from './communityDeviceBinding';

const INSTANCE='11111111-1111-4111-8111-111111111111';
const ADMIN='22222222-2222-4222-8222-222222222222';
const BODY={v:1 as const,communityId:'community',deviceId:'device',nativeInstanceId:INSTANCE};
const START=1_000_000;
const AUTHORITY: NativeAuthority={adminInstanceId:ADMIN,upstreamCommit:COMMUNITY_ET_UPSTREAM_COMMIT,groups:['community-member']};

/** Fake provider only in pure tests; never exported or selected by product code. */
function fixture(communityId: string = BODY.communityId) {
  const db=new DatabaseSync(':memory:'),store=new SqliteCommunityGrantStore(db,communityVaultKey('PURE-TEST-VAULT-SECRET-01234567890123456789'));
  store.initSchema();
  const control={wall:START,mono:0,enabled:true,writes:true,member:true,serverVersion:0,userVersion:0,generation:1,
    retainRevoked:false,upsertExtends:true,lateSample:false,wrongRoute:false,createCount:0,revokeIds:[] as string[]};
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
      const entry=entries.get(request.id)!;
      assert.equal(request.secret,entry.receipt.credentialSecretB64);
      if (control.upsertExtends) {entry.readback.expiryUnix=request.expiryUnix;entry.receipt.expiryUnix=request.expiryUnix;}
      return {changed:control.upsertExtends};
    },
    read:async credentialId=>structuredClone(entries.get(credentialId)?.readback??null),
    revoke:async request=>{control.revokeIds.push(request.credentialId);if (!control.retainRevoked) entries.delete(request.credentialId);return {success:true};},
    observeAuthenticatedPeer:async request=>{
      if (control.lateSample) control.mono+=6000;
      const entry=[...entries.values()][0];
      const sample: ProviderPeerObservation={providerGeneration:control.generation,observedMonoMs:control.mono,networkName:'network',
        connections:[{peerId:77,networkName:'network',isClosed:false,secureAuthLevel:2,peerIdentityType:1,remotePublicKeyB64:entry.publicB64}],
        routes:[{peerId:77,nativeInstanceId:request.scope.nativeInstanceId,virtualIp:control.wrongRoute?'10.77.0.99':'10.77.0.2',nextHopPeerId:77}]};
      return sample;
    },
  };
  const service=new CommunityGrantService({serverInstanceId:communityId===BODY.communityId?'backend':communityId,communityId,networkName:'network',networkRevision:1,
    bootstrapProfileId:'public-2.7',virtualIpPool:['10.77.0.2','10.77.0.3'],authority:AUTHORITY,ttlSeconds:120,
    enabled:()=>control.enabled,credentialWritesEnabled:()=>control.writes,runtimeGeneration:()=>control.generation},store,provider,auth,
    {wallMs:()=>control.wall,monoMs:()=>control.mono});
  return {db,store,service,control,entries,services,auth,setAfterCreate:(value:typeof afterCreate)=>{afterCreate=value;}};
}
const code=(expected:string)=>(error:unknown)=>error instanceof ContractError && error.code===expected;
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
