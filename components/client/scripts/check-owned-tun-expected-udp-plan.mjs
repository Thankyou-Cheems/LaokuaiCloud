import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EXPECTED_UDP_PLAN,reviewExpectedUdpBind } from './owned-tun-expected-udp-plan.mjs';
import { fakeSocketSnapshot } from './owned-tun-socket-fixture.mjs';
import { validateLight } from './owned-tun-light-policy.mjs';
import { SCOPE } from './owned-tun-trial-policy.mjs';
let count=0;const test=(name,fn)=>{fn();console.log(`ok ${++count} ${name}`);};
const proof=()=>({sourceCommit:EXPECTED_UDP_PLAN.sourceCommit,coreSha256:EXPECTED_UDP_PLAN.coreSha256,
 stunServers:[],tcpStunServers:[],stunServersV6:[],peers:[],listeners:[],mappedListeners:[],exitNodes:[],routes:[],proxyNetworks:[],portForwards:[],disableP2p:true,
 disableTcpHolePunching:true,disableUdpHolePunching:true,disableUpnp:true,enableIpv6:false,externalConfigManagement:false,
 acceptDns:false,enableBroadcastRelay:false,enableExitNode:false,noTun:false});
function sample(){
 const s=fakeSocketSnapshot(123),e=s.socketEvidence;
 e.endpoints.push({protocol:'UDP',localAddress:{family:4,kind:'wildcard',value:'0.0.0.0',token:null},localPort:52000,
  remoteAddress:null,remotePort:null,remoteAvailability:'not-exposed-by-Get-NetUDPEndpoint',state:'not-exposed',owningPid:123,
  ownerIdentity:e.identityBefore.fingerprint,identityBinding:'matched-across-query',query:e.queries.udp,knownFields:true,
  forbiddenByFrozenRule:true,classification:'forbidden'});
 e.totalRows=e.retainedRows=e.endpoints.length;e.ownedForbiddenSocketCount=s.ownedForbiddenSocketCount=1;
 return s;
}
test('normal empty-list bind is within proposal; frozen count and evidence stay unchanged',()=>{
 const s=sample(),before=structuredClone(s),r=reviewExpectedUdpBind(s,123,proof());
 assert.equal(r.expectedUdpBindCount,1);assert.equal(r.frozenForbiddenSocketCount,1);assert.equal(r.udpEgress,'not-measured');
 assert.equal(r.udpCallsite,'not-attributed');assert.equal(r.activationAuthorized,false);assert.deepEqual(s,before);
});
test('no transient endpoint is also within scope',()=>assert.equal(reviewExpectedUdpBind(fakeSocketSnapshot(123),123,proof()).expectedUdpBindCount,0));
test('missing/changed source/config proof cannot use the proposed exception',()=>{
 assert.throws(()=>reviewExpectedUdpBind(sample(),123));
 assert.throws(()=>reviewExpectedUdpBind(fakeSocketSnapshot(),0,proof()));
 for(const key of ['stunServers','tcpStunServers','stunServersV6','peers','listeners','mappedListeners','exitNodes','routes','proxyNetworks','portForwards']){const p=proof();delete p[key];assert.throws(()=>reviewExpectedUdpBind(sample(),123,p));p[key]=['synthetic-target'];assert.throws(()=>reviewExpectedUdpBind(sample(),123,p));}
 for(const edit of [{sourceCommit:'other'},{coreSha256:'other'},{disableP2p:false},{disableTcpHolePunching:false},{disableUdpHolePunching:false},{disableUpnp:false},{enableIpv6:true},{externalConfigManagement:true},{acceptDns:true},{enableBroadcastRelay:true},{enableExitNode:true},{noTun:true}])assert.throws(()=>reviewExpectedUdpBind(sample(),123,{...proof(),...edit}));
});
test('extra UDP endpoint cannot be silently classified as another detector',()=>{
 const s=sample(),e=s.socketEvidence;e.endpoints.push(structuredClone(e.endpoints[1]));e.totalRows=e.retainedRows=3;e.ownedForbiddenSocketCount=s.ownedForbiddenSocketCount=2;
 assert.throws(()=>reviewExpectedUdpBind(s,123,proof()));
});
test('IPv6, loopback, interface-bound, reserved RPC or unknown UDP shapes remain rejected',()=>{
 for(const edit of [{localAddress:{family:6,kind:'wildcard',value:'::',token:null}},{localAddress:{family:4,kind:'loopback',value:'127.0.0.1',token:null}},{localAddress:{family:4,kind:'private',value:'10.253.253.1',token:null}},{localPort:15897},{localPort:0},{localPort:null}]){
  const s=sample();Object.assign(s.socketEvidence.endpoints[1],edit);assert.throws(()=>reviewExpectedUdpBind(s,123,proof()));
 }
});
test('an actual reported UDP destination is not approved by a bare bind proposal',()=>{
 const s=sample();Object.assign(s.socketEvidence.endpoints[1],{remoteAddress:{family:4,kind:'other-unicast',value:null,token:'b'.repeat(64)},remotePort:3478,remoteAvailability:'observed'});
 assert.throws(()=>reviewExpectedUdpBind(s,123,proof()));
});
test('non-RPC TCP and foreign RPC remain rejected',()=>{
 const s=sample(),row=s.socketEvidence.endpoints[0];row.localPort=9000;row.forbiddenByFrozenRule=true;s.socketEvidence.ownedForbiddenSocketCount=s.ownedForbiddenSocketCount=2;s.portalOwnerPids=s.socketEvidence.portalOwnerPids=[];
 assert.throws(()=>reviewExpectedUdpBind(s,123,proof()));
 const foreign=sample();foreign.socketEvidence.endpoints[0].owningPid=6424;foreign.socketEvidence.endpoints[0].ownerIdentity=null;foreign.socketEvidence.endpoints[0].identityBinding='foreign-unverified';foreign.portalOwnerPids=foreign.socketEvidence.portalOwnerPids=[6424];assert.throws(()=>reviewExpectedUdpBind(foreign,123,proof()));
});
test('PID identity, unknown/incomplete/truncated and aggregate consistency remain mandatory',()=>{
 for(const edit of [e=>{e.identityAfter.fingerprint='b'.repeat(64);},e=>{e.complete=false;},e=>{e.unknownRows=1;},e=>{e.truncated=true;},e=>{e.endpoints=[];},e=>{e.ownedForbiddenSocketCount=0;}]){const s=sample();edit(s.socketEvidence);assert.throws(()=>reviewExpectedUdpBind(s,123,proof()));}
});
test('proposal is not wired; existing executor still rejects UDP',()=>{
 assert.equal(EXPECTED_UDP_PLAN.connectedToRunner,false);
 for(const file of ['run-owned-tun-trial.mjs','owned-tun-observer-worker.mjs','owned-tun-trial-policy.mjs','owned-tun-light-policy.mjs'])assert.ok(!fs.readFileSync(new URL('./'+file,import.meta.url),'utf8').includes('owned-tun-expected-udp-plan'));
 const old={guid:SCOPE.protectedGuid,luid:'100',ifIndex:30,status:'Up',addresses:[{ip:SCOPE.protectedAddress,prefix:24,family:4}]};
 assert.throws(()=>validateLight({guiFingerprint:'old',adapters:[old]},{...sample(),lightSchema:1,complete:true,guiAlive:true,guiFingerprint:'old',driverRunning:true,adapterGuids:[old.guid],adapters:[old]}, {pid:123,interfaces:[]}));
});
console.log(`${count} pure proposal checks passed; no OS read, native/network process, activation or executor policy change`);
