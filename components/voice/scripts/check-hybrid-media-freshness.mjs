import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

// Current production TS, in memory: no frozen dist replacement or real browser/network.
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const settle = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
class Clock {
  time = 0; next = 0; jobs = new Map();
  now = () => this.time;
  schedule = (callback, delay) => { const id = ++this.next; this.jobs.set(id, { callback, at: this.time + delay }); return id; };
  cancel = id => this.jobs.delete(id);
  async advance(ms) {
    const end = this.time + ms;
    await settle();
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
const profile = { codec: 'opus', channels: 1, maxBitrateBps: 64000, packetTimeMs: 20, vbr: true, dtx: true, fec: true };
const scope = { serverInstanceId: 'server', roomId: 'room', roomGeneration: 'room-1', localParticipantId: 'local', localSessionId: 'session-local', canPublish: true, canReceive: true };
const person = { participantId: 'remote', sessionId: 'session-remote', publicationId: 'publication-remote', canSendAudio: true, canReceiveAudio: true };

const regressions = {
  staleCache: { file: 'BrowserHybridPeer.ts',
    before: 'performance.now() - candidate.observedAtMs <= maxAgeMs',
    after: 'performance.now() - candidate.observedAtMs <= HYBRID_MEDIA_HEALTH_MAX_AGE_MS' },
  probePollDeadline: { file: 'HybridRouteController.ts',
    before: 'route.peer.waitForMedia(), remaining',
    after: 'route.peer.waitForMedia(), this.options.pathMonitorMs' },
  switchPollDeadline: { file: 'HybridRouteController.ts',
    before: 'route.peer.waitForMedia(), this.options.switchTimeoutMs',
    after: 'route.peer.waitForMedia(), this.options.pathMonitorMs' },
};
function fixture({ statsDelayMs = 0, regression } = {}) {
  const clock = new Clock(), remoteTrack = track('remote-track'), remoteStream = stream(remoteTrack);
  class FakePc {
    connectionState = 'connected'; signalingState = 'stable';
    counters = { packets: 10, samples: 4800 }; statsSource = () => this.counters;
    parameters = { encodings: [{}], codecs: [{ mimeType: 'audio/opus' }] };
    addTrack(input) { this.sender = { track: input, getParameters: () => structuredClone(this.parameters), setParameters: async value => { this.parameters = value; } }; return this.sender; }
    async getStats() {
      // Snapshot the external stats response; reading it never emits RTP.
      const counts = { ...this.statsSource() };
      if (statsDelayMs) await new Promise(resolve => clock.schedule(resolve, statsDelayMs));
      return new Map([
        ['inbound', { id: 'inbound', type: 'inbound-rtp', kind: 'audio', trackIdentifier: remoteTrack.id, packetsReceived: counts.packets, totalSamplesReceived: counts.samples, transportId: 'transport' }],
        ['transport', { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' }],
        ['pair', { id: 'pair', type: 'candidate-pair', state: 'succeeded', localCandidateId: 'local', remoteCandidateId: 'remote' }],
        ['local', { id: 'local', type: 'local-candidate', candidateType: 'host', address: '192.0.2.1', port: 40000, protocol: 'udp' }],
        ['remote', { id: 'remote', type: 'remote-candidate', candidateType: 'host', address: '192.0.2.2', port: 40001, protocol: 'udp' }],
      ]);
    }
    close() { this.connectionState = 'closed'; }
  }
  const context = vm.createContext({ structuredClone, Map, Set, WeakMap, Promise,
    performance: { now: clock.now }, setTimeout: clock.schedule, clearTimeout: clock.cancel,
    RTCPeerConnection: FakePc, Audio: class { play() { return Promise.resolve(); } pause() {} remove() {} } });
  const modules = new Map();
  let mutations = 0;
  function loadSource(path) {
    if (modules.has(path)) return modules.get(path).exports;
    const module = { exports: {} }; modules.set(path, module);
    let source = readFileSync(path, 'utf8');
    if (regression && path.endsWith('/' + regression.file) || regression && path.endsWith('\\' + regression.file)) {
      assert.equal(source.split(regression.before).length - 1, 1, 'historical regression must alter exactly one production seam');
      source = source.replace(regression.before, regression.after); mutations++;
    }
    const output = ts.transpileModule(source, { fileName: path,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const run = vm.runInContext(`(function(exports, require, module) { ${output}\n})`, context, { filename: path });
    run(module.exports, name => {
      if (!name.startsWith('.')) throw Error(`unexpected production dependency: ${name}`);
      return loadSource(resolve(dirname(path), name + '.ts'));
    }, module);
    return module.exports;
  }
  const { BrowserHybridPeer } = loadSource(resolve(sourceRoot, 'webrtc/hybrid/BrowserHybridPeer.ts'));
  const { HybridRouteController } = loadSource(resolve(sourceRoot, 'webrtc/hybrid/HybridRouteController.ts'));
  assert.equal(mutations, regression ? 1 : 0, 'regression actually landed in the loaded source');
  const publicationTrack = track('publication'), publication = { stream: stream(publicationTrack), track: publicationTrack, generation: 1, publicationRevision: 1, publicationAcknowledged: true };
  const peers = [], failures = [];
  const makePeer = factory => {
    const peer = new BrowserHybridPeer(factory, { rtcConfiguration: { iceServers: [] }, microphoneCodec: profile,
      pathUnderlayResolver: { resolve: path => ({ source: 'host-underlay-resolver', classification: 'not-easytier', observedAtMs: path.observedAtMs }) } });
    peer.pc.ontrack({ track: remoteTrack, streams: [remoteStream] }); peers.push(peer); return peer;
  };
  const standalone = () => makePeer({ lease: { scope, remoteSessionId: person.sessionId, connectionId: 'standalone', initiator: false }, publication, participant: person, onSignal() {}, onFailure: reason => failures.push(reason) });
  return { clock, standalone, makePeer, HybridRouteController, publication, peers, failures, remoteTrack };
}

// The public proof request must wait when the last actual RTP sample is >500ms old.
async function cachedProofScenario(regression) {
  const f = fixture({ regression }), peer = f.standalone();
  try {
  await peer.start(); await settle();
  const first = await peer.waitForMedia(); assert.equal(first.observedAtMs, 0);
  await f.clock.advance(501);
  let resolved = false;
  const fresh = peer.waitForMedia().then(value => { resolved = true; return value; });
  await settle();
  assert.equal(resolved, false, 'fresh proof must not return a 501ms-old cached decode');
  const health = await peer.waitForMedia(3000);
  assert.equal(health.mediaSequence, first.mediaSequence, 'health reads keep the existing 3s tolerance');
  // Samples/concealment alone are not a new packet: remain pending.
  peer.pc.counters.samples += 480; await f.clock.advance(499);
  assert.equal(resolved, false, 'sample-only progress must not manufacture media proof');
  peer.pc.counters.packets++; peer.pc.counters.samples += 480; await f.clock.advance(500);
  const actual = await fresh;
  assert.equal(actual.observedAtMs, 1500); assert.equal(actual.mediaSequence, first.mediaSequence + 1);
  } finally { peer.dispose(); }
  assert.equal(f.clock.jobs.size, 0);
}
await cachedProofScenario();

// Real controller + real peer: quiet counters during path stabilization must
// await the next decode instead of returning a stale cache and aborting switch.
function controllerFixture({ packetsResumeAt = 1500, statsDelayMs = 0, pauseAckDelayMs = 0, controllerOptions = {}, regression } = {}) {
  const f = fixture({ statsDelayMs, regression }), selected = [], gates = [], sfuTrack = track('sfu');
  let sequence = 1;
  const port = { isCurrent: () => true, getSfuMediaSequence: () => sequence,
    waitForSfuMedia: async after => ({ track: sfuTrack, stream: stream(sfuTrack), decodedFrames: 1,
      mediaSequence: sequence = Math.max(sequence + 1, after + 1), observedAtMs: f.clock.now() }),
    select: kind => selected.push(kind) };
  const authority = { environment: 'simulation', capabilities: { protocolVersion: 1, authenticatedRoomSignals: true, pairForwardingLeases: true },
    isCurrent: () => true,
    leasePair: async () => ({ scope, remoteSessionId: person.sessionId, connectionId: 'controller-pair', initiator: false }),
    relay: async () => {}, releasePair() {}, subscribeSignals: () => () => {}, subscribeInvalidation: () => () => {},
    setForwarding: async request => {
      gates.push(request);
      if (!request.enabled && pauseAckDelayMs) await new Promise(resolve => f.clock.schedule(resolve, pauseAckDelayMs));
      return { ...request, applied: true, leaseRemainingMs: request.enabled ? 0 : request.pauseLeaseMs };
    } };
  const controller = new f.HybridRouteController({ clock: f.clock, authority, getPublication: () => f.publication,
    getReceivePort: () => port, createPeer: factory => {
      const peer = f.makePeer(factory);
      peer.pc.statsSource = () => f.clock.now() < packetsResumeAt ? { packets: 10, samples: 4800 } :
        { packets: 10 + Math.floor((f.clock.now() - packetsResumeAt) / 20) + 1, samples: 4800 + (Math.floor((f.clock.now() - packetsResumeAt) / 20) + 1) * 960 };
      return peer;
    } }, { enabled: true, ...controllerOptions });
  controller.reconcile(scope, [person]);
  return { ...f, controller, selected, gates };
}
{
  const f = controllerFixture(); await settle(); await f.clock.advance(1000);
  assert.equal(f.controller.getState().routes[0].status, 'probing', 'stability must wait for actual fresh proof');
  assert.equal(f.gates.length, 0, 'SFU forwarding stays enabled while media proof is pending');
  await f.clock.advance(500);
  assert.equal(f.controller.getState().routes[0].status, 'p2p', 'next real RTP increment completes the stable switch');
  assert.equal(f.gates.filter(request => !request.enabled).length, 1);
  await f.controller.restoreSfuAndDispose();
}
async function switchDeadlineScenario(regression) {
  // A pause ACK may outlive the cached proof. Its refresh uses the existing
  // switch budget, including a slow stats response, rather than one poll period.
  const f = controllerFixture({ packetsResumeAt: 1001, statsDelayMs: 20, pauseAckDelayMs: 501,
    controllerOptions: { pathStableMs: 0 }, regression });
  try {
  await settle(); await f.clock.advance(1100);
  assert.equal(f.controller.getState().routes[0].status, 'p2p', 'ACK refresh must wait for actual next media within the switch budget');
  assert.equal(f.gates.filter(request => !request.enabled).length, 1);
  await f.controller.restoreSfuAndDispose();
  } finally { f.controller.dispose(); }
}
await switchDeadlineScenario();
async function probeDeadlineScenario(regression) {
  // A 20ms stats response makes the next 500ms poll miss a 500ms proof-wait
  // deadline, even though real new RTP is decoded well inside the 3s health window.
  const f = controllerFixture({ packetsResumeAt: 1520, statsDelayMs: 20, regression });
  try {
  await settle(); await f.clock.advance(1600);
  assert.equal(f.controller.getState().routes[0].status, 'p2p', 'slow poll must use the probe budget, not the monitoring period');
  assert.equal(f.gates.filter(request => !request.enabled).length, 1);
  await f.controller.restoreSfuAndDispose();
  } finally { f.controller.dispose(); }
}
await probeDeadlineScenario();
{
  const f = controllerFixture({ packetsResumeAt: Infinity, controllerOptions: { probeTimeoutMs: 1500 } });
  await settle(); await f.clock.advance(1501);
  const state = f.controller.getState().routes[0];
  assert.equal(state.selected, 'sfu', 'missing fresh proof still falls back to SFU');
  assert.equal(state.status, 'sfu'); assert.equal(state.reason, 'operation_timeout');
  assert.equal(f.gates.filter(request => !request.enabled).length, 0, 'timeout never pauses the working SFU');
  f.controller.dispose();
}

// Run the SAME behavioral scenarios against known earlier failure modes in
// memory. A green current implementation alone cannot establish sensitivity.
await assert.rejects(cachedProofScenario(regressions.staleCache), /fresh proof must not return/);
await assert.rejects(probeDeadlineScenario(regressions.probePollDeadline), /slow poll must use the probe budget/);
await assert.rejects(switchDeadlineScenario(regressions.switchPollDeadline), /ACK refresh must wait for actual next media/);
console.log('hybrid media freshness: production Peer/controller cache, RTP-only progress, probe/switch deadlines and SFU preservation passed; all 3 historical regressions rejected in memory; no real PC/network');
