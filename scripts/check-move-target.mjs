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
const loadHook=new Function('deps',`const {useSFU,useMicrophone,useSockets,useRef,useEffect,useState,createElement,VoiceMoveRecoveryNotice,toast,i18n,readMovePrepare,emitAuthenticated}=deps;
  const Date=deps.clock??globalThis.Date;
  ${hookSource};return useVoiceMoves;`);
const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
const policy={requirePTT:true,disableRNNoise:true,maxBitrate:64000,eSportsMode:false,speak:true,shareVideo:false,shareScreen:false,isMuted:false,isDeafened:false};
let groups=0;
function setup({supported=true,boundary=true,prepareError=false,policyAck=true,commitRecovery=false}={}) {
  const listeners=new Map(),sent=[],calls=[],errors=[];let binding;
  const refs=[],effects=[],states=[];let refIndex=0,effectIndex=0,stateIndex=0;
  let timeOffset=0;
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
  const sfu={currentServerConnected:'host',currentChannelConnected:'source',isConnected:false,connectionError:null,
    async prepareMove(request){calls.push(['prepare',request]);if(prepareError)throw Error('injected_prepare_failure');return {requestId:request.requestId,streamId:'staged-msid'}},
    async commitMove(id){calls.push(['commit',id]);assert.ok(binding,'policy installed before promotion');await authority.confirmCommit(id);sfu.currentChannelConnected='destination';evidence.channel='destination';
      if(commitRecovery){sfu.connectionError='destination_recovery_required';throw Object.assign(new Error('destination recovery required'),{code:'destination_recovery_required'})}sfu.isConnected=true},
    async abortMove(id){calls.push(['abort',id])},
    async resumeMoveTransmission(id){calls.push(['resume',id]);assert.equal(authority.isDestinationPolicyApplied(id,{requirePushToTalk:true,disableRnnoise:true,maxBitrate:64000,eSportsMode:false}),true)}
  };
  const hook=loadHook({useSFU:()=>sfu,useMicrophone:()=>({transmissionState:ack}),useSockets:()=>({sockets:{host:socket}}),
    clock:{now:()=>Date.now()+timeOffset},
    VoiceMoveRecoveryNotice:'actual-notice-component',createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:initial=>{
      const index=stateIndex++;if(!(index in states))states[index]=initial;
      return [states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;queueMicrotask(render)}];
    },
    useRef:current=>{const index=refIndex++;return refs[index]??(refs[index]={current})},useEffect:(effect,deps)=>{
      const index=effectIndex++,previous=effects[index];
      if(previous && deps.every((value,i)=>Object.is(value,previous.deps[i])))return;
      previous?.cleanup?.();effects[index]={deps,cleanup:effect()};
    },toast:{error:message=>errors.push(message)},i18n:{t:key=>key},
    readMovePrepare,emitAuthenticated:send});
  const apply=value=>{
    binding=value;if(!value)return;
    evidence.config.audio.inputMode='push_to_talk';evidence.config.audio.noiseSuppression=false;
    ack.publicationAcknowledged=false;
    if(policyAck)queueMicrotask(()=>{ack.publicationAcknowledged=true;ack.publicationBlocked=true;ack.publicationRevision++});
  };
  const render=()=>{refIndex=0;effectIndex=0;stateIndex=0;hook({host:authority},apply)};render();
  const request={v:1,generation:'session',requestId:'11111111-1111-1111-1111-111111111111',sourceChannelId:'source',
    destinationChannelId:'destination',joinToken:{move_id:'11111111-1111-1111-1111-111111111111'},sfuUrls:['ws://127.0.0.1:9999'],
    expiresAt:Date.now()+30000,channelSettings:policy};
  const result=()=>emit('voice:move:result',{v:1,generation:'session',requestId:request.requestId,sourceChannelId:'source',destinationChannelId:'destination',status:'committed'});
  return {socket,authority,sfu,ack,evidence,calls,sent,errors,emit,request,result,changePolicy:value=>{replyPolicy=value},
    render,advanceTime:ms=>{timeOffset+=ms},allowAck:value=>{policyAck=value},dispose(){for(const effect of effects)effect.cleanup?.();authority.dispose()},
    get binding(){return binding},listenerCount:()=>[...listeners.values()].reduce((sum,set)=>sum+set.size,0)};
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
  const f=setup({commitRecovery:true});f.emit('voice:move:prepare',f.request);await tick();f.result();await tick();
  assert.equal(f.sfu.currentChannelConnected,'destination','committed failure never reports source retained');
  assert.ok(f.binding,'destination recovery retains authoritative policy');
  assert.equal(f.calls.some(([event])=>event==='resume'),false,'failed PC is not resumed');
  assert.deepEqual(f.errors,['pureVoice.moveRecovery']);
  assert.equal(f.authority.isDestinationPolicyApplied(f.request.requestId,{requirePushToTalk:true,disableRnnoise:true,maxBitrate:64000,eSportsMode:false}),true,
    'explicit destination connect passes policy barrier only after current closed ACK');
  f.ack.publicationAcknowledged=false;
  assert.equal(f.authority.isDestinationPolicyApplied(f.request.requestId,{requirePushToTalk:true,disableRnnoise:true,maxBitrate:64000,eSportsMode:false}),false);
  f.dispose();groups++;
}
{
  const f=setup({commitRecovery:true,policyAck:false});f.emit('voice:move:prepare',f.request);await tick();f.result();await tick();
  assert.ok(f.binding);assert.equal(f.calls.some(([event])=>event==='resume'),false);
  assert.equal(f.authority.isDestinationPolicyApplied(f.request.requestId,{requirePushToTalk:true,disableRnnoise:true,maxBitrate:64000,eSportsMode:false}),false);
  f.socket.connected=false;f.emit('disconnect');await tick();f.dispose();groups++;
}
{
  const f=setup();f.emit('voice:move:prepare',f.request);await tick();f.result();await tick();assert.equal(f.binding,undefined);
  f.render();f.sfu.isConnected=false;f.sfu.connectionError='destination_recovery_required';
  f.ack.publicationAcknowledged=false;f.render();await tick();
  assert.ok(f.binding,'later promoted destination failure rebinds freshly queried policy');
  assert.equal(f.authority.isDestinationPolicyApplied(f.request.requestId,{requirePushToTalk:true,disableRnnoise:true,maxBitrate:64000,eSportsMode:false}),true);
  assert.deepEqual(f.errors,['pureVoice.moveRecovery']);
  assert.equal(f.calls.filter(([event])=>event==='resume').length,1,'no replay of original resume against failed media');
  f.sfu.connectionError=null;f.sfu.isConnected=true;f.ack.publicationBlocked=false;f.render();
  assert.equal(f.binding,undefined,'successful explicit recovery clears temporary controls');
  f.dispose();assert.equal(f.listenerCount(),0);groups++;
}
{
  const f=setup();f.emit('voice:move:prepare',f.request);await tick();f.result();await tick();f.render();
  const confirm=f.authority.confirmCommit;let rejected=false;
  f.authority.confirmCommit=id=>{if(!rejected){rejected=true;return Promise.reject(Error('authority_query_timeout'))}return confirm(id)};
  f.sfu.isConnected=false;f.sfu.connectionError='destination_recovery_required';f.render();await tick();
  assert.equal(f.binding,undefined);const retry=f.errors.at(-1);
  assert.equal(retry.type,'actual-notice-component');retry.props.onRetry();await tick();
  assert.ok(f.binding,'explicit retry reacquires policy after transient query failure');
  assert.equal(f.errors.at(-1),'pureVoice.moveRecovery');
  f.dispose();groups++;
}
{
  const f=setup({policyAck:false});f.emit('voice:move:prepare',f.request);await tick();f.result();await tick();
  assert.equal(f.sfu.isConnected,true);assert.ok(f.binding);f.render();
  f.advanceTime(9000);await tick();const retry=f.errors.at(-1);
  f.allowAck(true);retry.props.onRetry();await tick();
  assert.equal(f.calls.filter(([event])=>event==='resume').length,1,'healthy destination policy timeout retries protected resume');
  assert.equal(f.binding,undefined);f.render();await tick();
  assert.equal(f.calls.filter(([event])=>event==='resume').length,1,'no duplicate resume on later render');
  f.dispose();groups++;
}
{
  const f=setup();f.emit('voice:move:prepare',f.request);await tick();
  f.emit('voice:move:result',{v:1,generation:'old',requestId:f.request.requestId,sourceChannelId:'source',destinationChannelId:'destination',status:'committed',invalidated:true});
  assert.equal(f.authority.stagingSupported,true);assert.equal(f.calls.some(([event])=>event==='commit'),false);
  f.emit('voice:move:result',{v:1,generation:'session',requestId:f.request.requestId,sourceChannelId:'source',destinationChannelId:'destination',status:'aborted'});
  await tick();assert.equal(f.calls.some(([event])=>event==='abort'),true);f.dispose();groups++;
}
console.log(`${groups} actual client target-hook handler fixture groups passed; SDK functions/socket/auth are synthetic, no full SDK/server media acceptance`);
