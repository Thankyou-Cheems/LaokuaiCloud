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
    binding:async()=>{throw new Error('not-used');}};
}
test('router returns frozen DTO, requires bearer, rejects client identity and marks responses private',async()=>{
  const router=createCommunityGrantRouter(api());
  const accepted=await request(router,'/session',BODY,'member-bearer');
  assert.equal(accepted.status,200);assert.deepEqual(accepted.body,{v:1,serverUserId:'server-user',intent:INTENT});assert.equal(accepted.cache,'no-store');
  assert.equal((await request(router,'/session',BODY)).status,401);
  assert.equal((await request(router,'/session',{...BODY,accountId:'attacker'},'member-bearer')).status,400);
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
