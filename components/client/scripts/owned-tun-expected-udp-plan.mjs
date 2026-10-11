import { validateSocketEvidence } from './owned-tun-socket-policy.mjs';

// Shared full/light test decision. Activation stays behind the fresh scope gate.
export const EXPECTED_UDP_PLAN = Object.freeze({
 schema:1, connectedToRunner:true, activationAuthorized:false,
 sourceCommit:'dbaf04531024f4201e73ec0bc5ba6a7a6d8d3b49',coreSha256:'d4f100ace0ae50b5270af10f579a2ccf7b2991731f05b82920eefba60055d49a',
 maximumOwnedUdpRows:1, localAddress:'0.0.0.0', family:4,
 purposeAttribution:'not-proven-by-socket-table', udpEgressObservation:'not-measured',
});
const fail=code=>{throw new Error(code);};
const empty=value=>Array.isArray(value)&&value.length===0;

/** Pure scope check; never grants activation or changes original evidence. */
export function reviewExpectedUdpBind(snapshot,ownedPid,preconditions) {
 if(!Number.isInteger(ownedPid)||ownedPid<1||ownedPid>4294967295)fail('owned-live-pid-required');
 const cfg=preconditions?.configuration,top=cfg?.topLevel,flags=cfg?.flags;
 if(preconditions?.sourceCommit!==EXPECTED_UDP_PLAN.sourceCommit||preconditions.coreSha256!==EXPECTED_UDP_PLAN.coreSha256
  ||!['stun_servers','tcp_stun_servers','stun_servers_v6','peer','listeners','mapped_listeners','exit_nodes','routes','proxy_network','port_forward'].every(key=>empty(top?.[key]))
  ||flags?.disable_p2p!==true||flags?.disable_tcp_hole_punching!==true||flags?.disable_udp_hole_punching!==true
  ||flags?.disable_upnp!==true||flags?.enable_ipv6!==false||cfg?.externalConfigManagement!==false
  ||flags?.accept_dns!==false||flags?.enable_udp_broadcast_relay!==false||flags?.enable_exit_node!==false||flags?.no_tun!==false
  ||top?.ipv6_public_addr_provider!==false||top?.ipv6_public_addr_auto!==false)fail('expected-udp-source-or-config-proof-missing');
 const e=validateSocketEvidence(snapshot,ownedPid);
 if(e.nonLoopbackRpc||e.portalOwnerPids.some(pid=>pid!==ownedPid))fail('unexpected-rpc-binding');
 if(e.endpoints.some(row=>row.protocol==='TCP'&&row.forbiddenByFrozenRule))fail('unexpected-tcp-endpoint');
 const udp=e.endpoints.filter(row=>row.protocol==='UDP');
 if(udp.length>EXPECTED_UDP_PLAN.maximumOwnedUdpRows)fail('extra-udp-endpoint');
 for(const row of udp){
  if(row.owningPid!==ownedPid||row.identityBinding!=='matched-across-query'||row.localAddress.family!==4
   ||row.localAddress.kind!=='wildcard'||row.localAddress.value!=='0.0.0.0'||row.localPort<1||row.localPort===15897)fail('unexpected-udp-bind-shape');
 }
 return Object.freeze({classification:'within-frozen-test-bind-scope',activationAuthorized:false,
  expectedUdpBindCount:udp.length,frozenForbiddenSocketCount:e.ownedForbiddenSocketCount,
  unexpectedEndpointCount:0,udpCallsite:'not-attributed',udpEgress:'not-measured'});
}
export function validateTrialSocketScope(snapshot,ownedPid,scope){
 if(JSON.stringify(scope?.expectedOwnedUdpBinding)!==JSON.stringify(EXPECTED_UDP_PLAN))fail('unreviewed-udp-bind-scope');
 if(ownedPid)return reviewExpectedUdpBind(snapshot,ownedPid,{sourceCommit:scope.sourceCommit,
  coreSha256:scope.payload.find(file=>file.name==='easytier-core.exe')?.sha256,configuration:scope.configuration});
 const e=validateSocketEvidence(snapshot,0);
 if(e.ownedForbiddenSocketCount||e.nonLoopbackRpc||e.portalOwnerPids.length)fail('unexpected-baseline-or-residual-socket');
 return Object.freeze({classification:'baseline-or-residual-no-owned-endpoint',activationAuthorized:false,
  expectedUdpBindCount:0,frozenForbiddenSocketCount:e.ownedForbiddenSocketCount,unexpectedEndpointCount:0,
  udpCallsite:'not-attributed',udpEgress:'not-measured'});
}
