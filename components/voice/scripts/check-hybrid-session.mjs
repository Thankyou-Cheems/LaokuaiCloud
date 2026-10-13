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
const peerMedia=()=>{const at=performance.now(),underlay={classification:'not-easytier',source:'host-underlay-resolver',observedAtMs:at},transportPath={source:'rtc-selected-candidate-pair',observedAtMs:at,classification:'non-turn-candidate',reason:'selected-pair',pairId:'pair-peer',local:null,remote:null,underlay};return{track:remote,stream:stream(remote),decodedFrames:1,mediaSequence:1,observedAtMs:at,getReceiveObservation:()=>({trackId:remote.id,observedAtMs:at,reason:null,decode:{startAtMs:at-20,endAtMs:at,packetsDelta:1,samplesDelta:480,decodedFramesDelta:480,fresh:true,source:'rtc-inbound-rtp-totalSamplesReceived'},metrics:{selectedPairId:'pair-peer',rttMs:null,rttWindow:null,rttSource:'rtc-selected-candidate-pair',lossFraction:null,lossWindow:null,lossSource:'exact-audio-track-inbound-rtp',path:{classification:'non-turn-candidate',pairId:'pair-peer',localCandidateType:null,remoteCandidateType:null,underlay:'not-easytier'}},transportPath})};};
HybridRouteController.prototype.reconcile=function(scope,participants){this.dependencies.createPeer=args=>{peers++;eq(args.publication.track,final);eq(args.publication.stream,finalStream);let disposed=false;return{start:async()=>{},acceptSignal:async()=>{},waitForMedia:async()=>peerMedia(),isReceiving:()=>!disposed,dispose:()=>disposed=true,readMetrics:async()=>{throw Error('unused')}}};return original.call(this,scope,participants)};
const selections=[],diagnostics=[];const options={socket,getAccessToken:()=> 'synthetic-only',expectedRoomId:'room',rtcConfiguration:{iceServers:[]},microphoneCodec:{codec:'opus',channels:1,maxBitrateBps:24000,packetTimeMs:20,vbr:true,dtx:true,fec:true},pathStableMs:0,getPeerConnection:()=>pc,getMicrophone:()=>microphone,isCurrent:()=>true,getSource:()=>source,onSelection:(_,t)=>selections.push(t),onDiagnostic:event=>diagnostics.push(event)};
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
 eq(diagnostics.some(event=>event.kind==='forwarding'&&event.action==='pause'&&event.result==='acknowledged'&&event.reason==='validated_ack'),true);
 eq(diagnostics.some(event=>event.kind==='forwarding'&&event.action==='restore'&&event.result==='acknowledged'&&event.reason==='validated_ack'),true);
 eq(/actual-server-pair|socket|publication|synthetic-only|pair-peer/.test(JSON.stringify(diagnostics)),false);
 // Replacing a same-PC owner restores an old paused SFU input even with probing disabled or publish permission lost.
 for(const receiveOnly of [false,true]){
  scope={...scope,canPublish:true};
  const active=new BrowserHybridVoiceSession({...options,enabled:true,allowNetwork:true});await active.update();await settle();
  eq(active.getState().routing.routes[0].selected,'p2p');active.dispose();eq(edges.size,0);
  if(receiveOnly)scope={...scope,canPublish:false};
  const replacement=new BrowserHybridVoiceSession({...options,enabled:receiveOnly,allowNetwork:receiveOnly});
  const releaseBefore=commands.filter(c=>c.event==='voice:hybrid:release').length;
  const recovery=replacement.update();await settle();eq(edges.size,0);await replacement.monitor.read();await recovery;
  eq(edges.size,1);eq(selections.at(-1),sf);eq(replacement.getState().status,receiveOnly?'active':'disabled');
  eq(commands.filter(c=>c.event==='voice:hybrid:release').length>releaseBefore,true);
  replacement.dispose();eq(edges.size,1);
 }
 // ACK success followed by fresh-media failure must consume a new operation on retry.
 scope={...scope,canPublish:true};
 const retrySource=new BrowserHybridVoiceSession({...options,enabled:true,allowNetwork:true});await retrySource.update();await settle();retrySource.dispose();eq(edges.size,0);
 const retry=new BrowserHybridVoiceSession(options),getPort=retry.getPort.bind(retry);let failedFresh=false;
 retry.getPort=participant=>{const port=getPort(participant);if(port&&!port.testFreshFailure){const wait=port.waitForSfuMedia.bind(port);port.testFreshFailure=true;port.waitForSfuMedia=after=>{if(!failedFresh){failedFresh=true;return Promise.reject(Error('fresh_sfu_media_unavailable'))}return wait(after)}}return port};
 await retry.update();eq(edges.size,0);const firstRequest=commands.filter(c=>c.event==='voice:hybrid:forwarding'&&c.p.request.enabled).at(-1).p.request;
 const retryFlight=retry.update();await settle();const secondRequest=commands.filter(c=>c.event==='voice:hybrid:forwarding'&&c.p.request.enabled).at(-1).p.request;
 eq(secondRequest.routeGeneration>firstRequest.routeGeneration,true);eq(secondRequest.operationId!==firstRequest.operationId,true);
 await retry.monitor.read();await retryFlight;eq(edges.size,1);retry.dispose();
 // Remote roster/source may arrive later while the replacement has P2P disabled.
 scope={...scope,canPublish:true};
 const delayedSource=new BrowserHybridVoiceSession({...options,enabled:true,allowNetwork:true});await delayedSource.update();await settle();delayedSource.dispose();eq(edges.size,0);
 let sourceReady=false;const delayed=new BrowserHybridVoiceSession({...options,getSource:()=>sourceReady?source:null});
 await delayed.update();eq(delayed.getState().status,'recovering');eq(edges.size,0);sourceReady=true;
 const delayedFlight=delayed.update();await settle();await delayed.monitor.read();await delayedFlight;
 eq(edges.size,1);eq(delayed.getState().status,'disabled');delayed.dispose();
 // Re-enabling after failed orderly shutdown must finish restoration before replacing its controller.
 scope={...scope,canPublish:true};
 const toggled=new BrowserHybridVoiceSession({...options,enabled:true,allowNetwork:true});await toggled.update();await settle();
 const stoppingController=toggled.controller,forward=toggled.authority.setForwarding.bind(toggled.authority);let failRestore=true;
 toggled.authority.setForwarding=request=>request.enabled&&failRestore?Promise.reject(Error('hybrid_sfu_ack_failed')):forward(request);
 await toggled.setEnabled(false);eq(toggled.getState().status,'recovering');eq(stoppingController.stopping,true);
 failRestore=false;const reenable=toggled.setEnabled(true);await settle();
 eq(toggled.controller,stoppingController);eq(edges.size,1);
 await toggled.monitor.read();await reenable;await settle();
 eq(toggled.controller===stoppingController,false);eq(stoppingController.disposed,true);
 eq(toggled.controller.stopping,false);eq(toggled.controller.getState().probeAdmissionAllowed,true);eq(edges.size,1);
 eq(toggled.getState().routing.routes[0].selected,'p2p');
 eq([...toggled.controller.routes.values()][0].pathMonitor!==undefined,true);
 const finalDisable=toggled.setEnabled(false);await settle();await toggled.monitor.read();await finalDisable;
 eq(toggled.getState().status,'disabled');toggled.dispose();eq(edges.size,1);
 // An old-room pause obligation never becomes authority to restore a different room.
 scope={...scope,canPublish:true};
 const oldRoom=new BrowserHybridVoiceSession({...options,enabled:true,allowNetwork:true});await oldRoom.update();await settle();oldRoom.dispose();eq(edges.size,0);
 const restoreCount=commands.filter(c=>c.event==='voice:hybrid:forwarding').length;
 scope={...scope,roomId:'different-room'};
 const otherRoom=new BrowserHybridVoiceSession({...options,expectedRoomId:'different-room'});await otherRoom.update();
 eq(edges.size,0);eq(commands.filter(c=>c.event==='voice:hybrid:forwarding').length,restoreCount);otherRoom.dispose();
}finally{HybridRouteController.prototype.reconcile=original}
console.log(JSON.stringify({result:'pass',kind:'host-session-simulation',assertions,simulatedPeers:peers,actualPeerConnections:0,realAuthentication:false,actualSfuGate:false,realCapture:false},null,2));
