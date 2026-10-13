import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { Duplex } from 'node:stream';
import test from 'node:test';
import express from 'express';

import { COMMUNITY_ET_UPSTREAM_COMMIT, ContractError } from './communityGrant';
import type { CommunityGrantApi } from './communityGrantApi';
import { createCommunityGrantFactory, type CommunityGrantFactoryOptions } from './communityGrantFactory';
import { createCommunityGrantRouter } from './communityGrantRouter';
import type { CommunityRelayResponseV2 } from './communityRelayPolicy';

const BODY={v:1 as const,communityId:'community',deviceId:'device',nativeInstanceId:'11111111-1111-4111-8111-111111111111'};
const INTENT={serverInstanceId:'backend',accountId:'account',communityId:'community',deviceId:'device',nativeInstanceId:BODY.nativeInstanceId,
  networkName:'network',networkRevision:1,virtualIp:'10.77.0.2',bootstrapProfileId:'profile'};
/** In-memory HTTP objects only; no listen(), real socket, native process or token. */
async function request(router: express.Router,url: string,body: unknown,bearer?: string) {
  const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}});
  const req=new IncomingMessage(socket as unknown as import('node:net').Socket);
  req.method='POST';req.url='/api/community-et'+url;req.headers={};
  if (bearer) req.headers.authorization='Bearer '+bearer;
  Object.assign(req,{body,_body:true});
  const res=new ServerResponse(req),app=express();app.use('/api/community-et',router);
  return new Promise<{status:number;body:unknown;cache:unknown}>((resolve,reject)=>{
    Object.defineProperty(res,'end',{value:(data?: string|Buffer)=>{
      resolve({status:res.statusCode,body:JSON.parse(data?.toString()??'null'),cache:res.getHeader('cache-control')});socket.destroy();return res;
    }});
    app(req as express.Request,res as express.Response,error=>{socket.destroy();reject(error??new Error('route-not-handled'));});
  });
}
function api(): CommunityGrantApi {
  return {session:async()=>({v:1,serverUserId:'server-user',intent:INTENT}),
    acquire:async()=>{throw new Error('PRIVATE-ERROR-TEXT-MUST-NOT-ESCAPE');},
    renew:async()=>{throw new Error('not-used');},revoke:async()=>{throw new ContractError('revocation-unconfirmed');},
    binding:async()=>{throw new Error('not-used');},directory:async()=>({v:1,communityId:'community',members:[]})};
}
test('router returns frozen DTO, requires bearer, rejects client identity and marks responses private',async()=>{
  const router=createCommunityGrantRouter(api());
  const accepted=await request(router,'/session',BODY,'member-bearer');
  assert.equal(accepted.status,200);assert.deepEqual(accepted.body,{v:1,serverUserId:'server-user',intent:INTENT});assert.equal(accepted.cache,'no-store');
  assert.equal((await request(router,'/session',BODY)).status,401);
  assert.equal((await request(router,'/session',{...BODY,accountId:'attacker'},'member-bearer')).status,400);
});
test('directory returns only the small server-issued address roster',async()=>{
  const router=createCommunityGrantRouter({...api(),directory:async()=>({v:1,communityId:'community',members:[{serverUserId:'server-user',virtualIp:'10.77.0.2'}]})});
  const result=await request(router,'/directory',{v:1,communityId:'community'},'member-bearer');
  assert.equal(result.status,200);assert.deepEqual(result.body,{v:1,communityId:'community',members:[{serverUserId:'server-user',virtualIp:'10.77.0.2'}]});
  assert.equal((await request(router,'/directory',{v:1,communityId:'community',deviceId:'attacker'},'member-bearer')).status,400);
});
test('DNS directory is a member-authenticated opt-in with no hostname input channel',async()=>{
  const dns={zone:`c-${'a'.repeat(32)}.lan.voice.ruikang.wang.`,serverTimeMs:1000000,maxAgeMs:10000};
  const member={serverUserId:'server-user',virtualIp:'10.77.0.2',dnsName:`d-${'b'.repeat(32)}.${dns.zone}`,dnsExpiresAtMs:1010000};
  const router=createCommunityGrantRouter({...api(),directory:async(_bearer,body)=>body.includeDnsNames===true?
    {v:1,communityId:body.communityId,members:[member],dns}:{v:1,communityId:body.communityId,members:[{serverUserId:member.serverUserId,virtualIp:member.virtualIp}]}});
  const body={v:1,communityId:'community',includeDnsNames:true};
  const result=await request(router,'/directory',body,'member-bearer');
  assert.equal(result.status,200);assert.equal(result.cache,'no-store');assert.deepEqual(result.body,{v:1,communityId:'community',members:[member],dns});
  assert.equal((await request(router,'/directory',body)).status,401);
  for(const extra of [{dnsName:'claimed'},{hostname:'claimed'},{zone:'foreign'},{accountId:'attacker'}])
    assert.equal((await request(router,'/directory',{...body,...extra},'member-bearer')).status,400);
  const legacy=await request(router,'/directory',{v:1,communityId:'community'},'member-bearer');
  assert.deepEqual(legacy.body,{v:1,communityId:'community',members:[{serverUserId:member.serverUserId,virtualIp:member.virtualIp}]});
});
test('router never exposes raw exceptions or turns pending revoke into success; disabled wins',async()=>{
  const router=createCommunityGrantRouter(api());
  const failed=await request(router,'/acquire',{...BODY,requestId:'request'},'member-bearer');
  assert.equal(failed.status,503);assert.equal(JSON.stringify(failed.body).includes('PRIVATE-ERROR'),false);
  const revoke=await request(router,'/revoke',{...BODY,requestId:'request',grantId:'grant'},'member-bearer');
  assert.equal(revoke.status,409);assert.deepEqual(revoke.body,{v:1,error:'revocation-unconfirmed'});
  const disabled=await request(createCommunityGrantRouter(api(),undefined,()=>false),'/session',{invalid:true});
  assert.equal(disabled.status,503);assert.deepEqual(disabled.body,{v:1,error:'community-et-disabled'});
});
test('V2 relay routes authenticate, parse exact intent, preserve private caching, and expose only stable errors',async()=>{
  const body={...BODY,v:2,requestId:'relay-request',grantId:'grant',expectedConsentRevision:0,enabled:true,bytesPerSecond:65536};
  const response:CommunityRelayResponseV2={v:2,consent:{v:2,enabled:true,revision:1,bytesPerSecond:65536},grant:{
    v:2,requestId:'relay-request',scope:{serverInstanceId:'backend',accountId:'account',communityId:'community',deviceId:'device',nativeInstanceId:BODY.nativeInstanceId},
    grantId:'grant',credentialId:'credential',revision:2,networkName:'network',networkRevision:1,virtualIp:'10.77.0.2',bootstrapProfileId:'profile',
    issuedAtMs:1000000,serverTimeMs:1000000,renewAfterMs:1070000,expiresAtMs:1120000,publicKeyFingerprint:'a'.repeat(64),credentialSecretB64:Buffer.alloc(32,7).toString('base64'),
    policy:{reusable:false,allowRelay:true,allowedProxyCidrs:[],relay:{v:2,enabled:true,revision:1,bytesPerSecond:65536}}}};
  let calls=0;const router=createCommunityGrantRouter({...api(),relay:async(bearer,value)=>{assert.equal(bearer,'member-bearer');assert.deepEqual(value,body);calls++;return response;},
    relayRenew:async()=>response,relayStatus:async()=>{throw new ContractError('relay-consent-conflict');}});
  assert.equal((await request(router,'/relay',body)).status,401);
  assert.equal((await request(router,'/relay',{...body,allowRelay:true},'member-bearer')).status,400);assert.equal(calls,0);
  const accepted=await request(router,'/relay',body,'member-bearer');assert.equal(accepted.status,200);assert.equal(accepted.cache,'no-store');assert.deepEqual(accepted.body,response);
  const renew={...BODY,v:2,requestId:'relay-renew',grantId:'grant'};
  assert.equal((await request(router,'/relay-renew',renew,'member-bearer')).status,200);
  const denied=await request(router,'/relay-status',renew,'member-bearer');assert.equal(denied.status,409);assert.deepEqual(denied.body,{v:2,error:'relay-consent-conflict'});
  const old=createCommunityGrantRouter(api());assert.deepEqual((await request(old,'/relay',body,'member-bearer')).body,{v:2,error:'relay-v2-disabled'});
  assert.equal((await request(old,'/session',BODY,'member-bearer')).status,200);
});
test('owner factory is inert, schema initialization is explicit and transport remains owner controlled',()=>{
  const db=new DatabaseSync(':memory:');let calls=0;
  try {
    const options: CommunityGrantFactoryOptions={db,serverSecret:'PURE-TEST-EXISTING-SERVER-SECRET-0123456789',trustedServerOrigin:'https://test.invalid',
      existingAuth:{verifyAccessToken:()=>null,getServerConfig:async()=>null,checkSessionAllowed:async()=>({ok:false,code:'membership_required'})},
      service:{serverInstanceId:'backend',communityId:'community',networkName:'network',networkRevision:1,bootstrapProfileId:'profile',
        virtualIpPool:['10.77.0.2'],authority:{adminInstanceId:'22222222-2222-4222-8222-222222222222',upstreamCommit:COMMUNITY_ET_UPSTREAM_COMMIT,groups:['group']},
        ttlSeconds:120,enabled:()=>false,credentialWritesEnabled:()=>false,runtimeGeneration:()=>1},
      provider:{adminInstanceId:'22222222-2222-4222-8222-222222222222',expectedVersion:'2.7.0-8b7f1f01',endpoint:{host:'127.0.0.1',port:15890,timeoutMs:1000}},
      managementTransport:{call:async()=>{calls++;throw new Error('must-not-call');}}};
    const factory=createCommunityGrantFactory(options);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get()!.n,0);
    factory.initializeSchema();assert.ok(Number(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get()!.n)>0);
    assert.equal(calls,0);
    assert.throws(()=>createCommunityGrantFactory({...options,trustedServerOrigin:'http://test.invalid'}),/invalid-server-origin/);
  }finally {db.close();}
});
