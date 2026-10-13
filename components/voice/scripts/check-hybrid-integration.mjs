import assert from 'node:assert/strict';
import net from 'node:net';import dgram from 'node:dgram';
net.Server.prototype.listen=net.Socket.prototype.connect=dgram.createSocket=()=>{throw Error('network_prohibited_in_unit')};
globalThis.fetch=()=>{throw Error('network_prohibited_in_unit')};
const {HybridRouteController}=await import(process.env.HYBRID_CONTROLLER_URL??'../dist/webrtc/hybrid/HybridRouteController.js');
const {HybridReceivePortAdapter}=await import('../dist/webrtc/hybrid/HybridReceivePortAdapter.js');
const {SocketHybridAuthority}=await import('../dist/webrtc/hybrid/SocketHybridAuthority.js');
let assertions=0;const eq=(a,b)=>{assert.deepEqual(a,b);assertions++};
const settle=async()=>{for(let n=0;n<150;n++)await Promise.resolve()};
class Clock{time=0;id=0;jobs=new Map();now=()=>this.time;schedule=(callback,delay)=>{const id=++this.id;this.jobs.set(id,{callback,at:this.time+delay});return id};cancel=id=>this.jobs.delete(id);async advance(ms){const end=this.time+ms;await settle();for(let n=0;n<5000;n++){const job=[...this.jobs].sort((a,b)=>a[1].at-b[1].at)[0];if(!job||job[1].at>end){this.time=end;await settle();return;}this.time=job[1].at;this.jobs.delete(job[0]);job[1].callback();await settle()}throw Error('timer_loop')}}
const track=id=>({id,kind:'audio',readyState:'live',enabled:true});const stream=track=>({getAudioTracks:()=>[track],getTracks:()=>[track]});
const clock=new Clock(),pairs=new Map(),controllers=[],ports=[],allPeers=[];
const media=(t,seq)=>({
 track:t,stream:stream(t),decodedFrames:10,mediaSequence:seq,observedAtMs:clock.now(),
 getReceiveObservation:()=>{
  const at=clock.now(),underlay={classification:'not-easytier',source:'host-underlay-resolver',observedAtMs:at},transportPath={source:'rtc-selected-candidate-pair',observedAtMs:at,classification:'non-turn-candidate',reason:'selected-pair',pairId:`pair-${t.id}`,local:null,remote:null,underlay};
  return {trackId:t.id,observedAtMs:at,reason:null,decode:{startAtMs:Math.max(0,at-20),endAtMs:at,packetsDelta:1,samplesDelta:480,decodedFramesDelta:480,fresh:true,source:'rtc-inbound-rtp-totalSamplesReceived'},metrics:{selectedPairId:transportPath.pairId,rttMs:null,rttWindow:null,rttSource:'rtc-selected-candidate-pair',lossFraction:null,lossWindow:null,lossSource:'exact-audio-track-inbound-rtp',path:{classification:'non-turn-candidate',pairId:transportPath.pairId,localCandidateType:null,remoteCandidateType:null,underlay:'not-easytier'}},transportPath};
 }
});
const member=n=>({participantId:'p'+n,sessionId:'s'+n,publicationId:'pub'+n,canSendAudio:true,canReceiveAudio:true});
for(let n=0;n<5;n++){
 const scope={serverInstanceId:'instance',roomId:'room',roomGeneration:'epoch',localParticipantId:'p'+n,localSessionId:'s'+n,canPublish:true,canReceive:true};
 const t=track('final'+n),publication={track:t,stream:stream(t),generation:1,publicationRevision:1,publicationAcknowledged:true},localPorts=new Map();ports.push(localPorts);
 const authority={environment:'simulation',capabilities:{protocolVersion:1,authenticatedRoomSignals:true,pairForwardingLeases:true},isCurrent:()=>true,
   leasePair:async(scope,p)=>({scope,remoteSessionId:p.sessionId,connectionId:[scope.localSessionId,p.sessionId].sort().join('/'),initiator:scope.localSessionId<p.sessionId}),
   relay:async()=>{},setForwarding:async request=>({...request,applied:true,leaseRemainingMs:request.enabled?0:10000}),releasePair(){},subscribeSignals:()=>()=>{},subscribeInvalidation:()=>()=>{}};
 const controller=new HybridRouteController({clock,authority,getPublication:()=>publication,getReceivePort:p=>{let port=localPorts.get(p.sessionId);if(!port){const t=track('sfu'+n+p.sessionId);port={isCurrent:()=>true,selected:'sfu',getSfuMediaSequence:()=>1,waitForSfuMedia:async()=>media(t,2),select(kind){this.selected=kind}};localPorts.set(p.sessionId,port)}return port},
 createPeer:args=>{const t=track('peer'+n+args.participant.sessionId),key=args.lease.connectionId;let pair=pairs.get(key);if(!pair){pair=[];pairs.set(key,pair)}let resolve;const waiting=new Promise(r=>resolve=r);const peer={disposed:false,start:async()=>{},acceptSignal:async()=>{},waitForMedia:()=>waiting,isReceiving:()=>!peer.disposed,dispose(){this.disposed=true},readMetrics:async()=>{throw Error('unused')},resolve:()=>resolve(media(t,1))};pair.push(peer);allPeers.push(peer);if(pair.length===2)for(const p of pair)p.resolve();return peer}}, {enabled:true,maxConcurrentProbes:2,pathStableMs:0});
 controllers.push(controller);controller.reconcile(scope,[1,2,3,4].map(offset=>member((n+offset)%5)));
}
await clock.advance(1000);
const selected=ports.reduce((sum,ps)=>sum+[...ps.values()].filter(p=>p.selected==='p2p').length,0);
if(process.env.EXPECT_BASELINE_STALL){eq(selected,0)}else{eq(selected,20);for(const c of controllers)eq(c.getState().concurrentProbes,0)}
for(const c of controllers)c.dispose();eq(clock.jobs.size,0);

const context={createMediaStreamSource:()=>new Node()},edges=new Set();
class Node{context=context;connect(to){edges.add(this);return to}disconnect(){edges.delete(this)}}
const sf=track('sfu-real-object'),peerTrack=track('peer-real-object'),sourceNode=new Node();sourceNode.mediaStream=stream(sf);
const analyser=new Node();sourceNode.connect(analyser);let current=true,retirement;const events=[];
const control={isCurrent:()=>current,subscribeRetirement(fn){retirement=fn;return()=>{retirement=undefined}}};
let freshResolve;const evidence={getSequence:()=>7,waitForFresh:after=>{events.push('fresh:'+after);return new Promise(r=>freshResolve=r)},dispose(){events.push('evidence-disposed')}};
const adapter=new HybridReceivePortAdapter({source:{stream:sourceNode,analyser,receiveCleanup:control},monitor:{bind:()=>evidence},isCurrent:()=>current,onSelection:(kind,t)=>events.push([kind,t])});
adapter.select('p2p',{track:peerTrack,stream:stream(peerTrack)},1);eq(edges.size,1);eq(events.at(-1),['p2p',peerTrack]);
adapter.select('none',undefined,2);eq(edges.size,0);
let ackResolve;const restore=adapter.restoreSfu(()=>new Promise(r=>ackResolve=r));await settle();eq(edges.size,0);eq(events.some(e=>typeof e==='string'&&e.startsWith('fresh:')),false);
events.push('ack');ackResolve();await settle();eq(events.at(-1),'fresh:7');eq(edges.size,0);
freshResolve({track:sf,stream:stream(sf),mediaSequence:8,decodedFrames:1,observedAtMs:0});await restore;eq(edges.size,1);eq(events.at(-1),['sfu',sf]);
adapter.releaseRestored();eq(edges.size,1);eq(retirement,undefined);
const adapter2=new HybridReceivePortAdapter({source:{stream:sourceNode,analyser,receiveCleanup:control},monitor:{bind:()=>evidence},isCurrent:()=>current});
adapter2.select('p2p',{track:peerTrack,stream:stream(peerTrack)},1);retirement();current=false;eq(edges.size,0);eq(adapter2.isCurrent(),false);

const original={serverInstanceId:'instance',roomId:'room',roomGeneration:'epoch',localParticipantId:'p',localSessionId:'socket',canPublish:true,canReceive:true};
const listeners=new Map(),requests=[];
const socket={id:'socket',connected:true,on:(e,f)=>listeners.set(e,f),off:(e)=>listeners.delete(e),timeout:()=>({emitWithAck:async(event,payload)=>{requests.push(event);return event==='voice:hybrid:scope'?{v:1,status:'supported',capabilities:{protocolVersion:1,authenticatedRoomSignals:true,pairForwardingLeases:true},scope:{...original,canPublish:false},participants:[]}:{v:1,status:'applied',ack:{...payload.request,applied:true,leaseRemainingMs:0}}}})};
const authority=new SocketHybridAuthority(socket,()=> 'test-only');
await authority.restoreForwarding({scope:original,pairConnectionId:null,sourceParticipantId:'remote',sourceSessionId:'remote-session',sourcePublicationId:'remote-mic',destinationSessionId:'socket',routeGeneration:2,operationId:'2:1',enabled:true,pauseLeaseMs:0});
eq(requests,['voice:hybrid:scope','voice:hybrid:forwarding']);eq(authority.isCurrent({...original,canPublish:false}),true);authority.dispose();eq(listeners.size,0);
console.log(JSON.stringify({kind:'pure-simulation',result:'pass',assertions,fiveControllerSelectedDirections:selected,actualPeerConnections:0,networkListeners:0,realCapture:false,actualForwardingAck:false},null,2));
