import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const url=source=>'data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source,{mode:'transform'})).toString('base64');
const cacheUrl=url(readFileSync(new URL('../src/lib/receivePriorCache.ts',import.meta.url),'utf8'));
const {ReceivePriorCache}=await import(cacheUrl);
const {ReceivePriorSession}=await import(url(readFileSync(new URL('../src/lib/receivePriorSession.ts',import.meta.url),'utf8').replace('"./receivePriorCache"',JSON.stringify(cacheUrl))));
let wall=2e12,calls=0;const storage={raw:null,getItem(){return this.raw;},setItem(_key,data){this.raw=data;}};
const cache=new ReceivePriorCache(storage,()=>wall);cache.setAccount('a');
const scope={accountId:'a',serverInstanceId:'s',remoteUserId:'p'};
const id={participantId:'p',receiverId:'r',trackId:'t',generation:1};
const prior=(s,now)=>({schemaVersion:1,processorSchema:'gryt-receive-level-v2',learnedGainDb:0,speechLevelDbfs:-20,effectiveSpeechSeconds:s.acceptedSpeechSeconds,lastVerifiedUnixMs:now});
const session=new ReceivePriorSession(cache,(s,now)=>{calls++;return s.acceptedSpeechSeconds>=5 ? prior(s,now) : undefined;},()=>wall);
session.bind(id,scope,()=>true);
const observe=(count,audio,delta={})=>{wall++;return session.observe({...id,acceptedSpeechSeconds:count,lastAcceptedSpeechAudioTimeSeconds:audio,...delta});};
const checks=[];
function check(name,fn){fn();checks.push(name);}
check('same binding counter resets after mute and newer real speech renews',()=>{
 assert.equal(observe(3600,4000),true);assert.equal(observe(0,null),false);
 assert.equal(observe(5,4010),true);assert.equal(cache.get(scope).effectiveSpeechSeconds,5);
});
check('repeated polls, delayed old audio and increasing forged counter cannot renew',()=>{
 const saved=cache.get(scope).lastVerifiedUnixMs;
 assert.equal(observe(5,4010),false);assert.equal(observe(9999,4010),false);assert.equal(observe(3601,3999),false);
 assert.equal(cache.get(scope).lastVerifiedUnixMs,saved);
});
check('counter reset need not have an observed zero snapshot',()=>{assert.equal(observe(100,4100),true);assert.equal(observe(5,4200),true);});
check('same counter cannot manufacture accepted speech with only a changed timestamp',()=>{assert.equal(observe(5,4201),false);assert.equal(observe(6,4202),true);});
check('no audio cursor, nonfinite input, negative clocks and clock regressions fail closed',()=>{
 for(const t of [null,undefined,NaN,Infinity,-Infinity,-1,4199])assert.equal(observe(7,t),false);
 for(const n of [NaN,Infinity,-Infinity,-1,0])assert.equal(observe(n,4203),false);
 assert.equal(observe(7,4203),true);
});
check('clear preserves cursor and requires real post-clear audio',()=>{
 session.clear(scope,4300);assert.equal(observe(8,4204),false);assert.equal(cache.get(scope),undefined);
 assert.equal(observe(8,4301),false);assert.equal(observe(9,4302),true);
});
check('clear without a running clock stays closed',()=>{session.clear(scope);assert.equal(observe(10,4400),false);assert.equal(cache.get(scope),undefined);});
check('new track and PC generation isolates old and permits a new audio clock',()=>{
 session.unbind(id);const next={...id,generation:2,trackId:'new-track'};session.bind(next,scope,()=>true);
 assert.equal(observe(11,4500),false);assert.equal(observe(5,10,next),true);
 assert.equal(observe(12,4501),false);
});
check('room or account retire and old async lease cannot repopulate',()=>{
 session.reset();assert.equal(observe(5,20,{...id,generation:2,trackId:'new-track'}),false);
 session.bind(id,scope,()=>true);cache.setAccount('b');cache.setAccount('a');assert.equal(observe(5,5000),false);
});
console.log(JSON.stringify({status:'passed',checks,exportCalls:calls,scope:'Synthetic scalar records only; no microphone, real profile or browser.'},null,2));
