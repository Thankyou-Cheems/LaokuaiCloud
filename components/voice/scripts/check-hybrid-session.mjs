import assert from 'node:assert/strict';import net from 'node:net';import dgram from 'node:dgram';
net.Server.prototype.listen=net.Socket.prototype.connect=dgram.createSocket=()=>{throw Error('network_prohibited_in_unit')};globalThis.fetch=()=>{throw Error('network_prohibited_in_unit')};
globalThis.RTCPeerConnection=class{constructor(){throw Error('actual_peer_construction_prohibited')}};
const {BrowserHybridVoiceSession}=await import('../dist/webrtc/hybrid/BrowserHybridVoiceSession.js');
const {HybridRouteController}=await import('../dist/webrtc/hybrid/HybridRouteController.js');
const original=HybridRouteController.prototype.reconcile;let peers=0,stops=0,assertions=0;
const eq=(a,b)=>{assert.deepEqual(a,b);assertions++};const settle=async()=>{for(let n=0;n<200;n++)await Promise.resolve()};
const track=id=>({id,kind:'audio',enabled:true,readyState:'live',stop(){stops++}}),stream=t=>({getAudioTracks:()=>[t],getTracks:()=>[t]});
const final=track('stable-final'),finalStream=stream(final),sf=track('sfu'),remote=track('peer'),edges=new Set();
const context={createMediaStreamSource:()=>new Node()};class Node{context=context;connect(to){edges.add(this);return to}disconnect(){edges.delete(this)}}
const sourceNode=new Node();sourceNode.mediaStream=stream(sf);const analyser=new Node();sourceNode.connect(analyser);
let retirement;const source={stream:sourceNode,analyser,receiveCleanup:{isCurrent:()=>true,subscribeRetirement(fn){retirement=fn;return()=>retirement=undefined}}};
let count=0;const pc={connectionState:'connected',getSenders:()=>[{track:final}],getStats:async()=>new Map([['in',{type:'inbound-rtp',kind:'audio',trackIdentifier:sf.id,packetsReceived:++count,totalSamplesReceived:count*480}]])};
const microphone={microphoneBuffer:{publicationStream:finalStream},transmissionState:{publicationAcknowledged:true,publicationRevision:1,generation:1}};
let scope={serverInstanceId:'instance',roomId:'room',roomGeneration:'epoch',localParticipantId:'local',localSessionId:'socket',canPublish:true,canReceive:true};
const participant={participantId:'remote',sessionId:'remote-socket',publicationId:'actual-publication',canSendAudio:true,canReceiveAudio:true};
const listeners=new Map(),commands=[];
const socket={id:'socket',connected:true,on(e,f){const set=listeners.get(e)??new Set();set.add(f);listeners.set(e,set)},off(e,f){listeners.get(e)?.delete(f)},emit(e){for(const f of listeners.get(e)??[])f()},timeout(){return{emitWithAck:async(event,p)=>{commands.push({event,p});if(event==='voice:hybrid:scope')return{v:1,status:'supported',capabilities:{protocolVersion:1,authenticatedRoomSignals:true,pairForwardingLeases:true},scope,participants:[participant]};if(event==='voice:hybrid:lease')return{v:1,status:'leased',lease:{connectionId:'actual-server-pair',scope,remoteSessionId:participant.sessionId,initiator:true}};if(event==='voice:hybrid:forwarding')return{v:1,status:'applied',ack:{...p.request,applied:true,leaseRemainingMs:p.request.enabled?0:10000}};return{v:1,status:'released'}}}}};
// Only the external peer adapter is replaced. Auth lifecycle/controller/selector/monitor are the real implementation.
HybridRouteController.prototype.reconcile=function(scope,participants){this.dependencies.createPeer=args=>{peers++;eq(args.publication.track,final);eq(args.publication.stream,finalStream);let disposed=false;return{start:async()=>{},acceptSignal:async()=>{},waitForMedia:async()=>({track:remote,stream:stream(remote),decodedFrames:1,mediaSequence:1,observedAtMs:performance.now()}),isReceiving:()=>!disposed,dispose:()=>disposed=true,readMetrics:async()=>{throw Error('unused')}}};return original.call(this,scope,participants)};
const selections=[];const options={socket,getAccessToken:()=> 'synthetic-only',expectedRoomId:'room',rtcConfiguration:{iceServers:[]},microphoneCodec:{codec:'opus',channels:1,maxBitrateBps:24000,packetTimeMs:20,vbr:true,dtx:true,fec:true},getPeerConnection:()=>pc,getMicrophone:()=>microphone,isCurrent:()=>true,getSource:()=>source,onSelection:(_,t)=>selections.push(t)};
try{
 const disabled=new BrowserHybridVoiceSession(options);await disabled.update();eq(disabled.getState().status,'disabled');eq(commands.length,0);disabled.dispose();eq(edges.size,1);
 const session=new BrowserHybridVoiceSession({...options,enabled:true,allowNetwork:true});await session.update();await settle();eq(peers,1);eq(edges.size,1);eq(selections.at(-1),remote);eq(session.getState().routing.routes[0].selected,'p2p');
 for(const generation of [2,3,4]){microphone.transmissionState={publicationAcknowledged:false,publicationRevision:generation,generation};await session.update();await settle()};eq(peers,1);eq(selections.at(-1),remote);
 socket.emit('token:revoked');await settle();eq(selections.at(-1),null);eq(edges.size,0);eq(session.getState().status,'recovering');
 scope={...scope,canPublish:false};const recovery=session.update();await settle();eq(edges.size,0);
 const port=[...session.ports.values()][0].port;eq(port.getSelectionRevision()>0,true);
 await session.monitor.read();await recovery;eq(edges.size,1);eq(selections.at(-1),sf);eq(peers,1);
 eq(commands.filter(c=>c.event==='voice:hybrid:forwarding').at(-1).p.request.enabled,true);
 await session.setEnabled(false);eq(session.getState().status,'disabled');eq(edges.size,1);eq(retirement,undefined);
 session.dispose();eq(edges.size,1);eq([...listeners.values()].reduce((n,s)=>n+s.size,0),0);eq(stops,0);
}finally{HybridRouteController.prototype.reconcile=original}
console.log(JSON.stringify({result:'pass',kind:'host-session-simulation',assertions,simulatedPeers:peers,actualPeerConnections:0,realAuthentication:false,actualSfuGate:false,realCapture:false},null,2));
