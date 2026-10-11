import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCOPE, SCOPE_SHA256, sha256, validateApproval } from './owned-tun-trial-policy.mjs';
import { DIAGNOSTIC_PREFIX, readOwnedSnapshot, snapshotDiagnostic } from './owned-tun-snapshot-reader.mjs';

// Fake child/callback/clock only. No Windows queries, UAC, native binaries or sockets.
let count = 0;
const row = (phase, stage, extra = {}) => DIAGNOSTIC_PREFIX + JSON.stringify({schema:1,phase,stage,elapsedMs:40,...extra}) + '\n';
async function test(name, action) { await action(); console.log(`ok ${++count} ${name}`); }
function fixture({error=null, stdout='{"snapshotSchema":1,"complete":true}', stderr=row('serialize','ok'), aborted=false, writeError=false, syncThrow=false}={}) {
  const controller=new AbortController(); if(aborted) controller.abort();
  const diagnostics=[]; let call, tick=0;
  const result=readOwnedSnapshot({execFile:(...args)=>{call=args; if(syncThrow) throw error; args.at(-1)(error,stdout,stderr);},
    executable:'powershell.exe',script:'snapshot.ps1',ownedPid:0,signal:controller.signal,
    timeoutMs:SCOPE.snapshot.timeoutMs,maxBuffer:SCOPE.snapshot.maxBufferBytes,now:()=>tick++*50,
    onDiagnostic:async d=>{diagnostics.push(d); if(writeError) throw new Error('disk failure');}});
  return {result,diagnostics,get call(){return call;}};
}
await test('complete safe snapshot persists before comparison and write failure fails closed',async()=>{
  const calls=[];
  const run=onSnapshot=>readOwnedSnapshot({execFile:(exe,args,opts,done)=>done(null,'{"snapshotSchema":1,"complete":true}',''),
    executable:'powershell.exe',script:'snapshot.ps1',ownedPid:0,signal:new AbortController().signal,timeoutMs:40000,maxBuffer:2097152,
    onSnapshot,onDiagnostic:async()=>calls.push('diagnostic')});
  await run(async s=>{assert.equal(s.complete,true);calls.push('full-safe-snapshot');});
  assert.deepEqual(calls,['full-safe-snapshot','diagnostic']);
  await assert.rejects(run(async()=>{throw new Error('disk');}),/read-only-snapshot-write-failed/);
});
await test('later semantic decode failure still retains complete safe input',async()=>{
  let archived;
  const result=readOwnedSnapshot({execFile:(exe,args,opts,done)=>done(null,JSON.stringify({snapshotSchema:1,complete:true,semanticEncoded:{schema:1,encoding:'gzip-base64',data:'AA=='}}),''),
    executable:'powershell.exe',script:'snapshot.ps1',ownedPid:0,signal:new AbortController().signal,timeoutMs:40000,maxBuffer:2097152,
    onSnapshot:async s=>{archived=s;},onDiagnostic:async()=>{}});
  await assert.rejects(result,/invalid-semantic-configuration/);assert.equal(archived.complete,true);
});
await test('complete snapshot retains safe stderr/timing and readonly arguments', async()=>{
  const f=fixture(); assert.deepEqual(await f.result,{snapshotSchema:1,complete:true});
  assert.deepEqual(f.call[1],['-NoProfile','-NonInteractive','-File','snapshot.ps1','-OwnedPid','0']);
  const opts=f.call[2]; assert.equal(opts.shell,false); assert.equal(opts.windowsHide,true);
  assert.equal(opts.timeout,40000); assert.equal(opts.maxBuffer,2097152);
  assert.equal(f.diagnostics[0].elapsedMs,50); assert.equal(f.diagnostics[0].lastPhase,'serialize');
});
await test('preflight access denied preserves exact known stderr metadata',async()=>{
  const f=fixture({error:{code:1},stderr:row('fw-address','error',{exceptionType:'Microsoft.Management.Infrastructure.CimException',category:'PermissionDenied',hresult:-2146233088,fullyQualifiedErrorId:'Windows System Error 5,Get-NetFirewallAddressFilter',reason:'access-denied'})});
  await assert.rejects(f.result,/read-only-snapshot-unavailable/);
  const d=f.diagnostics[0]; assert.equal(d.exitCode,1); assert.equal(d.lastPhase,'fw-address');
  assert.equal(d.stderr[0].fullyQualifiedErrorId,'Windows System Error 5,Get-NetFirewallAddressFilter');
  assert.equal(d.stderr[0].hresult,-2146233088);
});
await test('timeout preserves killed/signal and last phase instead of guessing OS error',async()=>{
  const f=fixture({error:{code:null,killed:true,signal:'SIGTERM'},stderr:row('fw-interface','start')});
  await assert.rejects(f.result,/read-only-snapshot-timeout/); assert.equal(f.diagnostics[0].killed,true);
  assert.equal(f.diagnostics[0].signal,'SIGTERM'); assert.equal(f.diagnostics[0].lastPhase,'fw-interface');
});
await test('cancellation and callback success after abort cannot provide baseline',async()=>{
  for(const error of [{code:'ABORT_ERR'},null]) {
    const f=fixture({aborted:true,error}); await assert.rejects(f.result,/read-only-snapshot-cancelled/);
    assert.equal(f.diagnostics[0].aborted,true);
  }
});
await test('administrator denial is explicit without turning it into a passing baseline',async()=>{
  const f=fixture({error:{code:1},stderr:row('administrator','error',{fullyQualifiedErrorId:'snapshot-requires-administrator',reason:'requires-administrator'})});
  await assert.rejects(f.result,/read-only-snapshot-requires-administrator/);
});
await test('invalid JSON, absent schema and partial results fail with no stdout logged',async()=>{
  for(const stdout of ['secret-text','{"complete":true}','{"snapshotSchema":1,"complete":false}']) {
    const f=fixture({stdout}); await assert.rejects(f.result,/invalid-read-only-snapshot|incomplete-read-only-snapshot/);
    assert.ok(!JSON.stringify(f.diagnostics).includes('secret-text'));
  }
});
await test('unstructured endpoints/credentials and malformed protocol never appear in journal',()=>{
  const input='network_secret=private-secret udp://203.0.113.7:1234 [2001:db8::7]\n'+row('fw-address','error',{exceptionType:'private-secret.example',fullyQualifiedErrorId:'203.0.113.7,Get-NetFirewallAddressFilter',message:'private-secret',target:'2001:db8::7'})+DIAGNOSTIC_PREFIX+'truncated';
  const d=snapshotDiagnostic({message:input,cmd:input},input,40,40000,false);
  const serialized=JSON.stringify(d); for(const text of ['private-secret','203.0.113.7','2001:db8','udp://']) assert.ok(!serialized.includes(text));
  assert.equal(d.stderrBytes,Buffer.byteLength(input)); assert.equal(d.stderrSha256,sha256(input)); assert.equal(d.droppedLines,2);
});
await test('diagnostic persistence failure prevents baseline acceptance',async()=>{
  const f=fixture({writeError:true}); await assert.rejects(f.result,/read-only-diagnostic-write-failed/);
});
await test('synchronous spawn error also records failure',async()=>{
  const f=fixture({syncThrow:true,error:{code:'ENOENT'}}); await assert.rejects(f.result,/read-only-snapshot-unavailable/);
  assert.equal(f.diagnostics[0].errorCode,'ENOENT');
});
await test('long or incomplete stderr remains bounded and unknown',()=>{
  const d=snapshotDiagnostic({},row('routes','start').repeat(90)+row('not-a-phase','ok'),3,40000,false);
  assert.equal(d.stderr.length,64); assert.equal(d.droppedLines,27);
  assert.equal(snapshotDiagnostic({},'',3,40000,false).lastPhase,'unknown');
});
await test('scope pins both readonly sources and rejects consumed approval',()=>{
  assert.equal(sha256(fs.readFileSync(new URL('./owned-tun-trial-snapshot.ps1',import.meta.url))),SCOPE.snapshot.scriptSha256);
  assert.equal(sha256(fs.readFileSync(new URL('./owned-tun-snapshot-reader.mjs',import.meta.url))),SCOPE.snapshot.readerSha256);
  assert.equal(sha256(fs.readFileSync(new URL('./owned-tun-snapshot-semantics.mjs',import.meta.url))),SCOPE.snapshot.semanticsSha256);
  assert.notEqual(SCOPE_SHA256,'c737fd450558cd0176356dc0e1dea3a086bf34a9042ed8e60cd89a6c15b47f20');
  assert.throws(()=>validateApproval(['--execute','--approved-scope-sha256','c737fd450558cd0176356dc0e1dea3a086bf34a9042ed8e60cd89a6c15b47f20']));
  assert.throws(()=>validateApproval(['--execute','--approved-scope-sha256','c44bdbae1f2839914485b8c062b739557af271f92e27120a64bbef498be320ee']));
  assert.throws(()=>validateApproval(['--execute','--approved-scope-sha256','dd60b94603ffb3e17a85450810e2f3edfba3183705e0d515f662037916692dfc']));
});
await test('incomplete/cancelled/error snapshots are saved; absent JSON retains only digest metadata',async()=>{
 for(const [stdout,error] of [['{"snapshotSchema":1,"complete":false}',null],['{"snapshotSchema":1,"complete":true}',{code:1}]]){
  let archived;
  const value=readOwnedSnapshot({execFile:(exe,args,opts,done)=>done(error,stdout,''),executable:'fake',script:'fake',ownedPid:0,signal:new AbortController().signal,timeoutMs:40000,maxBuffer:2097152,onSnapshot:async s=>{archived=s;},onDiagnostic:async()=>{}});
  await assert.rejects(value);assert.equal(archived.snapshotSchema,1);
 }
 const f=fixture({stdout:'partial-safe-output',error:{code:1}});await assert.rejects(f.result);assert.equal(f.diagnostics[0].partialOutputSha256,sha256('partial-safe-output'));assert.ok(!JSON.stringify(f.diagnostics).includes('partial-safe-output'));
});
console.log(`passed ${count} pure snapshot checks; no OS/native activation`);
