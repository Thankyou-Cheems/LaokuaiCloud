import assert from 'node:assert/strict';
import net from 'node:net';
import dgram from 'node:dgram';
net.Server.prototype.listen = net.Socket.prototype.connect = dgram.createSocket = () => { throw Error('network_prohibited'); };
globalThis.fetch = () => { throw Error('network_prohibited'); };
globalThis.RTCPeerConnection = class { constructor() { throw Error('actual_peer_prohibited'); } };
const base = process.env.HYBRID_AUTH_BASE_URL ?? new URL('../dist/webrtc/hybrid/', import.meta.url).href;
const { BrowserHybridVoiceSession } = await import(new URL('BrowserHybridVoiceSession.js', base));
const { HybridRouteController } = await import(new URL('HybridRouteController.js', base));
const { SocketHybridAuthority } = await import(new URL('SocketHybridAuthority.js', base));
const original = HybridRouteController.prototype.reconcile;
let assertions = 0, stopped = 0;
const eq = (a, b) => { assert.deepEqual(a, b); assertions++; };
const reject = async (p, pattern) => { await assert.rejects(p, pattern); assertions++; };
const settle = async () => { for (let n = 0; n < 150; n++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const track = id => ({ id, kind: 'audio', enabled: true, readyState: 'live', stop() { stopped++; } });
const stream = t => ({ getTracks: () => [t], getAudioTracks: () => [t] });
const scope0 = { serverInstanceId: 'instance', roomId: 'room', roomGeneration: 'epoch',
  localParticipantId: 'local', localSessionId: 'socket', canPublish: true, canReceive: true };
const participant = n => ({ participantId: `remote-${n}`, sessionId: `session-${n}`,
  publicationId: `publication-${n}`, canSendAudio: true, canReceiveAudio: true });
// In-memory ownership CAS: an unbound cleanup conflicts while another active pair owns this publication.
class Socket {
  id = 'socket'; connected = true; scope = { ...scope0 }; authenticated = true;
  participants; listeners = new Map(); commands = []; pairs = new Map(); owners = new Map(); next = 0;
  releaseFailures = 0; releaseBarrier; forwardBarrier;
  cleanupConflicts = 0;
  constructor(participants = [participant(0)]) { this.participants = participants; }
  on(e, f) { const listeners = this.listeners.get(e) ?? new Set(); listeners.add(f); this.listeners.set(e, listeners); }
  off(e, f) { this.listeners.get(e)?.delete(f); }
  emit(e) { for (const f of this.listeners.get(e) ?? []) f(); }
  timeout() { return { emitWithAck: (e, p) => this.reply(e, p) }; }
  async reply(event, payload) {
    this.commands.push({ event, payload });
    if (!this.authenticated) return { v: 1, status: 'failed', error: 'hybrid_unauthenticated' };
    if (event === 'voice:hybrid:scope') return { v: 1, status: 'supported', scope: { ...this.scope },
      participants: this.participants, capabilities: { protocolVersion: 1, authenticatedRoomSignals: true, pairForwardingLeases: true } };
    if (event === 'voice:hybrid:lease') {
      const lease = { connectionId: `server-minted-${++this.next}`, scope: payload.scope,
        remoteSessionId: payload.participant.sessionId, initiator: true };
      this.pairs.set(lease.connectionId, { lease, active: true });
      return { v: 1, status: 'leased', lease };
    }
    if (event === 'voice:hybrid:release') {
      if (this.releaseBarrier) await this.releaseBarrier.promise;
      if (this.releaseFailures-- > 0) return { v: 1, status: 'failed', error: 'hybrid_release_failed' };
      const pair = this.pairs.get(payload.lease.connectionId);
      if (!pair) return { v: 1, status: 'failed', error: 'hybrid_pair_stale' };
      pair.active = false;
      return { v: 1, status: 'released' };
    }
    if (event === 'voice:hybrid:forwarding') {
      if (this.forwardBarrier) await this.forwardBarrier.promise;
      const r = payload.request, pair = this.pairs.get(r.pairConnectionId), owner = this.owners.get(r.sourcePublicationId);
      if (r.pairConnectionId !== null && (!pair || !r.enabled && !pair.active)) return { v: 1, status: 'failed', error: 'hybrid_pair_stale' };
      if (pair && !pair.active && owner !== r.pairConnectionId || owner && owner !== r.pairConnectionId && this.pairs.get(owner)?.active) {
        this.cleanupConflicts++; return { v: 1, status: 'failed', error: 'hybrid_cleanup_conflict' };
      }
      // The server retains gate ownership after enable/release; a retired pair can restore only its own prior gate.
      this.owners.set(r.sourcePublicationId, r.pairConnectionId);
      return { v: 1, status: 'applied', ack: { ...r, applied: true, leaseRemainingMs: r.enabled ? 0 : 10000 } };
    }
    return { v: 1, status: 'relayed' };
  }
}
function fixture(count = 1) {
  const participants = Array.from({ length: count }, (_, n) => participant(n)), socket = new Socket(participants);
  const edges = new Set(), sources = new Map(), samples = new Map(), advance = new Set(participants.map(p => p.participantId));
  class Node {
    context = context;
    connect(to) { edges.add(this); return to; }
    disconnect() { edges.delete(this); }
  }
  const context = { createMediaStreamSource: () => new Node() };
  for (const p of participants) {
    const t = track(`sfu-${p.participantId}`), node = new Node(), analyser = new Node(), control = { current: true, listeners: new Set(),
      isCurrent() { return this.current; }, subscribeRetirement(f) { this.listeners.add(f); return () => this.listeners.delete(f); },
      retire() { this.current = false; for (const f of [...this.listeners]) f(); } };
    node.mediaStream = stream(t); node.connect(analyser); sources.set(p.participantId, { stream: node, analyser, receiveCleanup: control });
    samples.set(t.id, 0);
  }
  const final = track('protected-final'), pc = { connectionState: 'connected', getSenders: () => [{ track: final }],
    getStats: async () => new Map(participants.map(p => {
      const id = `sfu-${p.participantId}`, next = samples.get(id) + (advance.has(p.participantId) ? 1 : 0); samples.set(id, next);
      return [id, { type: 'inbound-rtp', kind: 'audio', trackIdentifier: id, packetsReceived: next, totalSamplesReceived: next * 480 }];
    })) };
  const microphone = { microphoneBuffer: { publicationStream: stream(final) },
    transmissionState: { publicationAcknowledged: true, publicationRevision: 1, generation: 1 } };
  const peers = [], selections = [];
  const f = { socket, edges, sources, advance, pc, microphone, peers, selections, final, current: true };
  let now = performance.now(), timerId = 0; const scheduled = new Map();
  const clock = { now: () => now, schedule(fn, delay) { const id = ++timerId; scheduled.set(id, { fn, at: now + delay }); return id; },
    cancel(id) { scheduled.delete(id); } };
  f.tick = ms => { now += ms; for (const [id, item] of [...scheduled]) if (item.at <= now) { scheduled.delete(id); item.fn(); } };
  HybridRouteController.prototype.reconcile = function (scope, roster) {
    this.clock = clock;
    this.dependencies.createPeer = args => {
      eq(args.publication.track, final);
      const t = track(`p2p-${args.participant.participantId}`), prior = peers.some(p => p.participantId === args.participant.participantId);
      const peer = { participantId: args.participant.participantId, disposed: false, start: async () => {}, acceptSignal: async () => {},
        waitForMedia: () => prior ? new Promise(() => {}) : Promise.resolve({ track: t, stream: stream(t),
          decodedFrames: 1, mediaSequence: 1, observedAtMs: clock.now(), getReceiveObservation: () => {
            const at = clock.now(), pairId = `pair-${t.id}`, underlay = { classification: 'not-easytier',
              source: 'host-underlay-resolver', observedAtMs: at };
            return { trackId: t.id, observedAtMs: at, reason: null, decode: null,
              metrics: { selectedPairId: pairId, rttMs: null, rttWindow: null, rttSource: 'rtc-selected-candidate-pair',
                lossFraction: null, lossWindow: null, lossSource: 'exact-audio-track-inbound-rtp',
                path: { classification: 'non-turn-candidate', pairId, localCandidateType: null,
                  remoteCandidateType: null, underlay: 'not-easytier' } },
              transportPath: { source: 'rtc-selected-candidate-pair', observedAtMs: at,
                classification: 'non-turn-candidate', reason: 'selected-pair', pairId, local: null, remote: null, underlay } };
          } }),
        isReceiving() { return !this.disposed; }, dispose() { this.disposed = true; }, readMetrics: async () => { throw Error('unused'); } };
      peers.push(peer); return peer;
    };
    return original.call(this, scope, roster);
  };
  f.session = new BrowserHybridVoiceSession({ enabled: true, allowNetwork: true, pathStableMs: 0, socket, getAccessToken: () => 'synthetic-only',
    expectedRoomId: 'room', rtcConfiguration: { iceServers: [] }, getPeerConnection: () => pc, getMicrophone: () => microphone,
    isCurrent: () => f.current, getSource: p => sources.get(p.participantId) ?? null,
    onSelection: (source, selected, revision) => selections.push({ source, selected, revision }) });
  f.pump = async () => { f.tick(300); await settle(); await f.session.monitor.read(); await settle(); };
  f.retire = () => { f.session.dispose(); eq([...socket.listeners.values()].reduce((n, s) => n + s.size, 0), 0); eq(peers.every(p => p.disposed), true); };
  return f;
}
async function start(f) {
  await f.session.update(); await settle();
  for (let n = 0; n < f.sources.size; n++) await f.pump();
  eq(f.session.getState().routing.routes.filter(r => r.selected === 'p2p').length, f.sources.size);
  eq(f.edges.size, f.sources.size);
}
async function revoke(f) {
  f.socket.authenticated = false; f.socket.emit('token:revoked'); await settle();
  eq(f.edges.size, 0); eq(f.session.getState().status, 'recovering');
  await f.session.update(); eq(f.session.getState().reason, 'hybrid_unauthenticated');
}
try {
  for (const count of [1, 3]) {
    const f = fixture(count);
    try {
      await start(f); await revoke(f);
      f.socket.authenticated = true; f.socket.participants.reverse();
      f.advance.clear(); const restoring = f.session.update(); await settle();
      const first = [...f.sources.keys()][0]; f.advance.add(first); await f.pump();
      if (count > 1) {
        eq(f.edges.size, 1); eq(f.session.getState().routing.routes.length, 1);
        eq(f.session.getState().routing.routes[0].selected, 'sfu');
        eq(f.peers.length, count); // No new probe before all old ownership is released and fresh inputs restored.
      }
      for (const id of f.sources.keys()) f.advance.add(id);
      for (let n = 0; n < count + 3; n++) await f.pump(); await restoring;
      const state = f.session.getState();
      if (state.status !== 'active') console.error(JSON.stringify({ kind: 'auth-recovery-model-failure', state,
        actualModelSelectedTrackIds: f.selections.slice(-count).map(s => s.selected?.id ?? null),
        physicalInputEdges: f.edges.size, cleanupConflicts: f.socket.cleanupConflicts }));
      eq(state.status, 'active'); eq(f.edges.size, count);
      for (const r of state.routing.routes) {
        const port = [...f.session.ports.values()].find(b => b.participant.participantId === r.participantId).port;
        eq(r.selected, 'sfu'); eq(r.selectedTrackId, port.getSelection().trackId); eq(r.selectionRevision, port.getSelectionRevision());
        eq(r.reason, null);
      }
      eq(f.socket.commands.filter(c => c.event === 'voice:hybrid:release').length, count);
      for (const p of f.socket.participants) {
        const restore = f.socket.commands.findIndex(c => c.event === 'voice:hybrid:forwarding' && c.payload.request.enabled &&
          c.payload.request.sourceParticipantId === p.participantId);
        const newLease = f.socket.commands.findIndex(c => c.event === 'voice:hybrid:lease' && c.payload.participant.participantId === p.participantId &&
          f.socket.commands.indexOf(c) > restore);
        eq(restore >= 0, true); if (newLease >= 0) eq(newLease > restore, true);
      }
      await f.session.setEnabled(false); eq(f.session.getState().status, 'disabled'); eq(f.edges.size, count);
    } finally { f.retire(); }
  }
  // A failed release remains pending; it must not permit a new lease or fabricate fresh media.
  {
    const f = fixture(); try {
      await start(f); await revoke(f); f.socket.authenticated = true; f.socket.releaseFailures = 1;
      await f.session.update(); eq(f.session.getState().reason, 'hybrid_release_failed'); eq(f.edges.size, 0); eq(f.peers.length, 1);
      const recovery = f.session.update(); for (let n = 0; n < 4; n++) await f.pump(); await recovery;
      eq(f.session.getState().routing.routes[0].selected, 'sfu'); eq(f.session.getState().status, 'active');
    } finally { f.retire(); }
  }
  // Revocation after the restore ACK cannot authorize the post-ACK fresh edge.
  {
    const f = fixture(); try {
      await start(f); await revoke(f); f.socket.authenticated = true; f.advance.clear();
      const recovery = f.session.update(); await settle();
      f.socket.emit('token:revoked'); await settle(); f.advance.add('remote-0'); await f.pump(); await recovery;
      eq(f.edges.size, 0); eq(f.session.getState().reason, 'stale_receive_selection');
      const retry = f.session.update(); for (let n = 0; n < 4; n++) await f.pump(); await retry;
      eq(f.edges.size, 1); eq(f.session.getState().routing.routes[0].selected, 'sfu');
    } finally { f.retire(); }
  }
  for (const fault of ['room-generation', 'closed-pc', 'retired-source']) {
    const f = fixture(); try {
      await start(f); await revoke(f); f.socket.authenticated = true; f.advance.clear();
      const recovery = f.session.update(); await settle();
      if (fault === 'room-generation') { f.socket.scope = { ...f.socket.scope, roomGeneration: 'new-epoch' }; f.socket.emit('voice:move:committed'); }
      if (fault === 'closed-pc') f.pc.connectionState = 'closed';
      if (fault === 'retired-source') f.sources.get('remote-0').receiveCleanup.retire();
      f.advance.add('remote-0'); await f.pump(); await recovery;
      eq(f.edges.size, 0); eq(f.selections.at(-1).selected, null);
      await f.session.update();
      if (fault !== 'retired-source') eq(f.session.getState().status, 'disposed');
    } finally { f.retire(); }
  }
  // Cleanup retry preserves a verified SFU edge, and repeated release is scoped/idempotent.
  {
    const socket = new Socket(), a = new SocketHybridAuthority(socket, () => 'synthetic-only');
    try {
      const { scope } = await a.refresh(), p = socket.participants[0], lease = await a.leasePair(scope, p);
      const request = { scope, pairConnectionId: lease.connectionId, sourceParticipantId: p.participantId,
        sourceSessionId: p.sessionId, sourcePublicationId: p.publicationId, destinationSessionId: scope.localSessionId,
        routeGeneration: 2, operationId: '2:1', enabled: true, pauseLeaseMs: 0 };
      await a.restoreForwarding(request); socket.releaseFailures = 1;
      await reject(a.retireRestoredPair(request), /hybrid_release_failed/);
      socket.emit('token:revoked'); await a.refresh(); await a.retireRestoredPair(request); await a.retireRestoredPair(request);
      eq(socket.commands.filter(c => c.event === 'voice:hybrid:forwarding').length, 1);
      eq(socket.commands.filter(c => c.event === 'voice:hybrid:release').length, 2);
      const other = await a.leasePair(scope, p); socket.pairs.delete(other.connectionId);
      await a.restoreForwarding({ ...request, pairConnectionId: other.connectionId });
      eq(socket.commands.filter(c => c.event === 'voice:hybrid:forwarding').at(-1).payload.request.pairConnectionId, null);
      const conflicting = await a.leasePair(scope, p); socket.owners.set(p.publicationId, conflicting.connectionId);
      await reject(a.restoreForwarding({ ...request, pairConnectionId: other.connectionId }), /hybrid_cleanup_conflict/);
      await reject(a.restoreForwarding({ ...request, scope: { ...scope, roomGeneration: 'old-room' } }), /hybrid_scope_stale/);
    } finally { a.dispose(); }
  }
  // Concurrent callers share one release ACK; stale ACKs never retire a replacement scope.
  {
    const socket = new Socket(), a = new SocketHybridAuthority(socket, () => 'synthetic-only');
    try {
      const { scope } = await a.refresh(), lease = await a.leasePair(scope, socket.participants[0]);
      socket.releaseBarrier = deferred(); const r1 = a.releasePair(lease), r2 = a.releasePair(lease); await settle();
      eq(socket.commands.filter(c => c.event === 'voice:hybrid:release').length, 1);
      socket.releaseBarrier.resolve(); await Promise.all([r1, r2]); await a.releasePair(lease);
      eq(socket.commands.filter(c => c.event === 'voice:hybrid:release').length, 1);
      const next = await a.leasePair(scope, socket.participants[0]); socket.releaseBarrier = deferred();
      const releasing = a.releasePair(next); await settle(); socket.emit('token:revoked');
      socket.releaseBarrier.resolve(); await reject(releasing, /hybrid_scope_stale/);
      socket.scope = { ...scope, roomGeneration: 'new-room' }; socket.releaseBarrier = undefined; await a.refresh();
      eq(socket.commands.filter(c => c.event === 'voice:hybrid:release').length, 2);
      eq(a.isCurrent(socket.scope), true);
    } finally { a.dispose(); }
  }
  eq(stopped, 0);
} finally { HybridRouteController.prototype.reconcile = original; }
console.log(JSON.stringify({ result: 'pass', kind: 'pure-auth-and-media-selection-state-machine', assertions,
  simulatedRemoteCounts: [1, 3], actualPeerConnections: 0, networkListeners: 0, realAuthentication: false,
  actualSfuGate: false, realCapture: false, physicalDirectVerified: false }, null, 2));
