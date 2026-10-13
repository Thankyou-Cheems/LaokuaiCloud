import assert from 'node:assert/strict';
import { advance, answered, fakePhonePlatform, fakeRoom, fakeStream, fakeTrack, FakeSocket, log, mountEngine, settle, voiceConfig } from './engine-harness.mjs';
import { VoiceConfigProvider } from '../dist/config/index.js';
import { setVoicePlatform } from '../dist/platform/index.js';
import { VoiceSingletonHooks } from '../dist/shared/SingletonHooks.js';
import { useSFU } from '../dist/webrtc/hooks/useSFU.js';

// A real mounted hook/effect/ontrack seam; media, socket and time are synthetic.
const phone=fakePhonePlatform();setVoicePlatform(phone);
const base=voiceConfig({stunHosts:['stun:fixture.test']});base.audio.muted=true;
const config=ids=>({...base,connection:{...base.connection,mediaMode:'audio-only',receiveMicrophoneStreamIds:ids}});
const offer={type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\na=recvonly\r\nm=audio 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:4\r\na=sendonly\r\na=msid:peer-publication peer-track\r\n'};
const engine=await mountEngine({provider:VoiceConfigProvider,runner:VoiceSingletonHooks,read:useSFU,
  config:config(['peer-publication']),target:{id:'fixture',room:fakeRoom('fixture')}});
try{
  await settle(()=>engine.current.connect('fixture-channel').catch(()=>{}));await advance(1000);
  const pc=phone.peers.at(-1),ws=FakeSocket.all.at(-1);await settle(()=>pc.reach('connected'));
  ws.offer=()=>ws.deliver('offer',offer);await settle(()=>ws.offer());
  const transceiver=pc.getTransceivers().find(t=>t.mid==='4');
  const first=fakeTrack(),firstStream=fakeStream(first);firstStream.id='peer-publication';transceiver.receiver.track=first;
  await settle(()=>pc.ontrack({track:first,streams:[firstStream],transceiver,receiver:transceiver.receiver}));
  assert.ok(engine.current.streams['peer-publication']);
  const answers=ws.answers.length;ws.hold=true;
  await engine.update({config:config([])});assert.equal(first.enabled,false);
  await engine.update({config:config(['peer-publication'])});
  assert.equal(ws.answers.length,answers,'held SFU offer unexpectedly produced another answer');
  assert.equal(first.enabled,false,'new grant must still wait for current negotiation');
  // A later SFU offer adds a new receiver for the same authorized publication.
  // Browser ontrack fires during setRemoteDescription, before the answer completes.
  let resolveAnswer;const createAnswer=pc.createAnswer.bind(pc);
  pc.createAnswer=()=>new Promise(resolve=>{resolveAnswer=resolve});
  const latest={...offer,sdp:offer.sdp.replace('a=sendonly\r\na=msid:peer-publication','a=inactive\r\na=msid:peer-publication')+
    'm=audio 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:8\r\na=sendonly\r\na=msid:peer-publication replacement-track\r\n'};
  await settle(()=>ws.deliver('offer',latest));assert.equal(typeof resolveAnswer,'function');
  const added=pc.getTransceivers().find(t=>t.mid==='8');
  const next=fakeTrack(),nextStream=fakeStream(next);nextStream.id='peer-publication';added.receiver.track=next;
  await settle(()=>pc.ontrack({track:next,streams:[nextStream],transceiver:added,receiver:added.receiver}));
  log(JSON.stringify({case:'revoke-and-regrant-same-policy-before-answer',answersBefore:answers,answersAfter:ws.answers.length,
    heldRenegotiations:ws.held,trackEnabled:next.enabled,routed:!!engine.current.streams['peer-publication'],pcState:pc.connectionState}));
  assert.equal(next.enabled,false,'old committed policy key admitted a new track before a fresh answer');
  assert.equal(engine.current.streams['peer-publication'],undefined,'new grant routed audio before its current negotiation');
  pc.createAnswer=createAnswer;await settle(()=>{createAnswer().then(resolveAnswer)});
  assert.equal(next.enabled,true);assert.ok(engine.current.streams['peer-publication']);
  assert.equal(pc.connectionState,'connected');
  await engine.update({config:config(['peer-publication','another-publication'])});
  assert.equal(next.enabled,true,'an unchanged authorized receiver was needlessly disabled');
  assert.ok(engine.current.streams['peer-publication']);
  // Several roster/offer changes while an earlier answer is pending must use the newest offer.
  const count=ws.answers.length;
  pc.createAnswer=()=>new Promise(resolve=>{resolveAnswer=resolve});
  await engine.update({config:config(['publication-b'])});
  await settle(()=>ws.deliver('offer',latest));assert.equal(typeof resolveAnswer,'function');
  await engine.update({config:config(['publication-c'])});
  await settle(()=>ws.deliver('offer',{...latest,sdp:latest.sdp.replaceAll('peer-publication','publication-c')}));
  await engine.update({config:config(['publication-d'])});
  const newest={...latest,sdp:latest.sdp.replaceAll('peer-publication','publication-d')};
  await settle(()=>ws.deliver('offer',newest));
  assert.equal(next.enabled,false);assert.equal(engine.current.streams['peer-publication'],undefined);
  pc.createAnswer=createAnswer;await settle(()=>{createAnswer().then(resolveAnswer)});
  assert.equal(ws.answers.length,count+1,'stale answer escaped or latest answer was stranded');
  assert.ok(pc.remoteDescription.sdp.includes('a=msid:publication-d'));
  assert.equal(answered(ws).find(section=>section.mid==='8').direction,'recvonly');
  assert.ok(engine.current.streams['publication-d']);
  for(const id of ['peer-publication','publication-b','publication-c'])assert.equal(engine.current.streams[id],undefined);
  assert.equal(phone.peers.length,1);assert.equal(pc.connectionState,'connected');
  log('roster policy roundtrip: new track waits for fresh answer after revoke/regrant; continuous roster changes converge on latest queued offer without rebuilding PC');
}finally{await engine.unmount();}
