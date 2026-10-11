import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const root=new URL('../',import.meta.url);
const load=async name=>import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(fs.readFileSync(new URL(name,root),'utf8'),{mode:'transform'})).toString('base64'));
const {ReceiveCorrectionRegistry,correctionParticipantId}=await load('src/lib/receiveCorrectionRegistry.ts');
const track={id:'track-a',readyState:'live'};
const control={role:undefined,identity:undefined,setRole(role){this.role=role;},setIdentity(identity){this.identity=identity;}};
const source={receiveCleanup:control,stream:{mediaStream:{getAudioTracks:()=>[track]}}};
const registry=new ReceiveCorrectionRegistry();
registry.reconcile({host:'server-a',connected:true,sources:{mic:source,alias:source},clients:[{serverUserId:'person-a',streamID:'mic'}]});
assert.equal(control.role,'microphone');
assert.equal(control.identity.participantId,correctionParticipantId('server-a','person-a'));
assert.equal(control.identity.trackId,'track-a');
assert.equal(registry.lookup('server-a','person-a','mic'),undefined);
registry.acceptBatch({kind:'receive-auto-levels',schemaVersion:1,snapshots:[{...control.identity,sequence:1,audioTimeSeconds:1,status:'learning',limitReasons:[],learnedAutoGainDb:3.2,appliedAutoGainDb:2.1,targetAutoGainDb:4,acceptedSpeechSeconds:2,speechWindowSeconds:2,estimatorReliability:'provisional',compressionGainReductionDb:6}]});
assert.equal(registry.lookup('server-a','person-a','mic').learnedAutoGainDb,3.2);
assert.equal(registry.lookup('server-a','person-a','mic').appliedAutoGainDb,2.1);
assert.equal(registry.lookup('server-b','person-a','mic'),undefined);
console.log('PASS real-route identity binding and separate receiver-local learned/applied values');
const initial = registry.lookup('server-a', 'person-a', 'mic');
const batch = (...snapshots) => ({ kind: 'receive-auto-levels', schemaVersion: 1, snapshots });
registry.acceptBatch(batch({ ...initial, sequence: 3, appliedAutoGainDb: 0 }));
assert.equal(registry.lookup('server-a', 'person-a', 'mic').learnedAutoGainDb, 3.2, 'pauses retain learned correction');
assert.equal(registry.lookup('server-a', 'person-a', 'mic').appliedAutoGainDb, 0, 'a measured zero stays zero');
registry.acceptBatch(batch({ ...initial, sequence: 2, learnedAutoGainDb: 17 }));
assert.equal(registry.lookup('server-a', 'person-a', 'mic').learnedAutoGainDb, 3.2, 'late measurements cannot replace newer data');
registry.acceptBatch(batch({ ...initial, sequence: 3, status: 'unavailable', learnedAutoGainDb: null, appliedAutoGainDb: null, targetAutoGainDb: null, compressionGainReductionDb: null }));
assert.equal(registry.lookup('server-a', 'person-a', 'mic').learnedAutoGainDb, null, 'same-sequence null clear is accepted defensively');
registry.acceptBatch(batch({ ...initial, sequence: 3 }));
assert.equal(registry.lookup('server-a', 'person-a', 'mic').learnedAutoGainDb, null, 'same-sequence measurement cannot resurrect cleared data');
registry.acceptBatch(batch({ ...initial, sequence: 4 }));
registry.acceptBatch(batch());
assert.equal(registry.lookup('server-a', 'person-a', 'mic'), undefined, 'missing authoritative route clears immediately');
console.log('PASS pause values, ordered lifecycle clearing and authoritative removal');
registry.acceptBatch(batch({ ...initial, sequence: 2 }));
assert.equal(registry.lookup('server-a', 'person-a', 'mic'), undefined, 'stale data cannot resurrect a missing route');
registry.acceptBatch(batch({ ...initial, sequence: 5 }));
const firstIdentity = { ...control.identity };
registry.reconcile({ host: 'server-a', connected: true, sources: { mic: source, alias: source }, clients: [{ serverUserId: 'person-a', streamID: 'mic' }] });
assert.deepEqual(control.identity, firstIdentity, 'ordinary member updates preserve identity');
const replacement = { id: 'track-b', readyState: 'live' };
source.stream.mediaStream.getAudioTracks = () => [replacement];
registry.reconcile({ host: 'server-a', connected: true, sources: { mic: source }, clients: [{ serverUserId: 'person-a', streamID: 'mic' }] });
assert.ok(control.identity.generation > firstIdentity.generation);
assert.equal(registry.lookup('server-a', 'person-a', 'mic'), undefined);
registry.acceptBatch(batch({ ...initial, sequence: 99 }));
assert.equal(registry.lookup('server-a', 'person-a', 'mic'), undefined, 'old generation is rejected');
registry.reconcile({ host: 'server-a', connected: true, sources: { mic: source, screen: source }, clients: [{ serverUserId: 'person-a', streamID: 'mic', screenShareAudioStreamID: 'screen' }] });
assert.equal(control.role, 'screen');
assert.equal(control.identity, undefined, 'screen alias removes microphone association');
registry.reconcile({ host: 'server-a', connected: true, sources: { mic: source }, clients: [{ serverUserId: 'person-a', streamID: 'mic' }, { serverUserId: 'person-b', streamID: 'mic' }] });
assert.equal(control.identity, undefined, 'ambiguous shared route has no participant association');
registry.reconcile({ host: 'server-a', connected: true, sources: { mic: source }, clients: [{ serverUserId: 'person-a', streamID: 'mic' }] });
const beforeReconnect = { ...control.identity };
registry.reconcile({ host: 'server-a', connected: false, sources: { mic: source }, clients: [] });
assert.equal(control.identity, undefined);
registry.reconcile({ host: 'server-a', connected: true, sources: { mic: source }, clients: [{ serverUserId: 'person-a', streamID: 'mic' }] });
assert.ok(control.identity.generation > beforeReconnect.generation);
assert.equal(control.identity.receiverId, beforeReconnect.receiverId);
console.log('PASS replacement, reconnect, screen precedence and ambiguous-route isolation');
const newMeasurement = { ...initial, ...control.identity, sequence: 1 };
registry.acceptBatch(batch(newMeasurement));
registry.acceptBatch(batch({ ...initial, sequence: 999 }));
assert.equal(registry.lookup('server-a', 'person-a', 'mic').generation, newMeasurement.generation, 'late previous-generation snapshot cannot clear current measurement');
for (const bad of [
  { ...newMeasurement, sequence: 2, learnedAutoGainDb: NaN },
  { ...newMeasurement, sequence: 2, appliedAutoGainDb: Infinity },
  { ...newMeasurement, sequence: -1 },
  { ...newMeasurement, sequence: 2, status: 'invented' },
  { ...newMeasurement, sequence: 2, acceptedSpeechSeconds: -1 },
]) {
  registry.acceptBatch(batch(bad));
  assert.equal(registry.lookup('server-a', 'person-a', 'mic'), undefined, 'malformed authoritative measurement clears presentation');
}
registry.acceptBatch(batch({ ...newMeasurement, sequence: 2, status: 'settled', learnedAutoGainDb: -4 }));
assert.equal(registry.lookup('server-a', 'person-a', 'mic').status, 'settled');
const source2 = { receiveCleanup: { setRole() {}, setIdentity(identity) { this.identity = identity; } }, stream: { mediaStream: { getAudioTracks: () => [{ id: 'track-c' }] } } };
registry.reconcile({ host: 'server-a', connected: true, sources: { mic: source, second: source2 }, clients: [{ serverUserId: 'person-a', streamID: 'mic' }, { serverUserId: 'person-b', streamID: 'second' }] });
registry.acceptBatch(batch({ ...newMeasurement, sequence: 3 }, { ...newMeasurement, ...source2.receiveCleanup.identity, sequence: 1, learnedAutoGainDb: -6 }));
assert.equal(registry.lookup('server-a', 'person-b', 'second').learnedAutoGainDb, -6);
registry.acceptBatch(batch({ ...newMeasurement, sequence: 4, learnedAutoGainDb: null, appliedAutoGainDb: null, status: 'unavailable' }, { ...newMeasurement, ...source2.receiveCleanup.identity, sequence: 1, learnedAutoGainDb: -6 }));
assert.equal(registry.lookup('server-a', 'person-b', 'second').learnedAutoGainDb, -6, 'one-route clearing preserves other-route measurement');
registry.clear();
assert.equal(registry.getSnapshot().size, 0);
assert.equal(control.identity, undefined);
assert.equal(source2.receiveCleanup.identity, undefined);
console.log('PASS malformed input rejection, independent participants and disposal');
const endedTrack = new EventTarget();
Object.assign(endedTrack, { id: 'event-track', readyState: 'live' });
const eventControl = { setRole() {}, setIdentity(identity) { this.identity = identity; } };
registry.reconcile({ host: 'server-a', connected: true, sources: { event: { receiveCleanup: eventControl, stream: { mediaStream: { getAudioTracks: () => [endedTrack] } } } }, clients: [{ serverUserId: 'person-event', streamID: 'event' }] });
registry.acceptBatch(batch({ ...initial, ...eventControl.identity, sequence: 1 }));
endedTrack.readyState = 'ended';
endedTrack.dispatchEvent(new Event('ended'));
assert.equal(eventControl.identity, undefined, 'ended event unbinds without waiting for another batch');
assert.equal(registry.lookup('server-a', 'person-event', 'event'), undefined);
console.log('PASS physical track end clears immediately');
registry.reconcile({ host: 'server-a', channel: 'one', connected: true, sources: { mic: source }, clients: [{ serverUserId: 'person-a', streamID: 'mic' }] });
const channelGeneration = control.identity.generation;
registry.reconcile({ host: 'server-a', channel: 'two', connected: true, sources: { mic: source }, clients: [{ serverUserId: 'person-a', streamID: 'mic' }] });
assert.ok(control.identity.generation > channelGeneration, 'channel transition increments even when batched connection state skips disconnected');
console.log('PASS channel transition starts a fresh generation');
const events=[];
const observerRegistry=new ReceiveCorrectionRegistry({
  bound:(_control,identity)=>events.push(['bound',{...identity}]),
  unbound:identity=>events.push(['unbound',{...identity}]),
  measured:snapshot=>events.push(['measured',snapshot.sequence]),
});
const observerTrack=new EventTarget();Object.assign(observerTrack,{id:'observer-track',readyState:'live'});
const observerControl={setRole(){},setIdentity(value){this.identity=value}};
const observerSource={receiveCleanup:observerControl,stream:{mediaStream:{getAudioTracks:()=>[observerTrack]}}};
const observerInput={host:'server-a',channel:'one',connected:true,sources:{mic:observerSource,alias:observerSource},clients:[{serverUserId:'person-a',streamID:'mic'}]};
observerRegistry.reconcile(observerInput);assert.equal(events.length,1);assert.equal(events[0][0],'bound');
const observerIdentity={...observerControl.identity};
observerRegistry.reconcile(observerInput);assert.equal(events.length,1,'shared aliases/repeated roster do not restore twice');
observerRegistry.acceptBatch(batch({...initial,...observerIdentity,sequence:8}));
assert.deepEqual(events.at(-1),['measured',8]);
observerRegistry.acceptBatch(batch({...initial,...observerIdentity,sequence:7}));assert.equal(events.length,2,'late sequence cannot renew cache');
observerRegistry.acceptBatch(batch({...initial,...observerIdentity,sequence:9,learnedAutoGainDb:NaN}));assert.equal(events.length,2,'malformed values never reach exporter');
observerTrack.readyState='ended';observerTrack.dispatchEvent(new Event('ended'));
assert.deepEqual(events.at(-1),['unbound',observerIdentity]);
observerRegistry.acceptBatch(batch({...initial,...observerIdentity,sequence:10}));assert.equal(events.length,3,'late batch after track end cannot reach cache');
observerTrack.readyState='live';observerRegistry.reconcile(observerInput);
assert.equal(events.at(-1)[0],'bound');assert.ok(observerControl.identity.generation>observerIdentity.generation);
observerRegistry.clear();assert.equal(events.at(-1)[0],'unbound');assert.equal(observerControl.identity,undefined);
console.log('PASS observer cache seam: one physical restore, fresh ordered evidence, invalid/late isolation and immediate lease unbind');
