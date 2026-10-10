import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const text=stripTypeScriptTypes(readFileSync(new URL('../src/lib/moveAuthority.ts',import.meta.url),'utf8'),{mode:'transform'});
const {createMoveAuthority}=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
const listeners=new Map();const socket={id:'socket-1',connected:true,on(e,f){if(!listeners.has(e))listeners.set(e,new Set());listeners.get(e).add(f)},off(e,f){listeners.get(e)?.delete(f)}};
const emit=(event,payload)=>{for(const cb of listeners.get(event)??[])cb(payload)};
let sent=[];let sendResolve;const send=async(event,payload,guard)=>{sent.push([event,payload]);if(!guard())return false;return true};
const authority=createMoveAuthority(socket,true,send);
const pending=authority.confirmCommit('request');assert.equal(sent[0][0],'voice:move:query');
emit('voice:move:result',{v:1,generation:'socket-1',requestId:'other',status:'committed',sourceChannelId:'a',destinationChannelId:'b'});
emit('voice:move:result',{v:1,generation:'socket-1',requestId:'request',status:'committed',sourceChannelId:'a',destinationChannelId:'b'});
assert.deepEqual(await pending,{requestId:'request',status:'committed',generation:'socket-1',sourceChannelId:'a',destinationChannelId:'b'});
const missing=authority.confirmCommit('missing');emit('voice:move:result',{v:1,generation:'socket-1',requestId:'missing',status:'committed'});await assert.rejects(missing,/invalid_authority_reply/);
let invalidations=0;authority.onInvalidated(()=>invalidations++);
const stale=authority.confirmCommit('stale');socket.connected=false;emit('disconnect');await assert.rejects(stale,/authority_invalidated/);assert.equal(invalidations,1);
socket.connected=true;socket.id='socket-2';await assert.rejects(authority.confirmCommit('old'),/authority_invalidated/);
authority.dispose();assert.equal([...listeners.values()].reduce((n,v)=>n+v.size,0),0);
const unsupported=createMoveAuthority(socket,false,send);await assert.rejects(unsupported.confirmCommit('unsupported'),/staging_unsupported/);unsupported.dispose();
const race=createMoveAuthority(socket,true,async(event,payload,guard)=>new Promise(resolve=>{sendResolve=()=>resolve(guard())}));
const racing=race.confirmCommit('race');race.invalidate();sendResolve();await assert.rejects(racing,/authority_invalidated/);race.dispose();
const settings={requirePushToTalk:true,disableRnnoise:true,maxBitrate:64000,eSportsMode:false};
const serverSettings={requirePTT:true,disableRNNoise:true,maxBitrate:64000,eSportsMode:false,speak:true,shareVideo:false,shareScreen:false,isMuted:false,isDeafened:false};
let policyCurrent=false,policyChecks=0;
const policy=createMoveAuthority(socket,true,send,(requestId,actual)=>{
  policyChecks++;assert.equal(requestId,'policy');assert.deepEqual(actual,serverSettings);return policyCurrent;
});
assert.equal(policy.isDestinationPolicyApplied('policy',settings),false);
const proof=policy.confirmCommit('policy');
emit('voice:move:result',{v:1,generation:'socket-2',requestId:'policy',status:'committed',sourceChannelId:'a',destinationChannelId:'b',channelSettings:serverSettings});
await proof;
assert.equal(policy.isDestinationPolicyApplied('policy',settings),false);
policyCurrent=true;assert.equal(policy.isDestinationPolicyApplied('policy',settings),true);
assert.equal(policy.isDestinationPolicyApplied('other',settings),false);
assert.equal(policy.isDestinationPolicyApplied('policy',{...settings,requirePushToTalk:false}),false);
assert.equal(policy.isDestinationPolicyApplied('policy',{...settings,maxBitrate:128000}),false);
assert.equal(policy.isDestinationPolicyApplied('policy',{...settings,disableRnnoise:false}),false);
assert.equal(policy.isDestinationPolicyApplied('policy',{...settings,eSportsMode:true}),false);
assert.equal(policyChecks,2);
let reason;policy.onInvalidated(value=>reason=value);policy.invalidate('destination_permission_revoked');
assert.equal(reason,'destination_permission_revoked');assert.equal(policy.isDestinationPolicyApplied('policy',settings),false);policy.dispose();
const absent=createMoveAuthority(socket,true,send);
const absentProof=absent.confirmCommit('absent');emit('voice:move:result',{v:1,generation:'socket-2',requestId:'absent',status:'committed',sourceChannelId:'a',destinationChannelId:'b',channelSettings:serverSettings});await absentProof;
assert.equal(absent.isDestinationPolicyApplied('absent',settings),false);absent.dispose();
const malformed=createMoveAuthority(socket,true,send,()=>true);
const malformedProof=malformed.confirmCommit('malformed');emit('voice:move:result',{v:1,generation:'socket-2',requestId:'malformed',status:'committed',sourceChannelId:'a',destinationChannelId:'b',channelSettings:{...serverSettings,speak:'true'}});await malformedProof;
assert.equal(malformed.isDestinationPolicyApplied('malformed',settings),false);malformed.dispose();
const throws=createMoveAuthority(socket,true,send,()=>{throw new Error('unavailable')});
const throwsProof=throws.confirmCommit('throws');emit('voice:move:result',{v:1,generation:'socket-2',requestId:'throws',status:'committed',sourceChannelId:'a',destinationChannelId:'b',channelSettings:serverSettings});await throwsProof;
assert.equal(throws.isDestinationPolicyApplied('throws',settings),false);throws.dispose();
const revoked=createMoveAuthority(socket,true,send,()=>true);let revokedReason;
revoked.onInvalidated(reason=>revokedReason=reason);
const revokedProof=revoked.confirmCommit('revoked');emit('voice:move:result',{v:1,generation:'socket-2',requestId:'revoked',status:'committed',sourceChannelId:'a',destinationChannelId:'b',channelSettings:serverSettings,invalidated:true});
await assert.rejects(revokedProof,/authority_invalidated/);assert.equal(revokedReason,'move_invalidated');
assert.equal(revoked.stagingSupported,false);assert.equal(revoked.isDestinationPolicyApplied('revoked',settings),false);revoked.dispose();
let probed=false;
const dynamic=createMoveAuthority(socket,()=>probed,send);
assert.equal(dynamic.stagingSupported,false);await assert.rejects(dynamic.confirmCommit('before-probe'),/staging_unsupported/);
probed=true;assert.equal(dynamic.stagingSupported,true);
const lateInvalidation=dynamic.confirmCommit('late-invalid');
emit('voice:move:result',{v:1,generation:'old',requestId:'late-invalid',status:'committed',sourceChannelId:'a',destinationChannelId:'b',invalidated:true});
await assert.rejects(lateInvalidation,/invalid_authority_reply/);assert.equal(dynamic.stagingSupported,true);
probed=false;assert.equal(dynamic.stagingSupported,false);dynamic.dispose();
console.log('Staged-move authority identity/ack/invalidation/policy/dynamic-probe checks passed');


const sessionSource=stripTypeScriptTypes(readFileSync(new URL('../src/lib/moveAuthoritySession.ts',import.meta.url),'utf8'),{mode:'transform'})
  .replace('"./moveAuthority"',JSON.stringify('data:text/javascript;base64,'+Buffer.from(text).toString('base64')));
const {createMoveAuthoritySession}=await import('data:text/javascript;base64,'+Buffer.from(sessionSource).toString('base64'));
let refreshed=0;
const session=createMoveAuthoritySession('server-id',[socket,true,send],()=>refreshed++);
const first=session.authority;
emit('server:challenge');assert.equal(first.valid,false);
emit('server:details',{error:'join_required',server_info:{server_id:'server-id'},channels:[]});
emit('server:details',{server_info:{server_id:'wrong'},channels:[]});assert.equal(session.authority,first);
emit('server:joined',{accessToken:'synthetic-fixture-only'});
assert.notEqual(session.authority,first);assert.equal(session.authority.valid,true);assert.equal(first.valid,false);
const second=session.authority;emit('server:details',{server_info:{server_id:'server-id'},channels:[]});assert.equal(session.authority,second);
emit('voice:channel:joined',false);assert.equal(second.valid,false);
emit('voice:room:granted',{room_id:'new-room',join_token:{fixtureOnly:true},timestamp:Date.now()-60000});assert.equal(session.authority,second);
emit('voice:room:granted',{room_id:'new-room',join_token:{fixtureOnly:true},timestamp:Date.now()});
assert.notEqual(session.authority,second);assert.equal(second.valid,false);assert.equal(refreshed,2);
const third=session.authority;socket.id='socket-3';emit('server:joined',{accessToken:'fixture'});assert.equal(session.authority,third);assert.equal(third.valid,false);
session.dispose();assert.equal([...listeners.values()].reduce((n,v)=>n+v.size,0),0);
console.log('Authority challenge/authentication/normal rejoin lifecycle checks passed; old records remain invalid');

const roomSource=stripTypeScriptTypes(readFileSync(new URL('../src/packages/webRTC/src/adapters/roomCoordinator.ts',import.meta.url),'utf8'),{mode:'transform'})
 .replace(/^import .*;$/gm,'').replace('export function createRoomCoordinator','function createRoomCoordinator');
const coordinatorFactory=new Function('handleRateLimitError',roomSource+';return createRoomCoordinator;')(()=>{});
socket.emit=()=>{};
const resumedSession=createMoveAuthoritySession('server-id',[socket,true,send],()=>{});
const coordinator=coordinatorFactory(socket,'fixture',()=>resumedSession.authority);
const beforeLeave=coordinator.moveAuthority;
coordinator.leave();assert.equal(beforeLeave.valid,false);
emit('voice:room:granted',{room_id:'fresh-room',join_token:{fixtureOnly:true},timestamp:Date.now()});
assert.equal(coordinator.moveAuthority.valid,true);assert.notEqual(coordinator.moveAuthority,beforeLeave);assert.equal(beforeLeave.valid,false);
resumedSession.dispose();assert.equal([...listeners.values()].reduce((n,v)=>n+v.size,0),0);
console.log('Actual coordinator getter/leave/grant captures new authority without reviving old moves');

// The real SDK keeps this same coordinator across signalling reconnects.
function freshSocket(id) {
  const events=new Map();const sent=[];
  return {id,connected:true,sent,on(e,f){if(!events.has(e))events.set(e,new Set());events.get(e).add(f)},
    once(e,f){const once=value=>{this.off(e,once);f(value)};this.on(e,once)},off(e,f){events.get(e)?.delete(f)},
    emit(e,v){sent.push([e,v])},reply(e,v){for(const cb of [...events.get(e)??[]])cb(v)}};
}
let activeSocket=freshSocket('first');
let activeSession=createMoveAuthoritySession('server-id',[activeSocket,true,async()=>true],()=>{});
let logicalIdentity=true;
const retained=coordinatorFactory(()=>logicalIdentity?activeSocket:undefined,'fixture',()=>logicalIdentity?activeSession.authority:undefined);
const old=retained.moveAuthority;
activeSocket.connected=false;activeSocket.reply('disconnect');activeSession.dispose();
assert.equal(old.valid,false);assert.equal(retained.connected,false);
assert.equal((await retained.requestAccess('blocked')).granted,false);
activeSocket=freshSocket('replacement');activeSession=createMoveAuthoritySession('server-id',[activeSocket,true,async()=>true],()=>{});
assert.equal(retained.connected,true);assert.equal(retained.moveAuthority,activeSession.authority);assert.notEqual(retained.moveAuthority,old);
await assert.rejects(old.confirmCommit('old'),/authority_invalidated/);
const rejoin=retained.requestAccess('destination');assert.deepEqual(activeSocket.sent,[['voice:room:request','destination']]);
activeSocket.reply('voice:room:granted',{room_id:'destination',join_token:{fixtureOnly:true},sfu_url:'ws://fixture',timestamp:Date.now()});
assert.equal((await rejoin).roomId,'destination');
logicalIdentity=false;assert.equal(retained.connected,false);assert.equal(retained.moveAuthority,undefined);
assert.equal((await retained.requestAccess('other-account')).granted,false);
activeSession.dispose();
console.log('Retained coordinator replacement-socket/generation/access/account fence checks passed');
