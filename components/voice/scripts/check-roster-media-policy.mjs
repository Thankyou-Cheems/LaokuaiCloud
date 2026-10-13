import assert from 'node:assert/strict';
import { advance, answered, fakePhonePlatform, fakeRoom, fakeStream, fakeTrack, FakeSocket, log, mountEngine, settle, voiceConfig } from './engine-harness.mjs';
import { VoiceConfigProvider } from '../dist/config/index.js';
import { setVoicePlatform } from '../dist/platform/index.js';
import { VoiceSingletonHooks } from '../dist/shared/SingletonHooks.js';
import { useSFU } from '../dist/webrtc/hooks/useSFU.js';

const phone = fakePhonePlatform(); setVoicePlatform(phone);
const base = voiceConfig({ stunHosts: ['stun:fixture.test'] }); base.audio.muted = true;
const config = ids => ({ ...base, connection: { ...base.connection, mediaMode: 'audio-only', receiveMicrophoneStreamIds: ids } });
const offer = id => ({ type: 'offer', sdp: 'v=0\r\n' + [
  'm=audio 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\na=recvonly',
  `m=audio 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:4\r\na=sendonly\r\na=msid:${id} peer-track`,
  'm=audio 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:5\r\na=sendonly\r\na=msid:screen-audio screen-track',
  'm=audio 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:6\r\na=sendonly',
].join('\r\n') + '\r\n' });
const engine = await mountEngine({ provider: VoiceConfigProvider, runner: VoiceSingletonHooks, read: useSFU,
  config: config([]), target: { id: 'fixture', room: fakeRoom('fixture') } });
try {
  await settle(() => engine.current.connect('fixture-channel').catch(() => {})); await advance(1000);
  const pc = phone.peers.at(-1), ws = FakeSocket.all.at(-1); await settle(() => pc.reach('connected'));
  const localSender = pc.getSenders().find(sender => sender.track), localTrack = localSender.track, initialEnabled = localTrack.enabled;
  ws.offer = () => ws.deliver('offer', offer('peer-old'));
  await settle(() => ws.offer());
  const receiver = pc.getTransceivers().find(t => t.mid === '4'), track = fakeTrack(), stream = fakeStream(track);
  stream.id = 'peer-old';
  receiver.receiver.track = track;
  await settle(() => pc.ontrack({ track, streams: [stream], transceiver: receiver, receiver: receiver.receiver }));
  assert.equal(track.enabled, false); assert.equal(engine.current.streams[stream.id], undefined);
  // Offer first, authenticated roster later. Grants must wait for an answer.
  ws.hold = true; await engine.update({ config: config(['peer-old']) });
  assert.equal(pc.connectionState, 'connected', 'normal member join closed the active SFU transport');
  assert.equal(track.enabled, false, 'new grant enabled media before renegotiation');
  assert.ok(ws.held > 0, 'late roster did not request an SFU offer');
  await settle(() => ws.release());
  assert.equal(answered(ws).find(t => t.mid === '4').direction, 'recvonly');
  assert.equal(track.enabled, true); assert.ok(engine.current.streams[stream.id], 'held ontrack was never routed');
  assert.equal(answered(ws).find(t => t.mid === '5').direction, 'inactive');
  assert.equal(answered(ws).find(t => t.mid === '6').direction, 'inactive');
  const count = ws.sent.filter(m => m.event === 'renegotiate').length;
  await engine.update({ config: config(['peer-old', 'peer-old']) });
  assert.equal(ws.sent.filter(m => m.event === 'renegotiate').length, count);
  // Publication rotation revokes the previous receiver before the next offer.
  ws.hold = true; await engine.update({ config: config(['peer-new']) });
  assert.equal(track.enabled, false); assert.equal(engine.current.streams[stream.id], undefined);
  assert.equal(pc.connectionState, 'connected');
  ws.offer = () => ws.deliver('offer', offer('peer-new'));
  await settle(() => ws.release());
  assert.equal(answered(ws).find(t => t.mid === '4').direction, 'recvonly');
  assert.equal(track.enabled, true, 'roster-first publication was stranded');
  assert.equal(engine.current.streams['peer-old'], undefined, 'retired publication alias survived receiver reuse');
  assert.ok(engine.current.streams['peer-new'], 'new publication did not own the reused receiver');
  // Leave removes audio immediately even while signalling cannot progress.
  ws.hold = true; await engine.update({ config: config([]) });
  assert.equal(track.enabled, false); assert.equal(engine.current.streams['peer-new'], undefined);
  assert.equal(pc.connectionState, 'connected'); await settle(() => ws.release());
  assert.equal(answered(ws).find(t => t.mid === '4').direction, 'inactive');
  // A permission revision during createAnswer must retry the same offer, not send a stale answer or close.
  let resolveAnswer; const realAnswer = pc.createAnswer.bind(pc), previous = ws.answers.length;
  pc.createAnswer = () => new Promise(resolve => { resolveAnswer = resolve; });
  await settle(() => ws.deliver('offer', offer('peer-new'))); ws.hold = true;
  await engine.update({ config: config(['peer-new']) });
  pc.createAnswer = realAnswer; await settle(() => { realAnswer().then(resolveAnswer); });
  assert.equal(pc.connectionState, 'connected');
  assert.equal(ws.answers.length, previous + 1, 'policy revision did not converge on a fresh answer');
  assert.equal(answered(ws).find(t => t.mid === '4').direction, 'recvonly');
  assert.equal(phone.peers.length, 1, 'roster updates rebuilt a peer connection');
  assert.equal(localSender.track, localTrack); assert.equal(localTrack.enabled, initialEnabled, 'roster negotiation changed the protected publication gate');
  log('roster media policy: offer/roster ordering, immediate leave/rotation revocation, strict unknown/screen denial, duplicate roster and in-flight answer convergence passed');
} finally { await engine.unmount(); }
