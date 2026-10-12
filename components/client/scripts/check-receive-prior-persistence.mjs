import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const url=text=>'data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(text,{mode:'transform'})).toString('base64');
const source=path=>readFileSync(new URL('../src/lib/'+path,import.meta.url),'utf8');
const cacheUrl=url(source('receivePriorCache.ts'));
const {ReceivePriorCache}=await import(cacheUrl);
const {ReceivePriorSession}=await import(url(source('receivePriorSession.ts').replace('"./receivePriorCache"',JSON.stringify(cacheUrl))));
const {subscribeReceivePriorLifecycle}=await import(url(source('receivePriorLifecycle.ts')));
const oldTimeout=globalThis.setTimeout,oldClear=globalThis.clearTimeout;
let time=0,serial=0,scheduled=0,cancelled=0;const pending=new Map();
globalThis.setTimeout=(fn,delay)=>{const id=++serial;pending.set(id,{fn,at:time+delay});scheduled++;return id;};
globalThis.clearTimeout=id=>{if(pending.delete(id))cancelled++;};
const advance=ms=>{const target=time+ms;while(true){const first=[...pending].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!first)break;time=first[1].at;pending.delete(first[0]);first[1].fn();}time=target;};
const now=()=>2e12+time,scope=n=>({accountId:'a',serverInstanceId:'s',remoteUserId:'p'+n});
const prior=(gain=0)=>({schemaVersion:1,processorSchema:'gryt-receive-level-v2',learnedGainDb:gain,speechLevelDbfs:-20-gain,effectiveSpeechSeconds:5,lastVerifiedUnixMs:now()});
const storage=()=>({raw:null,writes:0,getItem(){return this.raw;},setItem(_k,v){this.raw=v;this.writes++;}});
const create=(options={delayMs:1000})=>{const store=storage(),cache=new ReceivePriorCache(store,now,options);cache.setAccount('a');return {store,cache};};
const checks=[];function test(name,fn){fn();checks.push(name);assert.equal(pending.size,0,'test must retire its timer');}
try{
 test('default immediate compatibility',()=>{const {store,cache}=create({});assert.equal(cache.save(scope(0),prior(),cache.begin(scope(0))),true);assert.equal(store.writes,1);});
 test('one fixed timer, immediate memory and passive get/count without writes',()=>{
  const {store,cache}=create(),start=scheduled;cache.save(scope(0),prior(1),cache.begin(scope(0)));assert.equal(cache.get(scope(0)).learnedGainDb,1);assert.equal(store.writes,0);
  for(let i=0;i<100;i++){cache.get(scope(0));cache.count();}assert.equal(store.writes,0);assert.equal(scheduled-start,1);
  advance(500);cache.save(scope(0),prior(2),cache.begin(scope(0)));advance(499);assert.equal(store.writes,0);advance(1);
  assert.equal(store.writes,1);assert.equal(JSON.parse(store.raw).rows[0].prior.learnedGainDb,2);assert.equal(scheduled-start,1);
 });
 test('twenty callbacks share one write, explicit flush cancels pending callback',()=>{
  const {store,cache}=create(),start=scheduled;
  for(let i=0;i<20;i++)cache.save(scope(i),prior(),cache.begin(scope(i)));
  assert.equal(scheduled-start,1);assert.equal(cache.count(),20);assert.equal(store.writes,0);
  cache.flush();assert.equal(store.writes,1);advance(2000);assert.equal(store.writes,1);cache.flush();assert.equal(store.writes,1);
 });
 test('single clear is immediate, cancels timer and invalidates all old leases',()=>{
  const {store,cache}=create();const a=cache.begin(scope(0)),b=cache.begin(scope(1));cache.save(scope(0),prior(),a);cache.save(scope(1),prior(),b);
  cache.clear(scope(0));assert.equal(store.writes,1);assert.equal(JSON.parse(store.raw).rows.length,1);
  assert.equal(cache.save(scope(0),prior(),a),false);assert.equal(cache.save(scope(1),prior(),b),false);advance(2000);assert.equal(store.writes,1);
 });
 test('clear all persists deletion immediately and cannot be resurrected by old timer',()=>{
  const {store,cache}=create();cache.save(scope(0),prior(),cache.begin(scope(0)));cache.clearAccount();assert.equal(JSON.parse(store.raw).rows.length,0);advance(2000);assert.equal(store.writes,1);
 });
 test('account switch flushes prior accepted rows and fences late old-account writes',()=>{
  const {store,cache}=create(),lease=cache.begin(scope(0));cache.save(scope(0),prior(),lease);cache.setAccount('b');assert.equal(store.writes,1);
  cache.setAccount('a');assert.equal(cache.save(scope(0),prior(),lease),false);assert.equal(cache.get(scope(0)).effectiveSpeechSeconds,5);
 });
 test('unbind/reset flush once through a twenty-member retirement storm',()=>{
  const {store,cache}=create();const session=new ReceivePriorSession(cache,(s,t)=>({...prior(),lastVerifiedUnixMs:t,effectiveSpeechSeconds:s.acceptedSpeechSeconds}),now);
  const ids=Array.from({length:20},(_,i)=>({participantId:'p'+i,receiverId:'r'+i,trackId:'t'+i,generation:1}));
  for(let i=0;i<20;i++){session.bind(ids[i],scope(i),()=>true);session.observe({...ids[i],acceptedSpeechSeconds:5,lastAcceptedSpeechAudioTimeSeconds:1});}
  for(const id of ids)session.unbind(id);session.reset();assert.equal(store.writes,1);assert.equal(JSON.parse(store.raw).rows.length,20);
  assert.equal(session.observe({...ids[0],acceptedSpeechSeconds:6,lastAcceptedSpeechAudioTimeSeconds:2}),false);
 });
 test('visibility hidden, pagehide and cleanup flush; listeners retire exactly',()=>{
  const {store,cache}=create();const win=new EventTarget(),doc=new EventTarget();doc.visibilityState='visible';let calls=0;
  const cleanup=subscribeReceivePriorLifecycle({flush(){calls++;return cache.flush();}},win,doc);
  cache.save(scope(0),prior(),cache.begin(scope(0)));doc.dispatchEvent(new Event('visibilitychange'));assert.equal(store.writes,0);
  doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));assert.equal(store.writes,1);
  cache.save(scope(0),prior(1),cache.begin(scope(0)));win.dispatchEvent(new Event('pagehide'));assert.equal(store.writes,2);
  cache.save(scope(0),prior(2),cache.begin(scope(0)));cleanup();assert.equal(store.writes,3);const before=calls;
  win.dispatchEvent(new Event('pagehide'));doc.dispatchEvent(new Event('visibilitychange'));assert.equal(calls,before);
 });
 test('storage fault cancels work, disables cache once and callback failures do not escape',()=>{
  let errors=0;const {store,cache}=create({delayMs:1000,onFailure(){errors++;throw Error('observer');}});let attempted=0;
  store.setItem=()=>{attempted++;throw Error('quota');};cache.save(scope(0),prior(),cache.begin(scope(0)));assert.doesNotThrow(()=>advance(1000));
  assert.equal(cache.available,false);assert.equal(errors,1);assert.equal(cache.count(),0);cache.flush();cache.clearAccount();advance(10000);
  assert.equal(cache.save(scope(0),prior(),cache.begin(scope(0))),false);assert.equal(attempted,1);
 });
 test('30-day expiry is wall-clock, deferred flush never updates evidence time',()=>{
  const {store,cache}=create();const saved=prior();cache.save(scope(0),saved,cache.begin(scope(0)));advance(1000);
  assert.equal(JSON.parse(store.raw).rows[0].prior.lastVerifiedUnixMs,saved.lastVerifiedUnixMs);
  advance(30*86400000);assert.equal(cache.get(scope(0)),undefined);assert.equal(store.writes,1);
 });
 test('500 entry LRU cap is retained without sorting per accepted callback',()=>{
  const {store,cache}=create();for(let i=0;i<500;i++){advance(1);cache.save(scope(i),prior(),cache.begin(scope(i)));}
  advance(1);cache.get(scope(0));advance(1);cache.save(scope(500),prior(),cache.begin(scope(500)));
  assert.ok(cache.get(scope(0)));assert.equal(cache.get(scope(1)),undefined);assert.equal(cache.count(),500);cache.flush();assert.equal(JSON.parse(store.raw).rows.length,500);
 });
 test('expired recently accessed rows are pruned before a valid LRU is evicted',()=>{
  const store=storage();const start=now();store.raw=JSON.stringify({v:1,rows:Array.from({length:500},(_,n)=>({scope:scope(n),
    prior:{...prior(),lastVerifiedUnixMs:n===499?start-30*86400000+20:start},lastAccessUnixMs:start+n}))});
  const cache=new ReceivePriorCache(store,now,{delayMs:1000});cache.setAccount('a');advance(1);cache.get(scope(499));advance(19);
  cache.save(scope(500),prior(),cache.begin(scope(500)));assert.ok(cache.get(scope(0)),'still-valid oldest row must survive');
  assert.equal(cache.get(scope(499)),undefined);assert.equal(cache.count(),500);cache.flush();assert.equal(JSON.parse(store.raw).rows.length,500);
 });
 test('configured delay is bounded and does not renew postponed deadlines',()=>{
  const {store,cache}=create({delayMs:1e9});cache.save(scope(0),prior(),cache.begin(scope(0)));advance(999);assert.equal(store.writes,0);advance(1);assert.equal(store.writes,1);
 });
 console.log(JSON.stringify({status:'passed',checks,scheduled,cancelled,scope:'Fake monotonic timer/storage/page events; actual cache/session/lifecycle modules. No physical audio, browser scheduling or power-loss guarantee.'},null,2));
}finally{globalThis.setTimeout=oldTimeout;globalThis.clearTimeout=oldClear;}
