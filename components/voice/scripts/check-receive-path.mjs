import assert from 'node:assert/strict';
import net from 'node:net';
import dgram from 'node:dgram';
net.Server.prototype.listen = net.Socket.prototype.connect = dgram.createSocket = () => { throw Error('network_prohibited'); };
globalThis.fetch = () => { throw Error('network_prohibited'); };
globalThis.RTCPeerConnection = class { constructor() { throw Error('actual_peer_prohibited'); } };
const { ReceivePathObserver } = await import('../dist/webrtc/hybrid/ReceivePathObserver.js');
const { ReceiveTrackStats, receiveConnectionEpoch, readReceiveStats } = await import('../dist/webrtc/hybrid/receivePathStats.js');
const { HybridReceivePortAdapter } = await import('../dist/webrtc/hybrid/HybridReceivePortAdapter.js');
const { SfuDecodedAudioMonitor } = await import('../dist/webrtc/hybrid/SfuDecodedAudioMonitor.js');
let assertions = 0, stops = 0, closes = 0;
const eq = (a, b) => { assert.deepEqual(a, b); assertions++; };
const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function track(id) { const handlers = new Set(); return { id, kind: 'audio', readyState: 'live', stop() { stops++; },
  addEventListener(e, f) { if (e === 'ended') handlers.add(f); }, removeEventListener(e, f) { handlers.delete(f); },
  end() { this.readyState = 'ended'; for (const f of [...handlers]) f(); }, handlers }; }
const stream = t => ({ getTracks: () => [t], getAudioTracks: () => [t] });
function report(t, { packets = 1, samples = 480, lost = 0, responses = 1, rtt = .05, pair = 'actual-selected', aggregate = false } = {}) {
  const rows = new Map([['audio', { id: 'audio', type: 'inbound-rtp', kind: 'audio', trackIdentifier: t.id,
    packetsReceived: packets, totalSamplesReceived: samples, packetsLost: lost, transportId: 'transport' }],
  ['transport', { id: 'transport', type: 'transport', selectedCandidatePairId: pair }],
  [pair, { id: pair, type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: rtt, responsesReceived: responses,
    localCandidateId: 'private-candidate', remoteCandidateId: 'remote-secret' }],
  ['private-candidate', { type: 'local-candidate', address: '192.168.1.55', port: 12345, usernameFragment: 'secret-ice' }],
  ['unused-nominated', { id: 'unused-nominated', type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: .001 }]]);
  if (aggregate) rows.set('other', { id: 'other', type: 'inbound-rtp', kind: 'audio', packetsReceived: 999999, totalSamplesReceived: 999999 });
  return rows;
}
function fixture() {
  let now = 0, calls = 0, reportValue; const scheduled = new Map(); let timerId = 0;
  const clock = { now: () => now, schedule(f, ms) { const id = ++timerId; scheduled.set(id, { f, at: now + ms }); return id; }, cancel(id) { scheduled.delete(id); } };
  const t = track('sfu-track'), edges = new Set(), context = { createMediaStreamSource: () => new Node() };
  class Node { context = context; connect(to) { edges.add(this); return to; } disconnect() { edges.delete(this); } }
  const node = new Node(); node.mediaStream = stream(t); const analyser = new Node(); node.connect(analyser);
  const retirements = new Set(), control = { current: true, isCurrent() { return this.current; }, subscribeRetirement(f) { retirements.add(f); return () => retirements.delete(f); },
    setRole() { throw Error('observer_changed_role'); }, setMuted() { throw Error('observer_muted'); }, dispose() { throw Error('observer_disposed_input'); },
    retire() { this.current = false; for (const f of [...retirements]) f(); } };
  const source = { stream: node, analyser, receiveCleanup: control };
  const pc = { connectionState: 'connected', getStats: () => { calls++; return Promise.resolve(reportValue ?? report(t)); }, close() { closes++; } };
  const f = { clock, pc, t, source, edges, scheduled, retirements, calls: () => calls,
    scope: { source: 'host-authenticated-connection', bindingId: 'account/server/socket/room', serverId: 'server', roomId: 'room', localSessionId: 'socket', canReceive: true },
    bindings: [{ participantId: 'user', sessionId: 'remote-session', publicationId: 'publication', role: 'microphone', source }],
    sfu: { getPeerConnection: () => f.pc, getConnectionEpoch: () => receiveConnectionEpoch(f.pc), isConnected: true,
      currentServerConnected: 'server', currentChannelConnected: 'room', streamSources: { publication: source } } };
  f.observer = new ReceivePathObserver({ getSfu: () => f.sfu, getScope: () => f.scope, getBindings: () => f.bindings, clock });
  f.setReport = value => { reportValue = value; }; f.advance = async ms => { now += ms; for (const [id, task] of [...scheduled]) if (task.at <= now) { scheduled.delete(id); task.f(); } await settle(); };
  f.sample = async (values, ms = 1000) => { now += ms; reportValue = report(f.t, values); await f.observer.sample(); };
  return f;
}
{
  const f = fixture(); try {
    eq(f.calls(), 0); eq(f.scheduled.size, 0); const initial = f.observer.getSnapshot();
    eq(initial.rows[0].selected, 'sfu'); eq(initial.rows[0].availability, 'unavailable'); eq(initial.rows[0].metrics, null);
    eq(initial.scope.source, 'host-authenticated-connection'); eq(f.observer.getSource(initial.rows[0].sourceId), f.source);
    eq(initial.connectionEpoch, receiveConnectionEpoch(f.pc)); eq(initial.rows[0].receiveGeneration > 0, true);
    const seen = [], cancel = f.observer.subscribe(s => seen.push(s)); eq(f.scheduled.size, 1); eq(f.retirements.size, 1);
    await f.advance(1000); eq(f.calls(), 1); eq(seen.at(-1).rows[0].reason, 'baseline_required');
    await f.observer.sample(); eq(f.calls(), 1);
    await f.sample({ packets: 3, samples: 1440, responses: 3, rtt: 0, lost: 0, aggregate: true });
    const row = f.observer.getSnapshot({ details: true }).rows[0];
    eq(row.availability, 'fresh'); eq(row.decode.decodedFramesDelta, 960); eq(row.decode.samplesDelta, 960); eq(row.decode.packetsDelta, 2);
    eq(row.metrics.rttMs, 0); eq(row.metrics.lossFraction, 0); eq(row.metrics.selectedPairId, 'actual-selected');
    eq(row.metricLeg, 'sfu-to-local'); eq(row.physicalPath, 'unverified'); eq(row.sentToRemote, null);
    eq(f.observer.getSnapshot().rows[0].metrics, null); eq(/192\.168|secret|candidateId|address|port"/.test(JSON.stringify(row)), false);
    await f.sample({ packets: 3, samples: 1440, responses: 3 });
    eq(f.observer.getSnapshot({ details: true }).rows[0].reason, 'no_decode_increment');
    eq(f.observer.getSnapshot({ details: true }).rows[0].metrics.lossFraction, null);
    await f.sample({ packets: 1, samples: 480 }); eq(f.observer.getSnapshot().rows[0].reason, 'counter_reset');
    await f.sample({ packets: 2, samples: 960, lost: 1, responses: 2 });
    eq(f.observer.getSnapshot({ details: true }).rows[0].metrics.lossFraction, .5);
    eq(f.observer.getSnapshot().rows[0].availability, 'fresh');
    await f.advance(4000); eq(f.observer.getSnapshot().rows[0].availability, 'unavailable');
    cancel(); eq(f.scheduled.size, 0); eq(f.retirements.size, 0); eq(f.t.handlers.size, 0);
    const previousCalls = f.calls(); await f.advance(10000); eq(f.calls(), previousCalls);
    eq(f.observer.getSnapshot().rows[0].observedAtMs, null); eq(f.edges.size, 1);
    const callback = () => {}, a = f.observer.subscribe(callback), b = f.observer.subscribe(callback, { details: true });
    a(); a(); eq(f.scheduled.size, 1); b(); eq(f.scheduled.size, 0);
  } finally { f.observer.dispose(); }
}
// Current independently supplied scope and physical source govern lifetime, including receive-only.
for (const change of ['room', 'account', 'socket', 'closed', 'replacement', 'permission', 'retirement', 'alias', 'user-source', 'publication', 'track', 'screen', 'ended']) {
  const f = fixture(); try {
    const cancel = f.observer.subscribe(() => {}, { details: true }); await f.sample({}); await f.sample({ packets: 2, samples: 960, responses: 2 });
    eq(f.observer.getSnapshot().rows[0].availability, 'fresh'); const before = f.observer.getSnapshot().rows[0].selectionEpoch;
    if (change === 'room') f.scope = { ...f.scope, roomId: 'different' };
    if (change === 'account') f.scope = { ...f.scope, bindingId: 'different-account' };
    if (change === 'socket') f.scope = { ...f.scope, localSessionId: 'different-session' };
    if (change === 'closed') f.pc.connectionState = 'closed';
    if (change === 'replacement') f.pc = { ...f.pc, getStats: async () => report(f.t, { packets: 99, samples: 48000 }) };
    if (change === 'permission') f.scope = { ...f.scope, canReceive: false };
    if (change === 'retirement') f.source.receiveCleanup.retire();
    if (change === 'alias') f.bindings.push({ ...f.bindings[0], participantId: 'conflicting-owner' });
    if (change === 'user-source') {
      const other = { ...f.source }; f.sfu.streamSources.other = other;
      f.bindings.push({ ...f.bindings[0], publicationId: 'another-mic-publication', source: other });
    }
    if (change === 'publication') f.bindings = [{ ...f.bindings[0], publicationId: 'new-publication' }];
    if (change === 'track') { f.t = track('same-id-replacement'); f.source.stream.mediaStream = stream(f.t); }
    if (change === 'screen') f.bindings.push({ ...f.bindings[0], role: 'screen' });
    if (change === 'ended') f.t.end();
    f.observer.update(); const after = f.observer.getSnapshot();
    eq(after.rows.every(row => row.availability === 'unavailable' && row.metrics === null), true);
    if (['account', 'socket', 'replacement', 'publication', 'track'].includes(change)) eq(after.rows[0].selectionEpoch > before, true);
    if (change === 'retirement' || change === 'alias' || change === 'screen' || change === 'user-source') eq(after.rows[0].selected, null);
    cancel(); eq(f.scheduled.size, 0); eq(f.retirements.size, 0);
  } finally { f.observer.dispose(); }
}
// An old stats flight cannot fill a new room/PC/track/revision or survive the last unsubscribe.
for (const change of ['room', 'pc', 'track', 'unsubscribe']) {
  const f = fixture(); try {
    const delayed = defer(); f.pc.getStats = () => delayed.promise; const cancel = f.observer.subscribe(() => {});
    const old = f.observer.sample();
    if (change === 'room') f.scope = { ...f.scope, bindingId: 'next-room' };
    if (change === 'pc') f.pc = { connectionState: 'connected', getStats: async () => report(f.t) };
    if (change === 'track') { f.t = track('new-track'); f.source.stream.mediaStream = stream(f.t); }
    if (change === 'unsubscribe') cancel(); else f.observer.update();
    delayed.resolve(report(f.t, { packets: 999, samples: 999999 })); await old;
    eq(f.observer.getSnapshot().rows[0].availability, 'unavailable'); eq(f.observer.getSnapshot().rows[0].observedAtMs, null);
    cancel();
  } finally { f.observer.dispose(); }
}
// The real receive adapter's selected input overrides the underlying SFU node.
{
  const f = fixture(), monitor = new SfuDecodedAudioMonitor(() => f.pc);
  const hybridScope = { serverInstanceId: 'instance', roomId: 'room', roomGeneration: 'opaque-token',
    localParticipantId: 'local', localSessionId: 'socket', canPublish: false, canReceive: true };
  let routeGeneration = 4, routeStatus = 'p2p';
  const port = new HybridReceivePortAdapter({ source: f.source, monitor, isCurrent: () => true,
    getReadOnlyScope: () => hybridScope, getReadOnlyParticipant: () => ({ participantId: 'user', sessionId: 'remote-session', publicationId: 'publication' }),
    getReadOnlyRoute: () => ({ routeGeneration, status: routeStatus, reason: null }) });
  try {
    assert.throws(() => new HybridReceivePortAdapter({ source: f.source, monitor, isCurrent: () => true }), /hybrid_receive_owner_conflict/); assertions++;
    const parser = new ReceiveTrackStats(), peer = track('actual-peer'), peerStream = stream(peer);
    parser.observe(report(peer), peer.id, 0); let value = parser.observe(report(peer, { packets: 2, samples: 960, responses: 2 }), peer.id, 1000);
    const cancel = f.observer.subscribe(() => {}, { details: true }); await f.advance(1000);
    port.select('p2p', { track: peer, stream: peerStream, decodedFrames: 99, mediaSequence: 1, observedAtMs: 1000, getReceiveObservation: () => value }, 2);
    f.observer.update(); let row = f.observer.getSnapshot({ details: true }).rows[0];
    eq(row.selected, 'p2p'); eq(row.trackId, 'actual-peer'); eq(row.availability, 'unavailable'); eq(row.reason, 'selection_window_pending');
    await f.advance(500); value = parser.observe(report(peer, { packets: 3, samples: 1440, responses: 3 }), peer.id, 1500);
    row = f.observer.getSnapshot({ details: true }).rows[0]; eq(row.availability, 'fresh'); eq(row.routeGeneration, 4);
    eq(row.selectionRevision, 2); eq(row.hybridScope.roomGeneration, 'opaque-token'); eq(row.metricLeg, 'peer-to-local');
    const priorEpoch = row.selectionEpoch; const calls = f.calls(); await f.observer.sample(); eq(f.calls(), calls);
    hybridScope.roomGeneration = 'different-token'; f.observer.update(); const differentEpoch = f.observer.getSnapshot().rows[0].selectionEpoch;
    hybridScope.roomGeneration = 'opaque-token'; f.observer.update(); eq(f.observer.getSnapshot().rows[0].selectionEpoch > differentEpoch, true);
    eq(f.observer.getSnapshot().rows[0].availability, 'unavailable');
    f.bindings = [{ ...f.bindings[0], publicationId: 'wrong-publication' }]; f.observer.update();
    eq(f.observer.getSnapshot().rows[0].reason, 'hybrid_publication_conflict'); eq(f.observer.getSnapshot().rows[0].selected, null);
    f.bindings = [{ ...f.bindings[0], publicationId: 'publication' }];
    const edge = [...f.edges][0], disconnect = edge.disconnect; edge.disconnect = () => { throw Error('disconnect_failed'); };
    const unselected = track('unselected');
    assert.throws(() => port.select('p2p', { track: unselected, stream: stream(unselected) }, 3), /disconnect_failed/); assertions++;
    eq(port.getSelection().trackId, 'actual-peer'); edge.disconnect = disconnect;
    routeGeneration = 5; routeStatus = 'recovering'; port.select('none', undefined, 4); f.observer.update();
    eq(f.observer.getSnapshot().rows[0].selected, 'none'); eq(f.observer.getSnapshot().rows[0].availability, 'unavailable');
    port.select('sfu', undefined, 5); routeStatus = 'sfu'; f.observer.update();
    eq(f.observer.getSnapshot().rows[0].selectionEpoch > priorEpoch, true); eq(f.observer.getSnapshot().rows[0].trackId, f.t.id);
    eq(f.observer.getSnapshot().rows[0].observedAtMs, null);
    port.releaseRestored(); f.observer.update(); eq(f.observer.getSnapshot().rows[0].selectionSource, 'sdk-sfu-source');
    eq(f.edges.size, 1); cancel(); eq(f.retirements.size, 0);
  } finally { f.observer.dispose(); port.dispose(); monitor.dispose(); }
}
// Missing/ambiguous track stats, resets, pair changes and unchanged RTT responses stay unknown.
{
  const t = track('exact'), parser = new ReceiveTrackStats();
  eq(parser.observe(report(t), t.id, 0).decode, null);
  let value = parser.observe(report(t, { packets: 2, samples: 960, responses: 1 }), t.id, 1000);
  eq(value.decode.fresh, true); eq(value.metrics.rttMs, null);
  value = parser.observe(report(t, { packets: 3, samples: 1440, responses: 2, pair: 'new-selected' }), t.id, 2000);
  eq(value.metrics.selectedPairId, 'new-selected'); eq(value.metrics.rttMs, null);
  value = parser.observe(report(t, { packets: 4, samples: 1920, lost: -1, responses: 3, pair: 'new-selected' }), t.id, 3000);
  eq(value.decode.fresh, true); eq(value.metrics.lossFraction, null); eq(value.metrics.rttMs, 50);
  const missing = report(t); missing.get('audio').trackIdentifier = undefined;
  eq(parser.observe(missing, t.id, 4000).reason, 'track_stats_unavailable');
  const ambiguous = report(t); ambiguous.set('second', { ...ambiguous.get('audio'), id: 'second' });
  eq(parser.observe(ambiguous, t.id, 5000).reason, 'track_stats_ambiguous');
  parser.observe(report(t), t.id, 6000); eq(parser.observe(report(t, { packets: 20, samples: 10000 }), t.id, 20000).reason, 'measurement_gap');
}
{
  const pending = defer(); let calls = 0; const pc = { getStats() { calls++; return pending.promise; } };
  const a = readReceiveStats(pc), b = readReceiveStats(pc); eq(a, b); eq(calls, 1); pending.resolve(new Map()); await a;
}
// A post-ACK checkpoint must not borrow an observer flight initiated before that ACK.
{
  const t = track('checkpoint'), prior = defer(); let calls = 0;
  const pc = { connectionState: 'connected', getStats() { calls++; return calls === 1 ? prior.promise : Promise.resolve(report(t, { packets: calls === 2 ? 100 : 101, samples: calls === 2 ? 48000 : 48480 })); } };
  const monitor = new SfuDecodedAudioMonitor(() => pc), binding = monitor.bind(stream(t), t, () => true);
  try {
    const preAck = readReceiveStats(pc); let resolved = false;
    const fresh = binding.waitForFresh(0).then(candidate => { resolved = true; return candidate; });
    prior.resolve(report(t, { packets: 90, samples: 43200 })); await preAck; await settle();
    eq(calls, 2); eq(resolved, false); await monitor.read(); const candidate = await fresh;
    eq(calls, 3); eq(candidate.track.id, t.id); eq(candidate.mediaSequence > 1, true);
  } finally { binding.dispose(); monitor.dispose(); }
}
eq(stops, 0); eq(closes, 0);
console.log(JSON.stringify({ result: 'pass', kind: 'passive-read-only-fake-PC', assertions, actualPeerConnections: 0,
  networkListeners: 0, realCapture: false, remoteCommands: 0, physicalDirectProven: false }, null, 2));
