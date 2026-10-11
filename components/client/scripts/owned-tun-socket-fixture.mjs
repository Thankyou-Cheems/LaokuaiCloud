// Synthetic test facts only; no OS reads or network operations.
export function fakeSocketSnapshot(pid=0) {
 const at='2026-10-11T00:00:00.000Z',fingerprint='a'.repeat(64);
 const query=status=>({startedAtUtc:at,finishedAtUtc:at,status});
 const queries={tcp:query('complete'),udp:query(pid?'complete':'not-requested')};
 const identity={pid,status:pid?'observed':'not-requested',fingerprint:pid?fingerprint:null,observedAtUtc:at};
 const address=(value,kind)=>({family:4,kind,value,token:null});
 const endpoints=pid?[{protocol:'TCP',localAddress:address('127.0.0.1','loopback'),localPort:15897,remoteAddress:address('0.0.0.0','wildcard'),remotePort:0,remoteAvailability:'provider-snapshot',state:'Listen',owningPid:pid,ownerIdentity:fingerprint,identityBinding:'matched-across-query',query:queries.tcp,knownFields:true,forbiddenByFrozenRule:false,classification:'rpc-server-side'}]:[];
 return {nonLoopbackRpc:false,ownedForbiddenSocketCount:0,portalOwnerPids:pid?[pid]:[],socketEvidence:{schema:1,complete:true,capturedAtUtc:at,targetPid:pid,identityBefore:identity,identityAfter:{...identity},identityBinding:pid?'matched-across-query':'not-requested',queries,totalRows:endpoints.length,retainedRows:endpoints.length,truncated:false,unknownRows:0,ownedForbiddenSocketCount:0,nonLoopbackRpc:false,portalOwnerPids:pid?[pid]:[],endpoints}};
}
