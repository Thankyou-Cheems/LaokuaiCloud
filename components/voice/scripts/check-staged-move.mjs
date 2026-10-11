import assert from 'node:assert/strict';
import { advance, answered, FakeSocket, FakePeerConnection, fakePhonePlatform, fakeRoom, fakeStream, fakeTrack, log, mountEngine, settle, voiceConfig } from './engine-harness.mjs';
import { setVoicePlatform } from '../dist/platform/index.js';
import { StagedMoveController } from '../dist/webrtc/hooks/stagedMove.js';
import { VoiceConfigProvider } from '../dist/config/index.js';
import { VoiceSingletonHooks } from '../dist/shared/SingletonHooks.js';
import { useSFU } from '../dist/webrtc/hooks/useSFU.js';
import { useMicrophone } from '../dist/audio/hooks/useMicrophone.js';

const phone = fakePhonePlatform(); setVoicePlatform(phone);
let streamNumber = 0;
globalThis.MediaStream = class {
  constructor(tracks) { this.tracks = tracks; this.id = `staged-${++streamNumber}`; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
};
let assertions = 0;
const rejects = async (promise, code) => { await assert.rejects(promise, error => error.code === code); assertions++; };
function fixture() {
  const original = fakeTrack(); const clones = [];
  original.clone = () => { const track = fakeTrack(); clones.push(track); return track; };
  const publication = fakeStream(original), room = fakeRoom('server');
  let leave = 0, announce = 0, local = 0;
  room.leave = () => leave++; room.announceJoined = () => announce++; room.setLocalStream = () => local++;
  const oldPC = new FakePeerConnection({}); oldPC.connectionState = 'connected';
  oldPC.addTrack(original, publication);
  const oldWS = new FakeSocket('ws://source.test');
  let current = { pc: oldPC, ws: oldWS, channelId: 'source', serverId: 'server', room, publicationStream: publication,
    policy: { mediaMode: 'audio-only', receiveMicrophoneStreamIds: ['trusted-mic'] }, stunHosts: ['stun:fixture.test'] };
  let status = 'pending', applied = false, queryOverride = null;
  let promoted = 0, recovery = false, sourceFailures = 0, activeFailures = 0, streamsReleased = 0, transmitReleased = 0;
  let barrier = { acknowledged: true, blocked: true, revision: 7 };
  const observers = new Set();
  const authority = { generation: 'auth-1', stagingSupported: true,
    confirmCommit: async id => queryOverride ? queryOverride(id) : ({ requestId: id, generation: authority.generation,
      sourceChannelId: 'source', destinationChannelId: 'destination', status }),
    onInvalidated: cb => { observers.add(cb); return () => observers.delete(cb); },
    isDestinationPolicyApplied: () => applied };
  room.moveAuthority = authority;
  const controller = new StagedMoveController({ getSource: () => current, getRoom: () => room,
    getPublicationBarrier: () => barrier,
    onPromote: (stage, request, failed) => { promoted++; recovery = failed;
      current = { ...current, pc: stage.pc, ws: stage.ws, channelId: request.destinationChannelId }; },
    onActiveStreams: () => streamsReleased++, onActiveState() {}, onSourceFailure: () => sourceFailures++,
    onActiveFailure: () => activeFailures++, onTransmissionReleased: () => transmitReleased++ });
  const request = id => ({ requestId: id, sourceChannelId: 'source', destinationChannelId: 'destination',
    joinToken: { move_id: id }, sfuUrls: ['ws://stage.test'], expiresAt: Date.now() + 30_000,
    channelSettings: { requirePushToTalk: true, disableRnnoise: true, maxBitrate: 64000, eSportsMode: false } });
  return { controller, request, original, clones, oldPC, oldWS, room, authority, observers,
    get current() { return current; }, set current(value) { current = value; },
    get barrier() { return barrier; }, set barrier(value) { barrier = value; },
    set status(value) { status = value; }, set applied(value) { applied = value; }, set query(value) { queryOverride = value; },
    invalidate: () => [...observers].forEach(cb => cb('revoked')),
    get counts() { return { promoted, recovery, sourceFailures, activeFailures, streamsReleased, transmitReleased, leave, announce, local }; } };
}
async function ready(f, id = 'move-1') {
  await settle(); const result = f.controller.prepare(f.request(id)); result.catch(() => {});
  await settle(); const pc = phone.peers.at(-1), ws = FakeSocket.all.at(-1);
  await settle(() => pc.reach('connected')); await result;
  return { pc, ws, sender: pc.getSenders().find(sender => sender.track), result };
}
function sourceIntact(f) {
  assert.equal(f.original.readyState, 'live'); assert.equal(f.oldPC.connectionState, 'connected');
  assert.deepEqual([f.counts.leave, f.counts.announce, f.counts.local], [0, 0, 0]); assertions += 3;
}

// Public capability and input rejection do not acquire capture or mutate active refs.
{
  const f = fixture(); await settle(); f.room.moveAuthority = undefined;
  await rejects(f.controller.prepare(f.request('unsupported')), 'unsupported'); sourceIntact(f); f.controller.dispose();
}
{
  const f = fixture(); await settle(); f.current.policy.mediaMode = 'full';
  await rejects(f.controller.prepare(f.request('full')), 'unsupported_media_mode'); sourceIntact(f); f.controller.dispose();
}
{
  const f = fixture(); await settle(); f.original.clone = undefined;
  await rejects(f.controller.prepare(f.request('raw')), 'unsupported_publication_boundary'); sourceIntact(f); f.controller.dispose();
}
{
  const f = fixture(); await settle(); const request = f.request('invalid'); request.channelSettings = null;
  await rejects(f.controller.prepare(request), 'invalid_prepare'); sourceIntact(f); f.controller.dispose();
}
// Independent disabled publication clone, no inbound playback or active signaling.
for (const boundary of [undefined, { acknowledged: false, blocked: true, revision: 1 }, { acknowledged: true, revision: 1 }]) {
  const f = fixture(); await settle(); f.barrier = boundary; const before = phone.peers.length;
  await rejects(f.controller.prepare(f.request('legacy')), 'unsupported_publication_boundary');
  assert.equal(phone.peers.length, before); assert.equal(f.controller.hasPending, false); sourceIntact(f); f.controller.dispose();
}
{
  const f = fixture(); const { pc, ws, sender } = await ready(f);
  assert.equal(sender.track, f.clones[0]); assert.equal(sender.track.enabled, false); sourceIntact(f);
  assert.deepEqual(answered(ws).map(s => s.direction), ['sendonly', 'inactive', 'inactive', 'inactive']);
  const offer = { type: 'offer', sdp: 'v=0\r\n' + ['m=audio 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\na=recvonly',
    'm=audio 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:4\r\na=sendonly\r\na=msid:trusted-mic remote',
    'm=audio 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:5\r\na=sendonly\r\na=msid:screen-audio screen',
    'm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:6\r\na=sendonly\r\na=msid:camera cam'].join('\r\n') + '\r\n' };
  await settle(() => ws.deliver('offer', offer));
  assert.deepEqual(answered(ws).map(s => s.direction), ['sendonly', 'recvonly', 'inactive', 'inactive']);
  const remote = fakeTrack(); await settle(() => pc.ontrack({ track: remote, streams: [fakeStream(remote)], transceiver: pc.getTransceivers().find(t => t.mid === '4'), receiver: {} }));
  assert.equal(f.counts.streamsReleased, 0); assertions += 5;
  await rejects(f.controller.prepare({ ...f.request('move-1'), expiresAt: Date.now() + 1000 }), 'request_conflict');
  await rejects(f.controller.commit('move-1'), 'authority_pending'); sourceIntact(f);
  await f.controller.abort('move-1'); assert.equal(f.clones[0].readyState, 'ended'); sourceIntact(f); f.controller.dispose();
}
// Idempotent prepare shares the same operation. Supersede rejects stale acknowledgments.
{
  const f = fixture(); await settle(); const request = f.request('one');
  const first = f.controller.prepare(request); first.catch(() => {});
  assert.equal(f.controller.prepare(request), first); await settle(); await settle(() => phone.peers.at(-1).reach('connected')); await first;
  await ready(f, 'two'); assert.equal(f.clones[0].readyState, 'ended'); sourceIntact(f);
  f.status = 'committed'; await rejects(f.controller.commit('one'), 'stale_authority');
  f.controller.dispose(); assert.equal(f.clones[1].readyState, 'ended'); sourceIntact(f);
}
// Exact request/source/destination/generation proof and immediate auth observation.
for (const field of ['requestId', 'generation', 'sourceChannelId', 'destinationChannelId']) {
  const f = fixture(); await ready(f); f.query = async id => ({ requestId: id, generation: 'auth-1', sourceChannelId: 'source', destinationChannelId: 'destination', status: 'committed', [field]: 'stale' });
  await rejects(f.controller.commit('move-1'), 'stale_confirmation'); sourceIntact(f); f.controller.dispose();
}
{
  const f = fixture(); await ready(f); let resolve;
  f.query = () => new Promise(done => { resolve = done; });
  const commit = f.controller.commit('move-1'); commit.catch(() => {}); await settle();
  f.invalidate(); resolve({ requestId: 'move-1', generation: 'auth-1', sourceChannelId: 'source', destinationChannelId: 'destination', status: 'committed' });
  await rejects(commit, 'stale_authority'); assert.equal(f.clones[0].readyState, 'ended'); sourceIntact(f); f.controller.dispose();
}
// Expiry, policy changes, destination clean close and PC failure retire only staging.
{
  const f = fixture(); await ready(f); await advance(30_000); assert.equal(f.clones[0].readyState, 'ended'); sourceIntact(f); f.controller.dispose();
}
{
  const f = fixture(); await ready(f); f.current.policy.receiveMicrophoneStreamIds = [];
  f.controller.validatePending(); assert.equal(f.clones[0].readyState, 'ended'); sourceIntact(f); f.controller.dispose();
}
for (const failure of ['socket', 'pc']) {
  const f = fixture(); const stage = await ready(f);
  await settle(() => { if (failure === 'pc') stage.pc.reach('failed'); else { stage.ws.readyState = FakeSocket.CLOSED; stage.ws.onclose({ code: 1000, wasClean: true }); } });
  assert.equal(f.clones[0].readyState, 'ended'); sourceIntact(f); f.controller.dispose();
}
// An unknown query preserves a still-live source. A real failed source is reported truthfully.
{
  const f = fixture(); await ready(f); f.query = async () => { throw new Error('query timeout'); };
  assert.equal(f.controller.sourceDisconnected(), true); await settle(); sourceIntact(f); assert.equal(f.controller.hasPending, true);
  f.oldPC.connectionState = 'closed'; f.controller.sourceDisconnected(); await settle();
  assert.equal(f.counts.sourceFailures, 1); assert.equal(f.counts.promoted, 0); f.controller.dispose();
}
{
  const f = fixture(); await ready(f); f.oldPC.connectionState = 'closed';
  f.controller.sourceDisconnected(); await settle(); assert.equal(f.counts.sourceFailures, 1); assert.equal(f.counts.promoted, 0); assert.equal(f.original.readyState, 'live'); f.controller.dispose();
}
// Authoritative commit promotes even if SFU closed the source before the app event.
{
  const f = fixture(); const stage = await ready(f); f.status = 'committed'; f.oldPC.connectionState = 'closed';
  f.controller.sourceDisconnected(); await settle(); assert.equal(f.counts.promoted, 1); assert.equal(f.current.pc, stage.pc);
  assert.equal(f.clones[0].enabled, false); assert.equal(f.controller.transmissionBlocked, true);
  assert.deepEqual([f.counts.leave, f.counts.announce, f.counts.local], [0, 0, 0]);
  await f.controller.commit('move-1'); await f.controller.abort('move-1'); assert.equal(f.counts.promoted, 1);
  await rejects(f.controller.resume('move-1'), 'destination_policy_not_acknowledged');
  f.applied = true; f.barrier = undefined; await rejects(f.controller.resume('move-1'), 'destination_policy_not_acknowledged');
  f.barrier = { acknowledged: true, blocked: false, revision: 9 }; await rejects(f.controller.resume('move-1'), 'destination_policy_not_acknowledged');
  f.barrier = { acknowledged: true, blocked: true, revision: 10 }; await f.controller.resume('move-1');
  assert.equal(stage.sender.track, f.original); assert.equal(f.controller.transmissionBlocked, false);
  await f.controller.resume('move-1'); assert.equal(f.counts.transmitReleased, 1);
  assert.equal(f.original.readyState, 'live'); f.controller.dispose();
}
// Authority moved; destination died: no claim of rollback or preserving a retired source.
{
  const f = fixture(); const first = await ready(f); f.status = 'committed'; await f.controller.commit('move-1');
  f.applied = true; await f.controller.resume('move-1');
  const oldInvalidation = [...f.observers][0], oldClose = first.ws.onclose;
  const originalRequest = f.request;
  f.request = id => ({ ...originalRequest(id), sourceChannelId: 'destination', destinationChannelId: 'third' });
  f.query = async id => ({ requestId: id, generation: 'auth-1', sourceChannelId: 'destination', destinationChannelId: 'third', status: 'committed' });
  const second = await ready(f, 'move-2'); await f.controller.commit('move-2');
  assert.equal(f.observers.size, 1); oldInvalidation('late'); oldClose({ code: 1006, wasClean: false }); await settle();
  assert.equal(f.current.pc, second.pc); assert.equal(f.counts.activeFailures, 0); assert.equal(f.original.readyState, 'live');
  f.controller.dispose(); assertions += 4;
}
{
  const f = fixture(); const stage = await ready(f); await settle(() => stage.pc.reach('failed')); f.status = 'committed';
  await rejects(f.controller.commit('move-1'), 'destination_recovery_required');
  assert.equal(f.current.channelId, 'destination'); assert.equal(f.counts.recovery, true); assert.equal(f.oldPC.connectionState, 'closed');
  f.current = null; f.applied = true; f.controller.authorizeConnect('destination'); assert.equal(f.controller.blocksRecovery, false); f.controller.dispose();
}
// Async replacement must revalidate policy, ACK revision and exact destination PC.
for (const mutation of ['none', 'permission', 'enabled', 'invalidation']) {
  const f = fixture(); const stage = await ready(f); f.status = 'committed'; await f.controller.commit('move-1'); f.applied = true;
  let finish, originalReplaces = 0; const replace = stage.sender.replaceTrack;
  stage.sender.replaceTrack = next => {
    if (next === f.original) { originalReplaces++; stage.sender.track = next; return new Promise(resolve => { finish = resolve; }); }
    return replace(next);
  };
  const first = f.controller.resume('move-1'), second = f.controller.resume('move-1');
  first.catch(() => {}); second.catch(() => {}); assert.equal(first, second); assert.equal(originalReplaces, 1);
  if (mutation === 'permission') f.applied = false;
  if (mutation === 'enabled') f.original.enabled = false;
  if (mutation === 'invalidation') f.invalidate();
  finish();
  if (mutation === 'none') {
    await Promise.all([first, second]); assert.equal(f.counts.transmitReleased, 1);
    await f.controller.resume('move-1'); assert.equal(originalReplaces, 1); assert.equal(stage.sender.track, f.original);
    f.invalidate(); assert.equal(stage.pc.connectionState, 'closed'); assert.equal(f.controller.transmissionBlocked, true);
  } else {
    await rejects(first, mutation === 'invalidation' ? 'stale_authority' : 'destination_policy_changed');
    await rejects(second, mutation === 'invalidation' ? 'stale_authority' : 'destination_policy_changed');
    assert.equal(f.counts.transmitReleased, 0); assert.equal(f.controller.transmissionBlocked, true);
    if (mutation === 'invalidation') assert.equal(stage.pc.connectionState, 'closed');
    else assert.equal(stage.sender.track, f.clones[0]);
  }
  assert.equal(f.original.readyState, 'live'); f.controller.dispose(); assertions += 6;
}
{
  const f = fixture(); const firstStage = await ready(f); f.status = 'committed'; await f.controller.commit('move-1'); f.applied = true;
  let finish; const replace = firstStage.sender.replaceTrack;
  firstStage.sender.replaceTrack = next => {
    if (next === f.original) { firstStage.sender.track = next; return new Promise(resolve => { finish = resolve; }); }
    return replace(next);
  };
  const oldResume = f.controller.resume('move-1'); oldResume.catch(() => {});
  const originalRequest = f.request;
  f.request = id => ({ ...originalRequest(id), sourceChannelId: 'destination', destinationChannelId: 'third' });
  f.query = async id => ({ requestId: id, generation: 'auth-1', sourceChannelId: 'destination', destinationChannelId: 'third', status: 'committed' });
  const secondStage = await ready(f, 'move-2'); await f.controller.commit('move-2'); finish();
  await rejects(oldResume, 'destination_policy_changed');
  assert.equal(firstStage.pc.connectionState, 'closed'); assert.equal(secondStage.pc.connectionState, 'connected');
  assert.equal(secondStage.sender.track, f.clones[1]); assert.equal(f.clones[1].enabled, false);
  assert.equal(f.controller.transmissionBlocked, true); assert.equal(f.counts.transmitReleased, 0);
  assert.equal(f.original.readyState, 'live'); f.controller.dispose(); assertions += 7;
}
{
  const f = fixture(); await settle(); f.original.enabled = false;
  await rejects(f.controller.prepare(f.request('disabled-source')), 'unsupported_publication_boundary'); sourceIntact(f); f.controller.dispose();
}
{
  const f = fixture(); await settle(); f.oldPC.getSenders()[0].track = fakeTrack();
  await rejects(f.controller.prepare(f.request('unregistered-source')), 'unsupported_publication_boundary'); sourceIntact(f); f.controller.dispose();
}
for (const mutation of ['policy', 'revision', 'pc', 'auth']) {
  const f = fixture(); const stage = await ready(f); f.status = 'committed'; await f.controller.commit('move-1'); f.applied = true;
  let finish; const replace = stage.sender.replaceTrack;
  stage.sender.replaceTrack = next => { if (next === f.original) { stage.sender.track = next; return new Promise(resolve => { finish = resolve; }); } return replace(next); };
  const resume = f.controller.resume('move-1'); resume.catch(() => {}); await settle();
  if (mutation === 'policy') f.applied = false;
  if (mutation === 'revision') f.barrier = { ...f.barrier, revision: 99 };
  if (mutation === 'pc') f.current = { ...f.current, pc: new FakePeerConnection({}) };
  if (mutation === 'auth') f.authority.generation = 'auth-2';
  finish(); await rejects(resume, mutation === 'auth' ? 'stale_authority' : 'destination_policy_changed');
  assert.equal(stage.sender.track, f.clones[0]); assert.equal(f.controller.transmissionBlocked, true); assert.equal(f.counts.transmitReleased, 0); assert.equal(f.original.readyState, 'live'); f.controller.dispose();
}
assert.equal(phone.microphone.requests.length, 0, 'staging must never capture a raw microphone');

// Drive the public hooks too: preparing and aborting must not publish staged refs.
{
  const f = fixture(), config = voiceConfig({ stunHosts: ['stun:fixture.test'] });
  config.audio.muted = true; config.connection.mediaMode = 'audio-only';
  const engine = await mountEngine({ provider: VoiceConfigProvider, runner: VoiceSingletonHooks,
    read: () => ({ sfu: useSFU(), mic: useMicrophone() }), config, target: { id: 'server', room: f.room } });
  // This native fixture has no worklet; inject a protected publication fixture explicitly.
  engine.current.mic.microphoneBuffer.publicationStream = fakeStream(f.original);
  await engine.update({ config: { ...config } });
  await settle(() => engine.current.sfu.connect('source').catch(() => {})); await advance(1000);
  const sourcePC = phone.peers.at(-1); await settle(() => sourcePC.reach('connected'));
  engine.current.mic.microphoneBuffer.publicationStream = fakeStream(f.original);
  await engine.update({ config: { ...config } });
  const sourceStreams = Object.keys(engine.current.sfu.streams);
  const sourceAnnouncements = [f.counts.leave, f.counts.announce, f.counts.local];
  await rejects(engine.current.sfu.prepareMove(f.request('legacy-hook')), 'unsupported_publication_boundary');
  Object.assign(engine.current.mic.transmissionState, { publicationAcknowledged: true, publicationBlocked: true, publicationRevision: 1 });
  const prepared = engine.current.sfu.prepareMove(f.request('hook')); prepared.catch(() => {}); await settle();
  const stagePC = phone.peers.at(-1); assert.notEqual(stagePC, sourcePC);
  await settle(() => stagePC.reach('connected')); await prepared;
  assert.deepEqual(Object.keys(engine.current.sfu.streams), sourceStreams); assert.equal(sourcePC.connectionState, 'connected');
  assert.equal(engine.current.sfu.currentChannelConnected, 'source');
  await engine.current.sfu.abortMove('hook'); assert.equal(sourcePC.connectionState, 'connected');
  assert.deepEqual([f.counts.leave, f.counts.announce, f.counts.local], sourceAnnouncements);
  await engine.unmount(); assertions += 6;
}
// An explicit microphone profile is inherited by the disabled destination sender.
{
  const f=fixture();f.current.microphoneCodec={codec:'opus',maxBitrateBps:24000,packetTimeMs:20,channels:1,vbr:true,dtx:true,fec:true};
  const stage=await ready(f,'codec');
  assert.equal(stage.sender.parameters.encodings[0].maxBitrate,24000);assert.equal(stage.sender.track.enabled,false);
  // A target channel can lower the inherited profile without the legacy eSports override.
  await f.controller.abort('codec');
  const originalRequest=f.request;
  f.request=id=>({...originalRequest(id),channelSettings:{...originalRequest(id).channelSettings,eSportsMode:true,maxBitrate:16000}});
  const cappedStage=await ready(f,'codec-cap');assert.equal(cappedStage.sender.parameters.encodings[0].maxBitrate,16000);assertions++;
  f.current={...f.current,microphoneCodec:{...f.current.microphoneCodec,maxBitrateBps:32000}};
  await rejects(f.controller.commit('codec-cap'),'source_or_policy_changed');sourceIntact(f);f.controller.dispose();assertions+=2;
}
log(`staged move: ${assertions} assertion groups passed; no real capture or network`);

