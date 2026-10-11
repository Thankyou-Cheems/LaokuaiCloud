import assert from 'node:assert/strict';import net from 'node:net';import dgram from 'node:dgram';
net.Server.prototype.listen=net.Socket.prototype.connect=dgram.createSocket=()=>{throw Error('network_prohibited_in_unit')};globalThis.fetch=()=>{throw Error('network_prohibited_in_unit')};
globalThis.WebSocket=class{static OPEN=1;static CONNECTING=0;constructor(){throw Error('actual_websocket_prohibited')}};
globalThis.RTCPeerConnection=class{constructor(){throw Error('actual_peer_prohibited')}};
const {performSfuCleanup,performUnmountCleanup}=await import(process.env.CLEANUP_MODULE_URL??'../dist/webrtc/hooks/sfuCleanup.js');
const {voiceLog}=await import('../dist/webrtc/hooks/voiceLogger.js');
const {HybridRouteController}=await import('../dist/webrtc/hybrid/HybridRouteController.js');
const {HybridReceivePortAdapter}=await import('../dist/webrtc/hybrid/HybridReceivePortAdapter.js');
const original={...voiceLog},errors=[];for(const key of Object.keys(voiceLog))voiceLog[key]=(...args)=>{if(key==='fail')errors.push(args)};
let assertions=0;const eq=(a,b)=>{assert.deepEqual(a,b);assertions++};const ref=current=>({current});
const pcHandlers=['onicecandidate','oniceconnectionstatechange','onicegatheringstatechange','onsignalingstatechange','ontrack','onconnectionstatechange','ondatachannel'];
const wsHandlers=['onopen','onmessage','onclose','onerror'];
const track=id=>({id,kind:'audio',readyState:'live',enabled:true,stops:0,stop(){this.stops++;this.readyState='ended'}}),stream=t=>({getTracks:()=>[t],getAudioTracks:()=>[t]});
try{
 for(const kind of ['closed','stable','remove-error','no-pc','in-progress']){
  const events=[],local=track('final-local'),remote=track('remote-sfu'),localStream=stream(local);let removes=0,pcCloses=0,wsCloses=0,hybridCloses=0,alive=true,retire;
  const pc=kind==='no-pc'?null:{signalingState:'stable',connectionState:'connected',
   removeTrack(){removes++;if(kind==='remove-error')throw Error('synthetic_remove_failure');if(this.signalingState==='closed')throw Error('synthetic_invalid_state')},close(){pcCloses++;this.connectionState='closed';this.signalingState='closed'}};
  if(pc)for(const key of pcHandlers)pc[key]=()=>{};
  const ws={readyState:1,close(){wsCloses++}};for(const key of wsHandlers)ws[key]=()=>{};
  const reconnect=setTimeout(()=>{throw Error('reconnect_timer_not_cleared')},10000),timeout=setTimeout(()=>{throw Error('connection_timer_not_cleared')},10000);
  const refs={peerConnectionRef:ref(pc),sfuWebSocketRef:ref(ws),registeredTracksRef:ref([{track:local},{track:null}]),reconnectAttemptRef:ref(reconnect),connectionTimeoutRef:ref(timeout),isDisconnectingRef:ref(kind==='in-progress'),isConnectingRef:ref(true),previousRemoteStreamsRef:ref(new Set(['remote'])),announcedStreamIdRef:ref('pub')};
  const context={createMediaStreamSource:()=>new Node()},edges=new Set();class Node{context=context;connect(to){edges.add(this);return to}disconnect(){edges.delete(this);events.push('disconnect')}}
  const input=new Node();input.mediaStream=stream(remote);const analyser=new Node();input.connect(analyser);let controller;
  const control={isCurrent:()=>alive,subscribeRetirement(fn){retire=fn;return()=>retire=undefined},dispose(){events.push('receive-dispose');retire?.();alive=false}};
  const source={stream:input,analyser,gain:new Node(),receiveCleanup:control,audioElement:{srcObject:stream(remote),pause(){events.push('decoder-pause')},remove(){events.push('decoder-remove')}}};
  if(kind==='closed'){
   const port=new HybridReceivePortAdapter({source,monitor:{bind:()=>({getSequence:()=>1,waitForFresh:async()=>{throw Error('stale_route_must_not_restore')},dispose(){}})},isCurrent:()=>alive,onRetired:()=>controller.retireReceivePort(port)});
   const scope={serverInstanceId:'instance',roomId:'room',roomGeneration:'epoch',localParticipantId:'local',localSessionId:'socket',canPublish:true,canReceive:true},participant={participantId:'remote',sessionId:'other-socket',publicationId:'actual-mic',canSendAudio:true,canReceiveAudio:true};
   const authority={environment:'simulation',capabilities:{protocolVersion:1,authenticatedRoomSignals:true,pairForwardingLeases:true},isCurrent:()=>true,leasePair:async()=>({scope,connectionId:'pair',remoteSessionId:participant.sessionId,initiator:true}),setForwarding:async request=>({...request,applied:true,leaseRemainingMs:request.enabled?0:10000}),relay:async()=>{},releasePair(){},subscribeSignals:()=>()=>{},subscribeInvalidation:()=>()=>{}};
   const peerTrack=track('hybrid-remote');controller=new HybridRouteController({authority,getPublication:()=>({stream:localStream,track:local,generation:1,publicationRevision:1,publicationAcknowledged:true}),getReceivePort:()=>port,createPeer:()=>({start:async()=>{},acceptSignal:async()=>{},waitForMedia:async()=>({stream:stream(peerTrack),track:peerTrack,decodedFrames:1,mediaSequence:1,observedAtMs:performance.now()}),isReceiving:()=>true,readMetrics:async()=>{throw Error('unused')},dispose(){hybridCloses++;events.push('hybrid-close')}})},{enabled:true});
   controller.reconcile(scope,[participant]);for(let n=0;n<200;n++)await Promise.resolve();eq(controller.getState().routes[0].selected,'p2p');eq(edges.size,1);
  }
  if(kind==='closed'){pc.signalingState='closed';pc.connectionState='closed';}
  let sources={mic:source},streams={local:{stream:localStream,isLocal:true},remote:{stream:stream(remote),isLocal:false}};
  const deps={room:{announceJoined:value=>events.push('announce:'+value),setLocalStream:value=>events.push('local:'+value),leave:()=>events.push('leave')},setStreamSources:update=>sources=update(sources),setStreams:update=>streams=update(streams)};
  const beforeErrors=errors.length;await performSfuCleanup(refs,deps);
  if(kind==='in-progress'){eq(removes,0);eq(refs.peerConnectionRef.current,pc);eq(Object.keys(sources),['mic']);eq(events,[]);clearTimeout(reconnect);clearTimeout(timeout);continue}
  eq(removes,kind==='closed'||kind==='no-pc'?0:1);eq(pcCloses,pc&&kind!=='closed'?1:0);eq(wsCloses,1);
  eq(errors.length-beforeErrors,kind==='remove-error'?1:0);if(kind==='remove-error')eq(errors.at(-1)[2],'Error removing track');
  eq(refs.peerConnectionRef.current,null);eq(refs.sfuWebSocketRef.current,null);eq(refs.registeredTracksRef.current,[]);eq(refs.reconnectAttemptRef.current,null);eq(refs.connectionTimeoutRef.current,null);eq(refs.previousRemoteStreamsRef.current.size,0);eq(refs.announcedStreamIdRef.current,null);eq(refs.isConnectingRef.current,false);eq(refs.isDisconnectingRef.current,false);
  if(pc)for(const key of pcHandlers)eq(pc[key],null);for(const key of wsHandlers)eq(ws[key],null);
  eq(events.includes('announce:false'),true);eq(events.includes('local:null'),true);eq(events.includes('leave'),true);eq(Object.keys(sources),[]);eq(Object.keys(streams),['local']);eq(remote.stops,1);eq(local.stops,0);eq(source.audioElement.srcObject,null);eq(events.includes('decoder-pause'),true);eq(events.includes('decoder-remove'),true);eq(edges.size,0);
  if(controller){eq(hybridCloses,1);eq(controller.getState().peerConnections,0);eq(events.indexOf('receive-dispose')<events.indexOf('hybrid-close'),true);eq(events.indexOf('hybrid-close')<events.lastIndexOf('disconnect'),true);controller.dispose()}
 }
 const pc={connectionState:'closed'},ws={readyState:3};for(const key of pcHandlers)pc[key]=()=>{};for(const key of wsHandlers)ws[key]=()=>{};
 const refs={peerConnectionRef:ref(pc),sfuWebSocketRef:ref(ws),registeredTracksRef:ref([{track:track('owned')}]),reconnectAttemptRef:ref(null),connectionTimeoutRef:ref(null),previousRemoteStreamsRef:ref(new Set(['old']))};performUnmountCleanup(refs);
 eq(refs.peerConnectionRef.current,null);eq(refs.sfuWebSocketRef.current,null);eq(refs.registeredTracksRef.current,[]);eq(refs.previousRemoteStreamsRef.current.size,0);for(const key of pcHandlers)eq(pc[key],null);for(const key of wsHandlers)eq(ws[key],null);
}finally{Object.assign(voiceLog,original)}
console.log(JSON.stringify({result:'pass',kind:'pure-closed-pc-cleanup-and-hybrid-retirement',cases:5,unmountCheck:true,assertions,actualPeerConnections:0,realWebSockets:0,realCapture:false,realNetwork:false},null,2));
