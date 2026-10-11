import { parentPort,workerData } from 'node:worker_threads';
import { execFile,spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { readOwnedSnapshot } from './owned-tun-snapshot-reader.mjs';
import { SCOPE,SCOPE_SHA256,validateBefore,validateDuring,validateAfter } from './owned-tun-trial-policy.mjs';
import { configurationDifferences } from './owned-tun-snapshot-semantics.mjs';
import { validateLight } from './owned-tun-light-policy.mjs';
import { validateTrialSocketScope } from './owned-tun-expected-udp-plan.mjs';
let baseline,fullSequence=0,lightSequence=0,lightChild,lightFlight,lightBuffer='',ownedIdentity;
const controls=new Set();
const save=async(name,value)=>fsp.writeFile(path.join(workerData.directory,name),JSON.stringify({...value,scopeSha256:SCOPE_SHA256},null,2),{flag:'wx'});
const safe=error=>/^[a-z0-9-]{1,96}$/.test(error?.message??'')?error.message:'observer-unavailable';
async function archiveSocketDecision(name,value,request){
 let decision;
 try{decision=validateTrialSocketScope(value,request.owned?.pid??0,SCOPE);}
 catch(error){await save(name,{schema:1,stage:request.stage,failure:safe(error),accepted:false});throw error;}
 await save(name,{schema:1,stage:request.stage,...decision,accepted:true,wholeTrialAccepted:false});
}
function bindObservedIdentity(value,request){
 if(!request.owned?.pid||value.socketEvidence?.identityBinding!=='matched-across-query')return;
 const identity=value.socketEvidence.identityBefore.fingerprint;
 if(ownedIdentity&&identity!==ownedIdentity)throw new Error('owned-process-identity-changed');ownedIdentity??=identity;
}
function cancel(){for(const c of controls)c.abort();if(lightFlight){lightFlight.reject(new Error('light-read-cancelled'));lightChild?.kill();lightChild=null;}}
function ensureLight(){
 if(lightChild)return;
 const child=spawn(workerData.powershell,['-NoProfile','-NonInteractive','-File',path.join(workerData.scripts,'owned-tun-light-snapshot.ps1'),'-Persistent'],{windowsHide:true,shell:false,stdio:['pipe','pipe','ignore']});
 lightChild=child;lightBuffer='';
 child.stdin.on('error',()=>{});
 child.stdout.on('data',bytes=>{
  if(lightChild!==child)return;
  lightBuffer+=bytes.toString('utf8');
  if(Buffer.byteLength(lightBuffer)>SCOPE.light.maxOutputBytes){lightFlight?.reject(new Error('light-output-overflow'));child.kill();return;}
  let index;while((index=lightBuffer.indexOf('\n'))>=0){
   const line=lightBuffer.slice(0,index);lightBuffer=lightBuffer.slice(index+1);
   try {const row=JSON.parse(line.replace(/^\uFEFF/,''));if(!lightFlight||String(row.id)!==lightFlight.id)throw new Error();
    row.failure?lightFlight.reject(new Error('light-read-unavailable')):lightFlight.resolve(row.value);
   }catch{lightFlight?.reject(new Error('invalid-light-snapshot'));}
  }
 });
 const exited=()=>{if(lightChild!==child)return;lightChild=null;lightFlight?.reject(new Error('light-reader-exited'));};
 child.once('exit',exited);child.once('error',exited);
}
async function light(request){
 if(lightFlight)throw new Error('overlapping-light-read');
 const sequence=++lightSequence,started=performance.now();let value,failure;
 try {
  ensureLight();
  value=await new Promise((resolve,reject)=>{
   const finish=fn=>result=>{if(!lightFlight)return;clearTimeout(lightFlight.timer);lightFlight=null;fn(result);};
   lightFlight={id:String(sequence),resolve:finish(resolve),reject:finish(reject),timer:setTimeout(()=>{const c=lightChild;lightFlight?.reject(new Error('light-read-timeout'));c?.kill();if(lightChild===c)lightChild=null;},request.warmup?SCOPE.snapshot.timeoutMs:SCOPE.light.timeoutMs)};
   lightChild.stdin.write(JSON.stringify({id:String(sequence),pid:request.owned?.pid??0})+'\n');
  });
  await save(`light-${sequence}-safe.json`,{...value,stage:request.stage,wallElapsedMs:Math.round(performance.now()-started)});
  await archiveSocketDecision(`light-${sequence}-socket-scope.json`,value,request);
  if(request.warmup){validateLight(baseline,value,null,{settling:true});return {ready:false,elapsedMs:Math.round(performance.now()-started)};}
  bindObservedIdentity(value,request);
  const ready=validateLight(baseline,value,request.owned,{settling:request.stage==='settling'});
  return {ready,elapsedMs:Math.round(performance.now()-started)};
 }catch(error){failure=safe(error);throw error;}
 finally {await save(`light-${sequence}-diagnostic.json`,{stage:request.stage,elapsedMs:Math.round(performance.now()-started),failure:failure??null,complete:Boolean(value?.complete)});}
}
async function full(request){
 const sequence=++fullSequence,control=new AbortController();controls.add(control);const started=performance.now();
 try {
  const current=await readOwnedSnapshot({execFile,executable:workerData.powershell,script:path.join(workerData.scripts,'owned-tun-trial-snapshot.ps1'),ownedPid:request.owned?.pid??0,signal:control.signal,timeoutMs:SCOPE.snapshot.timeoutMs,maxBuffer:SCOPE.snapshot.maxBufferBytes,
   onDiagnostic:d=>save(`snapshot-${sequence}-diagnostic.json`,d),onSnapshot:s=>save(`snapshot-${sequence}-full-safe.json`,s)});
  await archiveSocketDecision(`snapshot-${sequence}-socket-scope.json`,current,request);
  bindObservedIdentity(current,request);
  let ready=false;
  if(request.stage==='before'){validateBefore(current);baseline=current;}
  else{
   await save(`comparison-${sequence}.json`,{stage:request.stage,differences:configurationDifferences(baseline,current)});
   if(request.stage==='prepared'){validateBefore(current);validateDuring(baseline,current,null);}
   else if(request.stage==='during')ready=validateDuring(baseline,current,request.owned);
   else if(request.stage==='after')validateAfter(baseline,current,request.reports);
   else throw new Error('unknown-observation-stage');
  }
  return {ready,elapsedMs:Math.round(performance.now()-started)};
 }finally{controls.delete(control);}
}
const operations=new Set();
parentPort.on('message',request=>{
 if(request.op==='cancel'){cancel();return;}
 if(request.op==='close'){cancel();lightChild?.kill();Promise.allSettled([...operations]).then(()=>parentPort.postMessage({id:request.id,value:{closed:true}}));return;}
 const operation=(async()=>{
  try {const value=await (request.op==='full'?full(request):request.op==='light'?light(request):Promise.reject(new Error('invalid-observer-operation')));parentPort.postMessage({id:request.id,value});}
  catch(error){const failure=safe(error);try{await save(`request-${request.id}-failure.json`,{op:request.op,stage:request.stage,failure});}catch{parentPort.postMessage({id:request.id,failure:'observation-evidence-write-failed'});return;}parentPort.postMessage({id:request.id,failure});}
 })();operations.add(operation);void operation.finally(()=>operations.delete(operation));
});
