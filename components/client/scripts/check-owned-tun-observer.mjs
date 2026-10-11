import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import { validateLight } from './owned-tun-light-policy.mjs';
import { createOwnedObserver } from './owned-tun-observer.mjs';
import { runObservedTrial } from './owned-tun-observation-run.mjs';
import { SCOPE } from './owned-tun-trial-policy.mjs';
let count=0;async function test(name,fn){await fn();console.log(`ok ${++count} ${name}`);}
const old={guid:SCOPE.protectedGuid,luid:'100',ifIndex:30,status:'Up',addresses:[{ip:SCOPE.protectedAddress,prefix:24,family:4}]};
const before={guiFingerprint:'old-gui',adapters:[old]},receipt={pid:123,interfaces:[{guid:'00000000-0000-4000-8000-000000000001',luid:'200',ifIndex:77}]};
const light=()=>({lightSchema:1,complete:true,guiAlive:true,guiFingerprint:'old-gui',driverRunning:true,ownedIdentity:'new-owned-child',adapterGuids:[old.guid,receipt.interfaces[0].guid],adapters:[old,{...receipt.interfaces[0],status:'Up',alias:SCOPE.alias,hasDefault:false,safeTrialRoutes:true,addresses:[{ip:SCOPE.virtualAddress,prefix:30,family:4}]}],portalOwnerPids:[123],nonLoopbackRpc:false,ownedForbiddenSocketCount:0});
await test('light requires receipt GUID/LUID/index, exact protected identity and local sockets',()=>{
 assert.equal(validateLight(before,light(),receipt),true);
 for(const change of [{complete:false},{guiFingerprint:'reused-old-pid'},{driverRunning:false},{portalOwnerPids:[6424]},{nonLoopbackRpc:true},{ownedForbiddenSocketCount:1},{adapterGuids:[old.guid,'extra-one','extra-two']}])assert.throws(()=>validateLight(before,{...light(),...change},receipt));
 for(const field of ['guid','luid','ifIndex']){const wrong=structuredClone(receipt);wrong.interfaces[0][field]=field==='ifIndex'?78:'wrong';assert.throws(()=>validateLight(before,light(),wrong));}
 const changed=light();changed.adapters[0]={...old,luid:'recreated'};assert.throws(()=>validateLight(before,changed,receipt));
});
await test('light checks broad routes/address/old interface changes and fails unknown evidence',()=>{
 for(const change of [{hasDefault:true},{safeTrialRoutes:false},{alias:'foreign'},{addresses:[{family:4,ip:'10.253.253.2',prefix:30}]}]){const value=light();Object.assign(value.adapters[1],change);assert.throws(()=>validateLight(before,value,receipt));}
 const missing=light();missing.adapterGuids=[];assert.throws(()=>validateLight(before,missing,receipt));
 assert.throws(()=>validateLight(before,{lightSchema:1,complete:true},receipt));
});
await test('post-stop checks GUID/any RPC owner rather than a reused former numeric PID',()=>{
 assert.equal(validateLight(before,light(),null,{settling:true}),false);
 const clean={...light(),adapterGuids:[old.guid],adapters:[old],portalOwnerPids:[],ownedIdentity:null};assert.equal(validateLight(before,clean,null,{settling:true}),true);
 assert.equal(validateLight(before,{...clean,portalOwnerPids:[999]},null,{settling:true}),false);
});
await test('worker client sends tiny observation requests and cancels only its worker',async()=>{
 let fake;class FakeWorker extends EventEmitter{constructor(){super();fake=this;this.requests=[];}postMessage(row){this.requests.push(row);if(row.id)queueMicrotask(()=>this.emit('message',{id:row.id,value:{ready:true}}));}async terminate(){this.terminated=true;}}
 const observer=createOwnedObserver({}, {WorkerClass:FakeWorker});assert.equal((await observer.full({stage:'during',owned:receipt})).ready,true);observer.cancel();assert.equal(fake.requests[1].op,'cancel');await observer.close();assert.equal(fake.terminated,true);
});
await test('supervisor deadline stops stored owned handle while a real JS worker is CPU blocked',async()=>{
 // Pure JS worker only; no native executable, socket, driver or OS observation.
 const worker=new Worker(`const {parentPort}=require('node:worker_threads');parentPort.on('message',()=>{parentPort.postMessage('entered');const end=Date.now()+600;while(Date.now()<end){}parentPort.postMessage('done');});`,{eval:true});
 await new Promise((resolve,reject)=>{worker.once('online',resolve);worker.once('error',reject);});
 let stopAt,enteredAt,stops=0,foreignStops=0;const handle={stop(){stops++;stopAt=performance.now();}},foreign={stop(){foreignStops++;}};
 const core={isAlive:()=>true,ownedResources:()=>receipt};
 try {
  const result=await runObservedTrial({setTimer:setTimeout,clearTimer:clearTimeout,onCancel:()=>()=>{},cancelReads:()=>{},prepare:async()=>{},start:async()=>core,pause:ms=>new Promise(resolve=>setTimeout(resolve,Math.min(ms,5))),
   processes:{shutdownOwned:()=>handle.stop(),drainOwned:async()=>{},cleanupReports:()=>[{outcome:'graceful',ownedPid:123,interfaces:receipt.interfaces}]},
   light:async()=>({ready:true}),full:async args=>{if(args.stage!=='during')return {ready:false};return new Promise(resolve=>{worker.on('message',row=>{if(row==='entered')enteredAt=performance.now();if(row==='done')resolve({ready:true});});worker.postMessage('block');});},
  },{...SCOPE,maximumRunMs:200},'pure-fake-scope');
  assert.equal(result.outcome,'failed');assert.equal(result.reason,'deadline');assert.equal(stops,1);assert.equal(foreignStops,0);assert.ok(Number.isFinite(enteredAt));assert.ok(stopAt-enteredAt<450,'stop must precede worker CPU completion');void foreign;
 }finally{await worker.terminate();}
});
console.log(`${count} pure observer checks passed; only fake processes and one pure JS thread`);
