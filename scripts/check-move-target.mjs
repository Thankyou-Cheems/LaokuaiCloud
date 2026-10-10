import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const read=file=>stripTypeScriptTypes(readFileSync(new URL(file,import.meta.url),'utf8'),{mode:'transform'});
const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const authorityURL=moduleURL(read('../src/lib/moveAuthority.ts'));
const {createMoveAuthority}=await import(authorityURL);
const {readMovePrepare}=await import(moduleURL(read('../src/lib/movePrepare.ts').replace('"./moveAuthority"',JSON.stringify(authorityURL))));
const {isMovePolicyAcknowledged}=await import(moduleURL(read('../src/lib/movePolicy.ts')));
const hookSource=read('../src/packages/webRTC/src/adapters/useVoiceMoves.ts').replace(/^import .*;$/gm,'').replace('export function useVoiceMoves','function useVoiceMoves');
const loadHook=new Function('deps',`const {useSFU,useMicrophone,useSockets,useRef,useEffect,toast,i18n,readMovePrepare,emitAuthenticated}=deps;
  ${hookSource};return useVoiceMoves;`);
const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
const policy={requirePTT:true,disableRNNoise:true,maxBitrate:64000,eSportsMode:false,speak:true,shareVideo:false,shareScreen:false,isMuted:false,isDeafened:false};
let groups=0;
function setup({supported=true,boundary=true,prepareError=false,policyAck=true}={}) {
  const listeners=new Map(),sent=[],calls=[],errors=[];let binding,cleanup;
  const socket={id:'session',connected:true,on(event,handler){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(handler)},off(event,handler){listeners.get(event)?.delete(handler)}};
  const emit=(event,value)=>{for(const handler of [...listeners.get(event)??[]])handler(value)};
  const ack={publicationAcknowledged:true,publicationBlocked:false,publicationRevision:boundary?4:undefined};
  const evidence={host:'host',channel:'source',generation:'session',config:{audio:{inputMode:'voice_activity',noiseSuppression:true,
    transmitEligible:true,muted:false,serverMuted:false,deafened:false,serverDeafened:false},connection:{mediaMode:'audio-only',eSportsMode:false,maxBitrate:64000}},transmission:ack};
  let replyPolicy=policy;
  const send=async(_socket,event,payload,_host,guard)=>{
    if(!guard())return false;sent.push([event,payload]);
    if(event==='voice:move:query')queueMicrotask(()=>emit('voice:move:result',{v:1,generation:'session',requestId:payload.requestId,
      sourceChannelId:'source',destinationChannelId:'destination',status:'committed',channelSettings:replyPolicy}));
    return true;
  };
  const authority=createMoveAuthority(socket,supported,(event,payload,current)=>send(socket,event,payload,'host',current),
    (id,actual)=>isMovePolicyAcknowledged(binding,id,actual,evidence));
  const sfu={currentServerConnected:'host',currentChannelConnected:'source',
    async prepareMove(request){calls.push(['prepare',request]);if(prepareError)throw Error('injected_prepare_failure');return {requestId:request.requestId,streamId:'staged-msid'}},
    async commitMove(id){calls.push(['commit',id]);await authority.confirmCommit(id);sfu.currentChannelConnected='destination';evidence.channel='destination'},
    async abortMove(id){calls.push(['abort',id])},
    async resumeMoveTransmission(id){calls.push(['resume',id]);assert.equal(authority.isDestinationPolicyApplied(id,{requirePushToTalk:true,disableRnnoise:true,maxBitrate:64000,eSportsMode:false}),true)}
  };
  const hook=loadHook({useSFU:()=>sfu,useMicrophone:()=>({transmissionState:ack}),useSockets:()=>({sockets:{host:socket}}),
    useRef:current=>({current}),useEffect:effect=>{cleanup=effect()},toast:{error:message=>errors.push(message)},i18n:{t:key=>key},
    readMovePrepare,emitAuthenticated:send});
  hook({host:authority},value=>{
    binding=value;if(!value)return;
    evidence.config.audio.inputMode='push_to_talk';evidence.config.audio.noiseSuppression=false;
    ack.publicationAcknowledged=false;
    if(policyAck)queueMicrotask(()=>{ack.publicationAcknowledged=true;ack.publicationBlocked=true;ack.publicationRevision=5});
  });
  const request={v:1,generation:'session',requestId:'11111111-1111-1111-1111-111111111111',sourceChannelId:'source',
    destinationChannelId:'destination',joinToken:{move_id:'11111111-1111-1111-1111-111111111111'},sfuUrls:['ws://127.0.0.1:9999'],
    expiresAt:Date.now()+30000,channelSettings:policy};
  const result=()=>emit('voice:move:result',{v:1,generation:'session',requestId:request.requestId,sourceChannelId:'source',destinationChannelId:'destination',status:'committed'});
  return {socket,authority,sfu,ack,evidence,calls,sent,errors,emit,request,result,changePolicy:value=>{replyPolicy=value},
    dispose(){cleanup?.();authority.dispose()},get binding(){return binding},listenerCount:()=>[...listeners.values()].reduce((sum,set)=>sum+set.size,0)};
}
{
  const f=setup();assert.equal(f.sent[0][0],'voice:move:client');f.emit('voice:move:prepare',f.request);await tick();
  assert.deepEqual(f.sent.find(([event])=>event==='voice:move:ready')[1],{requestId:f.request.requestId,streamId:'staged-msid'});
  f.result();await tick();assert.equal(f.calls.filter(([event])=>event==='commit').length,1);assert.equal(f.calls.filter(([event])=>event==='resume').length,1);
  assert.equal(f.binding,undefined);f.dispose();assert.equal(f.listenerCount(),0);groups++;
}
{
  const f=setup();f.emit('voice:move:prepare',f.request);f.emit('voice:move:prepare',f.request);await tick();
  f.result();f.result();await tick();assert.equal(f.calls.filter(([event])=>event==='prepare').length,1);
  assert.equal(f.calls.filter(([event])=>event==='commit').length,1);assert.equal(f.calls.filter(([event])=>event==='resume').length,1);f.dispose();groups++;
}
for(const [field,value] of [['generation','old'],['v',2],['sourceChannelId','other'],['joinToken',{move_id:'other'}],['expiresAt',0],
  ['sfuUrls',[]],['channelSettings',{...policy,speak:'true'}],['requestId','bad']]) {
  const f=setup();f.emit('voice:move:prepare',{...f.request,[field]:value});await tick();assert.equal(f.calls.length,0);f.dispose();groups++;
}
{
  const f=setup({supported:false});assert.equal(f.sent.length,0);f.emit('voice:move:prepare',f.request);await tick();assert.equal(f.calls.length,0);f.dispose();groups++;
}
{
  const f=setup({boundary:false});f.emit('voice:move:prepare',f.request);await tick();assert.equal(f.calls.length,0);assert.equal(f.errors.length,1);f.dispose();groups++;
}
{
  const f=setup({prepareError:true});f.emit('voice:move:prepare',f.request);await tick();assert.equal(f.sent.some(([event])=>event==='voice:move:ready'),false);
  assert.equal(f.sent.some(([event])=>event==='voice:move:abort'),true);assert.equal(f.errors.length,1);f.dispose();groups++;
}
{
  const f=setup({policyAck:false});f.emit('voice:move:prepare',f.request);await tick();f.result();await tick();
  assert.equal(f.calls.some(([event])=>event==='resume'),false);assert.ok(f.binding);
  f.socket.connected=false;f.emit('disconnect');await tick();assert.equal(f.binding,undefined);
  assert.equal(f.calls.some(([event])=>event==='resume'),false);f.dispose();groups++;
}
{
  const f=setup();f.emit('voice:move:prepare',f.request);await tick();
  f.emit('voice:move:result',{v:1,generation:'old',requestId:f.request.requestId,sourceChannelId:'source',destinationChannelId:'destination',status:'committed',invalidated:true});
  assert.equal(f.authority.stagingSupported,true);assert.equal(f.calls.some(([event])=>event==='commit'),false);
  f.emit('voice:move:result',{v:1,generation:'session',requestId:f.request.requestId,sourceChannelId:'source',destinationChannelId:'destination',status:'aborted'});
  await tick();assert.equal(f.calls.some(([event])=>event==='abort'),true);f.dispose();groups++;
}
console.log(`${groups} actual client target-hook handler fixture groups passed; SDK functions/socket/auth are synthetic, no full SDK/server media acceptance`);
