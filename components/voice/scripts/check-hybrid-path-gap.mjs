import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

// Actual production Peer + stats parser + controller; fake PC only, no ICE/media/network.
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const settle = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
class Clock {
  time = 0; next = 0; jobs = new Map();
  now = () => this.time;
  schedule = (callback, delay) => { const id = ++this.next; this.jobs.set(id, { callback, at: this.time + delay }); return id; };
  cancel = id => this.jobs.delete(id);
  async advance(ms) {
    const end = this.time + ms; await settle();
    for (let guard = 0; guard < 1000; guard++) {
      const entry = [...this.jobs].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!entry || entry[1].at > end) { this.time = end; await settle(); return; }
      this.time = entry[1].at; this.jobs.delete(entry[0]); entry[1].callback(); await settle();
    }
    throw Error('fixture timer loop');
  }
}
const track = id => ({ id, kind: 'audio', readyState: 'live', enabled: true, addEventListener() {}, removeEventListener() {} });
const stream = input => ({ getTracks: () => [input], getAudioTracks: () => [input] });
const scope = { serverInstanceId: 'server', roomId: 'room', roomGeneration: 'room-1', localParticipantId: 'local', localSessionId: 'local-session', canPublish: true, canReceive: true };
const person = { participantId: 'remote', sessionId: 'remote-session', publicationId: 'remote-publication', canSendAudio: true, canReceiveAudio: true };
function fixture({ legacy = false, initialMode = 'selected' } = {}) {
  const clock = new Clock(), remoteTrack = track('remote-track'), events = [], gates = [], peers = [];
  let mode = initialMode, stalledAt = Infinity, restoreFails = false, sequence = 1;
  class FakePc {
    connectionState = 'connected'; signalingState = 'stable';
    parameters = { encodings: [{}], codecs: [{ mimeType: 'audio/opus' }] };
    addTrack(input) { return { track: input, getParameters: () => structuredClone(this.parameters), setParameters: async value => { this.parameters = value; } }; }
    async getStats() {
      // External timeline emits RTP; asking for stats never advances the counters.
      const n = 10 + Math.floor(Math.min(clock.now(), stalledAt) / 20);
      const rows = new Map([
        ['inbound', { id: 'inbound', type: 'inbound-rtp', kind: 'audio', trackIdentifier: remoteTrack.id, packetsReceived: n, totalSamplesReceived: n * 960, transportId: 'transport' }],
        ['transport', { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' }],
        ['pair', { id: 'pair', type: 'candidate-pair', state: 'succeeded', localCandidateId: 'local', remoteCandidateId: 'remote' }],
        ['local', { id: 'local', type: 'local-candidate', candidateType: mode === 'turn' ? 'relay' : 'host', address: '192.0.2.1', port: 40000, protocol: 'udp' }],
        ['remote', { id: 'remote', type: 'remote-candidate', candidateType: 'host', address: '192.0.2.2', port: 40001, protocol: 'udp' }],
      ]);
      if (mode === 'transport-missing') rows.delete('transport');
      if (mode === 'selected-id-missing') delete rows.get('transport').selectedCandidatePairId;
      if (mode === 'pair-missing') rows.delete('pair');
      if (mode === 'new-pair-missing') { rows.delete('pair'); rows.get('transport').selectedCandidatePairId = 'new-pair'; }
      if (mode === 'checking' || mode === 'failed') rows.get('pair').state = mode;
      if (mode === 'candidate-missing') rows.delete('remote');
      return rows;
    }
    close() { this.connectionState = 'closed'; }
  }
  const context = vm.createContext({ structuredClone, Map, Set, WeakMap, Promise,
    performance: { now: clock.now }, setTimeout: clock.schedule, clearTimeout: clock.cancel,
    RTCPeerConnection: FakePc, Audio: class { play() { return Promise.resolve(); } pause() {} remove() {} } });
  const modules = new Map(); let mutations = 0;
  function loadSource(path) {
    if (modules.has(path)) return modules.get(path).exports;
    const module = { exports: {} }; modules.set(path, module);
    let source = readFileSync(path, 'utf8');
    if (legacy && path.endsWith('HybridRouteController.ts')) {
      const seam = 'this.allowPathStatsGap(route, candidate)';
      assert.equal(source.split(seam).length - 1, 1, 'legacy mutation lands exactly once');
      source = source.replace(seam, 'false'); mutations++;
    }
    const output = ts.transpileModule(source, { fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const run = vm.runInContext(`(function(exports, require, module) { ${output}\n})`, context, { filename: path });
    run(module.exports, name => {
      if (!name.startsWith('.')) throw Error(`unexpected production dependency: ${name}`);
      return loadSource(resolve(dirname(path), name + '.ts'));
    }, module); return module.exports;
  }
  const { BrowserHybridPeer } = loadSource(resolve(sourceRoot, 'webrtc/hybrid/BrowserHybridPeer.ts'));
  const { HybridRouteController } = loadSource(resolve(sourceRoot, 'webrtc/hybrid/HybridRouteController.ts'));
  const { peerMediaDiagnostic } = loadSource(resolve(sourceRoot, 'webrtc/hybrid/hybridDiagnostic.ts'));
  const { readReceiveTransportPath } = loadSource(resolve(sourceRoot, 'webrtc/hybrid/receivePathStats.ts'));
  assert.equal(mutations, legacy ? 1 : 0);
  const publicationTrack = track('publication'), sfuTrack = track('sfu');
  const publication = { stream: stream(publicationTrack), track: publicationTrack, generation: 1, publicationRevision: 1, publicationAcknowledged: true };
  const port = { isCurrent: () => true, getSfuMediaSequence: () => sequence,
    waitForSfuMedia: async after => {
      if (restoreFails) throw Error('offline restore fixture');
      return { track: sfuTrack, stream: stream(sfuTrack), decodedFrames: 1, mediaSequence: sequence = Math.max(sequence + 1, after + 1), observedAtMs: clock.now() };
    }, select() {} };
  const authority = { environment: 'simulation', capabilities: { protocolVersion: 1, authenticatedRoomSignals: true, pairForwardingLeases: true },
    isCurrent: () => true, leasePair: async () => ({ scope, remoteSessionId: person.sessionId, connectionId: 'controller-pair', initiator: false }),
    relay: async () => {}, releasePair() {}, subscribeSignals: () => () => {}, subscribeInvalidation: () => () => {},
    setForwarding: async request => { gates.push(request); return { ...request, applied: true, leaseRemainingMs: request.enabled ? 0 : request.pauseLeaseMs }; } };
  const controller = new HybridRouteController({ clock, authority, getPublication: () => publication, getReceivePort: () => port,
    createPeer: factory => {
      const peer = new BrowserHybridPeer(factory, { rtcConfiguration: { iceServers: [] },
        microphoneCodec: { codec: 'opus', channels: 1, maxBitrateBps: 64000, packetTimeMs: 20, vbr: true, dtx: true, fec: true },
        onDiagnostic: event => events.push(event), pathUnderlayResolver: { resolve: path => ({ source: 'host-underlay-resolver',
          classification: mode === 'et-relay' ? 'easytier-relay' : 'not-easytier', observedAtMs: path.observedAtMs }) } });
      peer.pc.ontrack({ track: remoteTrack, streams: [stream(remoteTrack)] }); peers.push(peer); return peer;
    } }, { enabled: true, pathStableMs: 0 });
  controller.reconcile(scope, [person]);
  return { clock, controller, peers, gates, events, peerMediaDiagnostic, readReceiveTransportPath,
    mode: value => { mode = value; }, stall: () => { stalledAt = clock.now(); }, restoreFails: () => { restoreFails = true; },
    state: () => controller.getState().routes[0] };
}
async function ready(f) { await settle(); assert.equal(f.state().status, 'p2p'); await f.clock.advance(2000); }
async function singleGapScenario(legacy = false, gap = 'pair-missing') {
  const f = fixture({ legacy });
  try {
    await ready(f); f.mode(gap); await f.clock.advance(500);
    assert.equal(f.state().status, 'p2p', 'one missing selected-pair stats sample must retain fresh decoded audio');
    const observation = f.peers[0].getReceiveObservation();
    assert.equal(observation.transportPath.classification, 'unknown', 'continuity never upgrades unknown path');
    assert.equal(observation.decode.fresh, true);
    const diagnostic = f.peerMediaDiagnostic(observation);
    assert.equal(diagnostic.pathReason, 'pair-unavailable');
    assert.equal(diagnostic.pairUnavailableReason, gap === 'pair-missing' ? 'pair-record-unavailable' : 'transport-unavailable');
    assert.equal(JSON.stringify(diagnostic).includes('192.0.2.'), false);
    f.mode('selected'); await f.clock.advance(1000);
    assert.equal(f.state().status, 'p2p'); assert.equal(f.peers.length, 1, 'same peer survives transient gap');
    assert.equal(f.gates.filter(request => request.enabled).length, 0, 'no SFU rebuild on one stats gap');
  } finally { f.controller.dispose(); }
}
await singleGapScenario();
await singleGapScenario(false, 'transport-missing');
await singleGapScenario(false, 'selected-id-missing');
for (const mode of ['pair-missing', 'transport-missing']) {
  const f = fixture(); try {
    await ready(f); const before = f.clock.now(); f.mode(mode); await f.clock.advance(1000);
    assert.equal(f.state().status, 'p2p', 'absence inside bounded grace retains audio');
    await f.clock.advance(500);
    assert.equal(f.state().status, 'sfu', 'persistent unknown must restore SFU within bounded grace');
    assert.equal(f.state().reason, 'peer_path_changed'); assert.equal(f.peers[0].pc.connectionState, 'closed');
    assert.ok(f.gates.some(request => request.enabled)); assert.equal(f.clock.now() - before, 1500);
  } finally { f.controller.dispose(); }
}
for (const mode of ['turn', 'et-relay', 'checking', 'failed', 'candidate-missing', 'new-pair-missing']) {
  const f = fixture(); try {
    await ready(f); f.mode(mode); await f.clock.advance(500);
    assert.equal(f.state().status, 'sfu', `${mode} must bypass missing-stats grace`);
  } finally { f.controller.dispose(); }
}
for (const mode of ['checking', 'failed']) {
  const f = fixture(); try {
    await ready(f); f.mode(mode);
    // Inspect the real parser before allowing the route monitor to close its PC.
    const report = await f.peers[0].pc.getStats();
    const path = f.readReceiveTransportPath(report, 'remote-track', f.clock.now() + 1);
    assert.equal(f.peerMediaDiagnostic({ transportPath: path }).pairUnavailableReason, 'pair-not-succeeded');
    assert.equal(path.classification, 'unknown');
  } finally { f.controller.dispose(); }
}
{
  const f = fixture({ initialMode: 'pair-missing' }); try {
    await settle(); assert.equal(f.state().status, 'sfu', 'unknown cannot initially admit peer');
    assert.equal(f.gates.filter(request => !request.enabled).length, 0);
  } finally { f.controller.dispose(); }
}
{
  const f = fixture(); try {
    await ready(f); f.mode('pair-missing'); f.stall(); await f.clock.advance(1000);
    assert.equal(f.state().status, 'sfu', 'no-decode increment cannot extend missing-path grace');
  } finally { f.controller.dispose(); }
}
{
  const f = fixture(); try {
    await ready(f); f.mode('pair-missing'); f.restoreFails(); await f.clock.advance(2500);
    assert.equal(f.state().status, 'recovering'); assert.equal(f.state().selected, 'p2p', 'failed SFU recovery retains healthy peer');
    assert.ok(f.gates.some(request => request.enabled));
    f.stall(); await f.clock.advance(4500);
    assert.equal(f.state().selected, 'none', 'actual media expiry closes failed peer while SFU retry remains');
  } finally { f.controller.dispose(); }
}
await assert.rejects(singleGapScenario(true), /one missing selected-pair stats sample/);
console.log('peer path gap: actual Peer/stats/controller, all 3 absence seams, unknown preserved, bounded expiry, relay/failure/decode bypass, SFU recovery and legacy red sensitivity passed; no real PC/network');
