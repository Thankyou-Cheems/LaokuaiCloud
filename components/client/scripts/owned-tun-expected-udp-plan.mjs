import { validateSocketEvidence } from './owned-tun-socket-policy.mjs';
import { SCOPE } from './owned-tun-trial-policy.mjs';

// Reviewable proposal only. The runner/worker/policies do not import this module.
export const EXPECTED_UDP_PLAN = Object.freeze({
 schema:1, connectedToRunner:false, activationAuthorized:false,
 sourceCommit:SCOPE.sourceCommit, coreSha256:SCOPE.payload.find(f=>f.name==='easytier-core.exe').sha256,
 maximumOwnedUdpRows:1, localAddress:'0.0.0.0', family:4,
 purposeAttribution:'not-proven-by-socket-table', udpEgressObservation:'not-measured',
});
const fail=code=>{throw new Error(code);};
const empty=value=>Array.isArray(value)&&value.length===0;

/** Pure proposed scope check; never grants activation or changes frozen evidence. */
export function reviewExpectedUdpBind(snapshot,ownedPid,preconditions) {
 if(!Number.isInteger(ownedPid)||ownedPid<1||ownedPid>4294967295)fail('owned-live-pid-required');
 if(preconditions?.sourceCommit!==EXPECTED_UDP_PLAN.sourceCommit||preconditions.coreSha256!==EXPECTED_UDP_PLAN.coreSha256
  ||!['stunServers','tcpStunServers','stunServersV6','peers','listeners','mappedListeners','exitNodes','routes','proxyNetworks','portForwards'].every(key=>empty(preconditions[key]))
  ||preconditions.disableP2p!==true||preconditions.disableTcpHolePunching!==true||preconditions.disableUdpHolePunching!==true
  ||preconditions.disableUpnp!==true||preconditions.enableIpv6!==false||preconditions.externalConfigManagement!==false
  ||preconditions.acceptDns!==false||preconditions.enableBroadcastRelay!==false||preconditions.enableExitNode!==false||preconditions.noTun!==false)fail('expected-udp-source-or-config-proof-missing');
 const e=validateSocketEvidence(snapshot,ownedPid);
 if(e.nonLoopbackRpc||e.portalOwnerPids.some(pid=>pid!==ownedPid))fail('unexpected-rpc-binding');
 if(e.endpoints.some(row=>row.protocol==='TCP'&&row.forbiddenByFrozenRule))fail('unexpected-tcp-endpoint');
 const udp=e.endpoints.filter(row=>row.protocol==='UDP');
 if(udp.length>EXPECTED_UDP_PLAN.maximumOwnedUdpRows)fail('extra-udp-endpoint');
 for(const row of udp){
  if(row.owningPid!==ownedPid||row.identityBinding!=='matched-across-query'||row.localAddress.family!==4
   ||row.localAddress.kind!=='wildcard'||row.localAddress.value!=='0.0.0.0'||row.localPort<1||row.localPort===15897)fail('unexpected-udp-bind-shape');
 }
 return Object.freeze({classification:'within-proposed-bind-scope',activationAuthorized:false,
  expectedUdpBindCount:udp.length,frozenForbiddenSocketCount:e.ownedForbiddenSocketCount,
  unexpectedEndpointCount:0,udpCallsite:'not-attributed',udpEgress:'not-measured'});
}
