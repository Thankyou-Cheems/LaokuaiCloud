import assert from 'node:assert/strict';
import net from 'node:net'; import dgram from 'node:dgram';
net.Server.prototype.listen = net.Socket.prototype.connect = dgram.createSocket = () => { throw new Error('network_prohibited_in_unit'); };
globalThis.fetch = () => { throw new Error('fetch_prohibited_in_unit'); };
const { SocketHybridAuthority } = await import('../dist/webrtc/hybrid/SocketHybridAuthority.js');
const { BrowserHybridPeer, borrowHybridPublication } = await import('../dist/webrtc/hybrid/BrowserHybridPeer.js');
const { SfuDecodedAudioMonitor } = await import('../dist/webrtc/hybrid/SfuDecodedAudioMonitor.js');
let assertions = 0; const equal = (a,b) => { assert.deepEqual(a,b); ++assertions; };
const rejects = async (value, match) => { await assert.rejects(value, match); ++assertions; };
const scope = { serverInstanceId:'instance', roomId:'room', roomGeneration:'room-gen', localParticipantId:'a', localSessionId:'socket-a', canPublish:true, canReceive:true };
const participant = { participantId:'b', sessionId:'socket-b', publicationId:'actual-server-publication', canSendAudio:true, canReceiveAudio:true };
class Socket {
  id='socket-a'; connected=true; listeners=new Map(); requests=[];
  on(event, callback) { const listeners=this.listeners.get(event)??new Set();listeners.add(callback);this.listeners.set(event,listeners); }
  off(event,callback) { this.listeners.get(event)?.delete(callback); }
  emit(event,value) { for(const callback of this.listeners.get(event)??[]) callback(value); }
  reply=async(event,payload)=>event==='voice:hybrid:scope' ? {v:1,status:'supported',capabilities:{protocolVersion:1,authenticatedRoomSignals:true,pairForwardingLeases:true},scope,participants:[participant]} :
    event==='voice:hybrid:lease' ? {v:1,status:'leased',lease:{connectionId:'pair',scope,remoteSessionId:participant.sessionId,initiator:true}} : {v:1,status:'relayed'};
  timeout() { return {emitWithAck:(event,payload)=>{this.requests.push({event,payload});return this.reply(event,payload)}}; }
}
{
  const socket=new Socket(), authority=new SocketHybridAuthority(socket,()=> 'synthetic-unit-token');
  equal(authority.capabilities,null);equal(authority.isCurrent(scope),false);
  const result=await authority.refresh();result.scope.roomId='tamper';equal(authority.isCurrent(scope),true);
  const received=[];authority.subscribeSignals(value=>received.push(value));
  const signal={serverInstanceId:scope.serverInstanceId,roomId:scope.roomId,roomGeneration:scope.roomGeneration,sourceSessionId:participant.sessionId,destinationSessionId:scope.localSessionId,connectionId:'pair',sequence:1,body:{kind:'answer',sdp:'v=0'}};
  socket.emit('voice:hybrid:signal',signal);equal(received.length,0);
  const lease=await authority.leasePair(scope,participant);await new Promise(r=>setTimeout(r,5));equal(received.length,1);
  let revoked=0;authority.subscribePairInvalidation(()=>revoked++);socket.emit('voice:hybrid:pair-invalidated',{connectionId:'pair'});socket.emit('voice:hybrid:pair-invalidated',{connectionId:'pair'});equal(revoked,1);
  await rejects(authority.relay(signal),/hybrid_pair_stale/);
  socket.emit('disconnect');equal(authority.capabilities,null);equal(authority.isCurrent(scope),false);await rejects(authority.releasePair({...lease,scope:{...scope}}).then(()=>authority.leasePair(scope,participant)),/hybrid_scope_stale/);
  authority.dispose();equal([...socket.listeners.values()].reduce((n,s)=>n+s.size,0),0);
}
{
  const socket=new Socket(), authority=new SocketHybridAuthority(socket,()=> 'synthetic-unit-token');
  let resolve; socket.reply=()=>new Promise(r=>{resolve=r}); const refresh=authority.refresh();socket.id='new-generation';
  resolve({v:1,status:'supported',capabilities:{protocolVersion:1,authenticatedRoomSignals:true,pairForwardingLeases:true},scope,participants:[]});
  await rejects(refresh,/hybrid_scope_stale/);equal(authority.capabilities,null);authority.dispose();
}
{
  const socket=new Socket(), authority=new SocketHybridAuthority(socket,()=> 'synthetic-unit-token');
  socket.reply=async()=>({v:1,status:'failed',error:'hybrid_unsupported'});await rejects(authority.refresh(),/hybrid_unsupported/);equal(authority.capabilities,null);authority.dispose();
}
let stopped=0;
const track={id:'protected-track',kind:'audio',readyState:'live',enabled:true,stop(){stopped++},addEventListener(){},removeEventListener(){}};
const stream={getAudioTracks:()=>[track],getTracks:()=>[track]};
const microphone={microphoneBuffer:{publicationStream:stream,processedStream:stream},transmissionState:{generation:1,publicationAcknowledged:true,publicationRevision:1}};
const publicationPc={connectionState:'connected',getSenders:()=>[{track}]};
equal(borrowHybridPublication(microphone,publicationPc).track,track);
equal(borrowHybridPublication({...microphone,microphoneBuffer:{processedStream:stream}},publicationPc),null);
const physical=borrowHybridPublication(microphone,publicationPc);
for(const patch of [{generation:2,publicationRevision:2},{generation:3,publicationAcknowledged:false},{generation:4,publicationRevision:8}]) {
  const after=borrowHybridPublication({...microphone,transmissionState:{...microphone.transmissionState,...patch}},publicationPc);
  equal(after.generation,physical.generation);equal(after.track,physical.track);
}
const unapproved={getAudioTracks:()=>[track],getTracks:()=>[track]};
equal(borrowHybridPublication({...microphone,microphoneBuffer:{publicationStream:unapproved},transmissionState:{publicationAcknowledged:false}},publicationPc),null);
equal(borrowHybridPublication(microphone,{...publicationPc,getSenders:()=>[{track:{...track}}]}),null);
const profile={codec:'opus',channels:1,maxBitrateBps:24000,packetTimeMs:20,vbr:true,dtx:true,fec:true};
const sdp='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\na=sendrecv\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 stereo=0;cbr=0;maxaveragebitrate=24000;usedtx=1;useinbandfec=1\r\na=ptime:20\r\na=maxptime:20\r\n';
class FakePc {
  connectionState='connected';signalingState='stable';localCalls=0;
  parameters={encodings:[{}],codecs:[{mimeType:'audio/opus'}]};
  sender={track,getParameters:()=>structuredClone(this.parameters),setParameters:async value=>{this.parameters=value}};
  addTrack(){return this.sender} getTransceivers(){return [{mid:'0',sender:this.sender}]}
  async setRemoteDescription(value){this.remoteDescription=value;this.signalingState='have-remote-offer'}
  async createAnswer(){return {type:'answer',sdp}}
  async setLocalDescription(value){this.localCalls++;this.localDescription=value;this.signalingState='stable'}
  async getStats(){return new Map()} close(){this.connectionState='closed'}
}
globalThis.RTCPeerConnection=FakePc;
{
  const signals=[],factory={lease:{scope,remoteSessionId:'socket-b',connectionId:'unit-pair',initiator:false},publication:borrowHybridPublication(microphone,publicationPc),participant,onSignal:v=>signals.push(v),onFailure(){}};
  const peer=new BrowserHybridPeer(factory,{rtcConfiguration:{iceServers:[]},microphoneCodec:profile});
  await rejects(peer.acceptSignal({kind:'offer',sdp:'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n'}),/peer_audio_only_required/);
  await peer.acceptSignal({kind:'offer',sdp});equal(peer.pc.localCalls,1);equal(peer.pc.parameters.encodings[0].maxBitrate,24000);equal(signals.length,1);equal(signals[0].kind,'answer');
  equal(peer.getMicrophoneCodecState().rtpVerified,false);await rejects(peer.readMetrics(),/peer_metrics_unavailable/);
  peer.dispose();equal(peer.pc.connectionState,'closed');equal(stopped,0);
}
for (const bitrate of [48000,64000]) {
  const factory={lease:{scope,remoteSessionId:'socket-b',connectionId:'unit-'+bitrate,initiator:false},publication:borrowHybridPublication(microphone,publicationPc),participant,onSignal(){},onFailure(){}};
  const peer=new BrowserHybridPeer(factory,{rtcConfiguration:{iceServers:[]},microphoneCodec:{...profile,maxBitrateBps:bitrate},channelMaxBitrateBps:16000});
  await peer.acceptSignal({kind:'offer',sdp:sdp.replace('maxaveragebitrate=24000','maxaveragebitrate='+bitrate)});
  equal(peer.getMicrophoneCodecState().requested.maxBitrateBps,bitrate);equal(peer.getMicrophoneCodecState().effectiveMaxBitrateBps,16000);
  equal(peer.pc.parameters.encodings[0].maxBitrate,16000);equal(peer.getMicrophoneCodecState().limitedBy,['channel_bitrate']);peer.dispose();
}
{
  const factory={lease:{scope,remoteSessionId:'socket-b',connectionId:'cap-failure',initiator:false},publication:borrowHybridPublication(microphone,publicationPc),participant,onSignal(){},onFailure(){}};
  const peer=new BrowserHybridPeer(factory,{rtcConfiguration:{iceServers:[]},microphoneCodec:{...profile,maxBitrateBps:64000},channelMaxBitrateBps:5000});
  await rejects(peer.start(),/peer_codec_unavailable/);equal(peer.pc.connectionState,'closed');equal(peer.getMicrophoneCodecState().effectiveMaxBitrateBps,5000);peer.dispose();
}
{
  let stats=new Map([['in',{type:'inbound-rtp',kind:'audio',trackIdentifier:track.id,packetsReceived:10,totalSamplesReceived:4800}]]),calls=0;
  const pc={connectionState:'connected',async getStats(){calls++;return stats}};
  const monitor=new SfuDecodedAudioMonitor(()=>pc),binding=monitor.bind(stream,track,()=>true);
  let resolved=false;const waiting=binding.waitForFresh(0).then(v=>{resolved=true;return v});await Promise.resolve();await Promise.resolve();await Promise.resolve();
  equal(resolved,false);equal(calls,1); // The checkpoint is not fresh audio.
  stats.get('in').totalSamplesReceived=9600;await monitor.read();equal(resolved,false); // Concealment/sample-only progress is insufficient.
  stats.get('in').packetsReceived=11;await monitor.read();const media=await waiting;equal(media.track,track);equal(media.mediaSequence,2);
  const stale=binding.waitForFresh(media.mediaSequence);await new Promise(r=>setImmediate(r));
  stats.get('in').packetsReceived=1;stats.get('in').totalSamplesReceived=480;await monitor.read();await rejects(stale,/sfu_counters_reset/);
  binding.dispose();monitor.dispose();equal(stopped,0);
}
{
  let firstResolve,calls=0,packets=20,samples=9600;
  const make=(p,s)=>new Map([['in',{type:'inbound-rtp',kind:'audio',trackIdentifier:track.id,packetsReceived:p,totalSamplesReceived:s}]]);
  const pc={connectionState:'connected',getStats(){calls++;return calls===1?new Promise(r=>firstResolve=r):Promise.resolve(make(packets,samples))}};
  const monitor=new SfuDecodedAudioMonitor(()=>pc);const oldFlight=monitor.read();const binding=monitor.bind(stream,track,()=>true);
  let resolved=false;const waiting=binding.waitForFresh(0).then(value=>{resolved=true;return value});firstResolve(make(10,4800));await oldFlight;await new Promise(r=>setImmediate(r));
  equal(calls,2);equal(resolved,false);packets++;samples+=480;await monitor.read();equal((await waiting).mediaSequence,3);binding.dispose();monitor.dispose();
}
console.log(JSON.stringify({kind:'no-network-unit',assertions,result:'pass',actualPeerConnections:0,realSocketConnections:0,realCapture:false,actualSfuGate:false},null,2));
