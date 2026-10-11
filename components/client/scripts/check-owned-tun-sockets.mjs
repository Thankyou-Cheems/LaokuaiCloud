import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSocketEvidence } from './owned-tun-socket-policy.mjs';
import { fakeSocketSnapshot } from './owned-tun-socket-fixture.mjs';
import { validateLight } from './owned-tun-light-policy.mjs';
import { SCOPE } from './owned-tun-trial-policy.mjs';
const script=fileURLToPath(new URL('./check-owned-tun-sockets.ps1',import.meta.url));
// PowerShell runs the pure projector with fake rows only; no Get-Net*/Get-Process call.
const rows=JSON.parse(execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',script],{encoding:'utf8',maxBuffer:524288}).replace(/^\uFEFF/,''));
let count=0;
const old={guid:SCOPE.protectedGuid,luid:'100',ifIndex:30,status:'Up',addresses:[{ip:SCOPE.protectedAddress,prefix:24,family:4}]};
const baseline={guiFingerprint:'old-gui',adapters:[old]};
for(const row of rows){
 const e=row.evidence,s={socketEvidence:e,nonLoopbackRpc:e.nonLoopbackRpc,ownedForbiddenSocketCount:e.ownedForbiddenSocketCount,portalOwnerPids:e.portalOwnerPids};
 if(e.complete)assert.equal(validateSocketEvidence(s,123),e);else assert.throws(()=>validateSocketEvidence(s,123));
 const light={...s,lightSchema:1,complete:e.complete,guiAlive:true,guiFingerprint:'old-gui',driverRunning:true,adapterGuids:[old.guid],adapters:[old],ownedIdentity:e.identityBefore.fingerprint};
 const expectedBind=e.endpoints.length===1&&e.endpoints[0].protocol==='UDP'&&e.endpoints[0].localAddress.family===4&&e.endpoints[0].localAddress.value==='0.0.0.0';
 if(!e.complete||(e.ownedForbiddenSocketCount&&!expectedBind)||e.nonLoopbackRpc||e.portalOwnerPids.some(pid=>pid!==123))assert.throws(()=>validateLight(baseline,light,{pid:123,interfaces:[]}));
 else assert.equal(validateLight(baseline,light,{pid:123,interfaces:[]}),false);
 console.log(`ok ${++count} ${row.name}: preserved details and frozen classification`);
}
for(const mutate of [s=>{delete s.socketEvidence;},s=>{s.socketEvidence.complete=false;},s=>{s.socketEvidence.identityAfter.fingerprint='b'.repeat(64);},s=>{s.socketEvidence.endpoints[0].forbiddenByFrozenRule=true;},s=>{s.socketEvidence.queries.tcp.status='unavailable';},s=>{s.socketEvidence.endpoints[0].remoteAvailability='guessed';}]){
 const s=fakeSocketSnapshot(123);mutate(s);assert.throws(()=>validateSocketEvidence(s,123));count++;
}
assert.equal(validateSocketEvidence(fakeSocketSnapshot(),0).endpoints.length,0);
console.log(`${count+1} pure socket checks passed; no core, native helper, OS query or network operation`);
