const fail=()=>{throw new Error('socket-evidence-unavailable-or-inconsistent');};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const port=value=>Number.isInteger(value)&&value>=0&&value<=65535;
const address=a=>a&&[4,6].includes(a.family)&&['wildcard','loopback','private','link-local','multicast','other-unicast'].includes(a.kind)
 &&(a.value===null?hash(a.token):a.token===null&&typeof a.value==='string'&&(a.kind==='loopback'||a.kind==='wildcard'||['10.126.126.2','10.253.253.1'].includes(a.value)));
// Endpoint detail is mandatory. Aggregates cannot substitute for missing/unknown evidence.
export function validateSocketEvidence(snapshot,targetPid) {
 const e=snapshot?.socketEvidence;
 if(e?.schema!==1||e.complete!==true||e.targetPid!==targetPid||!time(e.capturedAtUtc)||e.truncated!==false||e.unknownRows!==0
  ||!Array.isArray(e.endpoints)||e.totalRows!==e.endpoints.length||e.retainedRows!==e.endpoints.length||e.endpoints.length>256)fail();
 for(const protocol of ['tcp','udp']){
  const q=e.queries?.[protocol];
  if(!q||!time(q.startedAtUtc)||!time(q.finishedAtUtc)||Date.parse(q.startedAtUtc)>Date.parse(q.finishedAtUtc)
   ||q.status!==(protocol==='udp'&&!targetPid?'not-requested':'complete'))fail();
 }
 if(targetPid){
  if(e.identityBinding!=='matched-across-query'||e.identityBefore?.pid!==targetPid||e.identityAfter?.pid!==targetPid
   ||e.identityBefore.status!=='observed'||e.identityAfter.status!=='observed'||!hash(e.identityBefore.fingerprint)
   ||e.identityBefore.fingerprint!==e.identityAfter.fingerprint||!time(e.identityBefore.observedAtUtc)||!time(e.identityAfter.observedAtUtc))fail();
 }else if(e.identityBinding!=='not-requested')fail();
 let forbidden=0,nonLoopback=false;const owners=new Set();
 for(const r of e.endpoints){
  if(!['TCP','UDP'].includes(r.protocol)||!address(r.localAddress)||!port(r.localPort)||r.knownFields!==true
   ||!Number.isInteger(r.owningPid)||r.owningPid<0||r.owningPid>4294967295||r.forbiddenByFrozenRule!==!!r.forbiddenByFrozenRule)fail();
  const owned=targetPid>0&&r.owningPid===targetPid;
  if(owned&&(r.identityBinding!=='matched-across-query'||r.ownerIdentity!==e.identityBefore.fingerprint))fail();
  if(r.protocol==='UDP'){
   if(!owned||r.remoteAddress!==null||r.remotePort!==null||r.remoteAvailability!=='not-exposed-by-Get-NetUDPEndpoint'||r.state!=='not-exposed')fail();
  }else{
   if(!address(r.remoteAddress)||!port(r.remotePort)||r.remoteAvailability!=='provider-snapshot'
    ||!['Closed','Listen','SynSent','SynReceived','Established','FinWait1','FinWait2','CloseWait','Closing','LastAck','TimeWait','DeleteTCB','Bound'].includes(r.state))fail();
   if(r.state==='Listen'&&r.localPort===15897){owners.add(r.owningPid);nonLoopback ||= r.localAddress.value!=='127.0.0.1';}
   else if(!owned)fail();
  }
  const deny=owned&&(r.protocol==='UDP'||r.localAddress.value!=='127.0.0.1'||r.localPort!==15897||!['0.0.0.0','127.0.0.1'].includes(r.remoteAddress?.value));
  if(r.forbiddenByFrozenRule!==deny)fail();if(deny)forbidden++;
 }
 const sorted=value=>Array.isArray(value)||value instanceof Set?[...value].sort((a,b)=>a-b):fail();
 if(e.ownedForbiddenSocketCount!==forbidden||snapshot.ownedForbiddenSocketCount!==forbidden||e.nonLoopbackRpc!==nonLoopback||snapshot.nonLoopbackRpc!==nonLoopback
  ||JSON.stringify(sorted(e.portalOwnerPids??[]))!==JSON.stringify(sorted(owners))||JSON.stringify(sorted(snapshot.portalOwnerPids??[]))!==JSON.stringify(sorted(owners)))fail();
 return e;
}
