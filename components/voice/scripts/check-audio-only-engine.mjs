import assert from 'node:assert/strict';
import { advance, answered, FakeSocket, fakePhonePlatform, fakeRoom, fakeStream, fakeTrack, log, mountEngine, settle, voiceConfig } from './engine-harness.mjs';
import { VoiceConfigProvider } from '../dist/config/index.js';
import { setVoicePlatform } from '../dist/platform/index.js';
import { VoiceSingletonHooks } from '../dist/shared/SingletonHooks.js';
import { useSFU } from '../dist/webrtc/hooks/useSFU.js';
import { useCamera } from '../dist/audio/hooks/useCamera.js';
import { useScreenShare } from '../dist/audio/hooks/useScreenShare.js';
import { useNativeAudioCapture } from '../dist/audio/hooks/useNativeAudioCapture.js';
import { useNativeScreenCapture } from '../dist/audio/hooks/useNativeScreenCapture.js';
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';

const phone=fakePhonePlatform();setVoicePlatform(phone);
let cameraRequests=0,screenRequests=0,resolveCamera,resolveScreen;
navigator.mediaDevices.getUserMedia=()=>{++cameraRequests;return new Promise(resolve=>{resolveCamera=resolve;});};
navigator.mediaDevices.getDisplayMedia=()=>{++screenRequests;return new Promise(resolve=>{resolveScreen=resolve;});};
const base=voiceConfig({stunHosts:['stun:fixture.test']});base.audio.muted=true;
const audioOnly={...base,connection:{...base.connection,mediaMode:'audio-only',receiveMicrophoneStreamIds:['trusted-mic']}};
const engine=await mountEngine({provider:VoiceConfigProvider,runner:VoiceSingletonHooks,read:()=>({sfu:useSFU(),camera:useCamera(),screen:useScreenShare(),nativeAudio:useNativeAudioCapture(),nativeScreen:useNativeScreenCapture()}),config:audioOnly,target:{id:'fixture',room:fakeRoom('fixture')}});
await settle(()=>{engine.current.camera.setCameraEnabled(true);engine.current.camera.retryCamera();engine.current.screen.startScreenShare(true);});
assert.equal(cameraRequests,0);assert.equal(screenRequests,0);assert.equal(engine.current.camera.cameraEnabled,false);
assert.equal(await engine.current.nativeAudio.start({}),false);assert.equal(await engine.current.nativeScreen.start(0,60),false);
await settle(()=>engine.current.sfu.connect('fixture-channel').catch(()=>{}));await advance(1000);
const pc=phone.peers.at(-1);await settle(()=>pc.reach('connected'));
assert.equal(engine.current.sfu.isConnected,true);
await engine.update({config:{...audioOnly,connection:{...audioOnly.connection,receiveMicrophoneStreamIds:['trusted-mic','trusted-mic']}}});
assert.equal(pc.connectionState,'connected','duplicate allowlist entries must not interrupt the call');
assert.deepEqual(answered(FakeSocket.all.at(-1)).map(s=>s.direction),['sendonly','inactive','inactive','inactive']);
const senderCount=pc.getSenders().length;
for(const [method,kind] of [['addVideoTrack','video'],['addScreenVideoTrack','video'],['addScreenAudioTrack','audio']]){
  const forbidden=fakeTrack(kind,'forbidden');await settle(()=>engine.current.sfu[method](forbidden,fakeStream(forbidden)));
  assert.equal(forbidden.readyState,'ended');assert.equal(pc.getSenders().length,senderCount);
}
const offer={type:'offer',sdp:'v=0\r\n'+['m=audio 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\na=recvonly','m=audio 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:4\r\na=sendonly\r\na=msid:trusted-mic remote-mic','m=audio 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:5\r\na=sendonly\r\na=msid:screen-audio remote-screen','m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:6\r\na=sendonly\r\na=msid:camera remote-video'].join('\r\n')+'\r\n'};
await settle(()=>FakeSocket.all.at(-1).deliver('offer',offer));
assert.deepEqual(answered(FakeSocket.all.at(-1)).map(s=>s.direction),['sendonly','recvonly','inactive','inactive']);
const remoteMic=fakeTrack('audio');const remoteMicStream=fakeStream(remoteMic);
remoteMicStream.id='trusted-mic';
await settle(()=>pc.ontrack({track:remoteMic,streams:[remoteMicStream],transceiver:pc.getTransceivers().find(t=>t.mid==='4'),receiver:{}}));
assert.ok(engine.current.sfu.streams[remoteMicStream.id]);
const remoteScreen=fakeTrack('audio');const screenStream=fakeStream(remoteScreen);
await settle(()=>pc.ontrack({track:remoteScreen,streams:[screenStream],transceiver:pc.getTransceivers().find(t=>t.mid==='5'),receiver:{}}));
assert.equal(engine.current.sfu.streams[screenStream.id],undefined);
// A legacy full-mode camera request may complete after audio-only is forced.
await engine.update({config:base});await settle(()=>{engine.current.camera.setCameraEnabled(true);engine.current.screen.startScreenShare(true);});
assert.equal(cameraRequests,1);assert.equal(screenRequests,1);await engine.update({config:audioOnly});
const late=fakeTrack('video');await settle(()=>resolveCamera(fakeStream(late)));
assert.equal(late.readyState,'ended');assert.equal(engine.current.camera.cameraStream,null);
const lateScreen=fakeTrack('video'),lateScreenAudio=fakeTrack('audio');
await settle(()=>resolveScreen({getTracks:()=>[lateScreen,lateScreenAudio]}));
assert.equal(lateScreen.readyState,'ended');assert.equal(lateScreenAudio.readyState,'ended');
assert.equal(engine.current.screen.screenVideoStream,null);assert.equal(engine.current.screen.screenAudioStream,null);
assert.equal(pc.connectionState,'closed','policy changes revoke the existing transport immediately');
await advance(3000);
// React commits recovery after advance() returns; then drain the owned 50ms cleanup.
await advance(100);const rebuilt=phone.peers.at(-1);assert.notEqual(rebuilt,pc);
await settle(()=>rebuilt.reach('connected'));
assert.ok(answered(FakeSocket.all.at(-1)).every(s=>s.kind!=='video'||s.direction==='inactive'));
// A config update while createAnswer is pending must never send the stale answer.
let resolveAnswer;const createAnswer=rebuilt.createAnswer.bind(rebuilt),socket=FakeSocket.all.at(-1),answerCount=socket.answers.length;
rebuilt.createAnswer=()=>new Promise(resolve=>{resolveAnswer=resolve;});
await settle(()=>socket.deliver('offer',offer));assert.equal(typeof resolveAnswer,'function');
await engine.update({config:{...audioOnly,connection:{...audioOnly.connection,receiveMicrophoneStreamIds:[]}}});
await settle(()=>{createAnswer().then(resolveAnswer);});
assert.equal(socket.answers.length,answerCount,'stale answer escaped after policy revocation');
await engine.unmount();
// Standalone native capture hooks predate the provider and keep their full-mode default.
let standalone;
function NativeProbe(){standalone={audio:useNativeAudioCapture(),screen:useNativeScreenCapture()};return null;}
let nativeRenderer;await act(async()=>{nativeRenderer=TestRenderer.create(createElement(NativeProbe),{unstable_isConcurrent:true});});
assert.equal(standalone.audio.available,false);assert.equal(standalone.screen.available,false);
await act(async()=>nativeRenderer.unmount());
log('audio-only engine: muted fixture capture/start guards, native guards, SDP negotiation, routing, forbidden publication, policy change/reconnect passed');
