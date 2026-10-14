import assert from "node:assert/strict";
import { HybridRouteController } from "../dist/webrtc/hybrid/HybridRouteController.js";
import { HybridReceiveInput } from "../dist/webrtc/hybrid/HybridReceiveInput.js";

let assertions = 0;
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
const check = (value, message) => { assert.ok(value, message); assertions++; };
const settle = async () => { for (let i = 0; i < 500; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
class Clock {
  time = 0; next = 0; jobs = new Map();
  now = () => this.time;
  schedule = (callback, delay) => { const handle = ++this.next; this.jobs.set(handle, { callback, time: this.time + delay }); return handle; };
  cancel = handle => this.jobs.delete(handle);
  async advance(ms) {
    const end = this.time + ms;
    await settle();
    for (let guard = 0; guard < 10000; guard++) {
      const entry = [...this.jobs].sort((a, b) => a[1].time - b[1].time)[0];
      if (!entry || entry[1].time > end) { this.time = end; await settle(); return; }
      this.time = entry[1].time; this.jobs.delete(entry[0]); entry[1].callback(); await settle();
    }
    throw new Error("fixture_timer_loop");
  }
}
let stoppedTracks = 0;
const track = name => ({ id: name, kind: "audio", readyState: "live", stop: () => { stoppedTracks++; } });
const stream = input => ({ getAudioTracks: () => [input] });
const scope = { serverInstanceId: "server-instance", roomId: "room", roomGeneration: "room-generation-1",
  localParticipantId: "local-user", localSessionId: "local-session", canPublish: true, canReceive: true };
const participant = number => ({ participantId: `user-${number}`, sessionId: `session-${number}`, publicationId: `mic-${number}`, canSendAudio: true, canReceiveAudio: true });

function fixture(options = {}, tweaks = {}) {
  const clock = new Clock(), ports = new Map(), peers = [], gates = [], events = [], leases = [], releases = [], signals = [];
  const publicationTrack = track("protected-final-publication");
  let publication = { stream: stream(publicationTrack), track: publicationTrack, generation: 1, publicationRevision: 1, publicationAcknowledged: true };
  let signalListener = () => {}, invalidation = () => {}, current = true, subscriptionCount = 0;
  const pathObservation = (input, at, overrides = {}) => {
    const classification = overrides.classification ?? "non-turn-candidate";
    const underlayClass = Object.prototype.hasOwnProperty.call(overrides, "underlay") ? overrides.underlay : "not-easytier";
    const pairId = overrides.pairId ?? `pair-${input.id}`;
    const pathAt = Object.prototype.hasOwnProperty.call(overrides, "observedAtMs") ? overrides.observedAtMs : at;
    const underlayAt = Object.prototype.hasOwnProperty.call(overrides, "underlayObservedAtMs") ? overrides.underlayObservedAtMs : pathAt;
    const underlay = underlayClass === null ? null : { classification: underlayClass, source: "host-underlay-resolver", observedAtMs: underlayAt };
    const transportPath = { source: "rtc-selected-candidate-pair", observedAtMs: pathAt, classification,
      reason: classification === "turn-relay" ? "turn-relay" : classification === "unknown" ? "candidate-type-unknown" : "selected-pair",
      pairId, local: null, remote: null, underlay };
    return { trackId: input.id, observedAtMs: at, reason: null,
      decode: { startAtMs: Math.max(0, at - 20), endAtMs: at, packetsDelta: 1, samplesDelta: 480, decodedFramesDelta: 480, fresh: true, source: "rtc-inbound-rtp-totalSamplesReceived" },
      metrics: { selectedPairId: pairId, rttMs: null, rttWindow: null, rttSource: "rtc-selected-candidate-pair",
        lossFraction: null, lossWindow: null, lossSource: "exact-audio-track-inbound-rtp", path: {
          classification, pairId, localCandidateType: null, remoteCandidateType: null, underlay: underlayClass } }, transportPath };
  };
  // An evidence snapshot is immutable between emitted frames. A caller cannot
  // manufacture packet/decode progress merely by asking for it again.
  const makeMedia = (input, seq, path = {}) => {
    const at = clock.now(), observation = pathObservation(input, at, typeof path === "function" ? path() : path);
    return { track: input, stream: stream(input), decodedFrames: 128, mediaSequence: seq, observedAtMs: at,
      getReceiveObservation: () => structuredClone(observation) };
  };
  const getPort = person => {
    if (ports.has(person.participantId)) return ports.get(person.participantId);
    const input = track(`sfu-${person.publicationId}`);
    const port = {
      seq: 1, current: true, selected: "sfu", selectedTrack: input.id, revisions: [], sfuDeferred: null,
      isCurrent: () => port.current, getSfuMediaSequence: () => port.seq,
      waitForSfuMedia: after => {
        events.push(`fresh-request:${person.participantId}`);
        if (port.sfuDeferred) return port.sfuDeferred.promise;
        port.seq = Math.max(port.seq, after + 1); return Promise.resolve(makeMedia(input, port.seq));
      },
      select: (kind, candidate, revision) => {
        check(port.current, "selection requires current receive port");
        check(revision > (port.revisions.at(-1) ?? -1), "selection revision strictly increases");
        port.revisions.push(revision); port.selected = kind; port.selectedTrack = candidate?.track.id ?? null;
        events.push(`select:${kind}:${person.participantId}`);
      },
      input,
    };
    ports.set(person.participantId, port); return port;
  };
  const authority = {
    environment: tweaks.environment ?? "simulation",
    capabilities: tweaks.unsupported ? null : { protocolVersion: 1, authenticatedRoomSignals: true, pairForwardingLeases: true },
    isCurrent: value => current && value.serverInstanceId === scope.serverInstanceId,
    leasePair: (value, person) => {
      leases.push(person.participantId); events.push(`lease:${person.participantId}:${clock.now()}`);
      const lease = { scope: { ...value }, remoteSessionId: person.sessionId, connectionId: `server-pair-${leases.length}`, initiator: true };
      return tweaks.lease ? tweaks.lease(lease) : Promise.resolve(lease);
    },
    relay: async signal => { signals.push(signal); },
    setForwarding: request => {
      gates.push(request); events.push(`gate:${request.enabled}:${request.sourceParticipantId}`);
      const ack = { ...request, scope: { ...request.scope }, applied: true, leaseRemainingMs: request.enabled ? 0 : request.pauseLeaseMs };
      return tweaks.gate ? tweaks.gate(request, ack) : Promise.resolve(ack);
    },
    releasePair: lease => releases.push(lease.connectionId),
    subscribeSignals: callback => { signalListener = callback; subscriptionCount++; return () => { subscriptionCount--; }; },
    subscribeInvalidation: callback => { invalidation = callback; subscriptionCount++; return () => { subscriptionCount--; }; },
  };
  const dependencies = {
    authority: tweaks.noAuthority ? null : authority, clock,
    getPublication: () => publication, getReceivePort: getPort,
    createPeer: args => {
      check(args.publication.track === publication.track, "borrow exact final publication track");
      check(args.publication.stream === publication.stream, "borrow exact final publication stream");
      const mediaTrack = track(`p2p-${args.participant.publicationId}-${peers.length}`);
      const waiting = deferred();
      let peerPath = tweaks.peerPath ?? {};
      let frameTimer, latestMedia, mediaSequence = 0;
      const mediaWaiters = new Set();
      const emitFrame = () => {
        frameTimer = undefined;
        if (peer.disposed) return;
        if (peer.receiving) {
          latestMedia = makeMedia(mediaTrack, ++mediaSequence, peerPath);
          if (tweaks.noPathObservation) delete latestMedia.getReceiveObservation;
          for (const waiter of mediaWaiters) waiter(latestMedia);
          mediaWaiters.clear();
        }
        frameTimer = clock.schedule(emitFrame, 250);
      };
      const peer = {
        args, input: mediaTrack, waiting, disposed: false, receiving: true, accepted: [], metricCalls: 0,
        start: async () => { emitFrame(); args.onSignal({ kind: "offer", sdp: "v=0\r\n" }); },
        waitForMedia: (maxAgeMs = 500) => {
          if (tweaks.holdMedia) return waiting.promise;
          if (latestMedia && clock.now() - latestMedia.observedAtMs <= maxAgeMs) return Promise.resolve(latestMedia);
          return new Promise(resolve => mediaWaiters.add(resolve));
        },
        isReceiving: candidate => !peer.disposed && peer.receiving && candidate?.track === mediaTrack,
        acceptSignal: async body => { peer.accepted.push(body); },
        metrics: { source: "simulation", observedAtMs: 0, packetsSent: 0, payloadBytesSent: 0, headerBytesSent: null, totalEncodeTimeSeconds: null },
        readMetrics: async () => { peer.metricCalls++; return { ...peer.metrics }; },
        dispose: () => { peer.disposed = true; clock.cancel(frameTimer); mediaWaiters.clear(); events.push(`close:${args.participant.participantId}`); },
        setPath: value => { peerPath = value; },
      };
      peers.push(peer); return peer;
    },
  };
  const controller = new HybridRouteController(dependencies, { enabled: true, pathStableMs: 0, ...options });
  return { clock, controller, ports, peers, gates, leases, releases, events, signals, authority, dependencies,
    reconcile: (people = [participant(1)], value = scope) => controller.reconcile(value, people),
    signal: signal => signalListener(signal), invalidate: () => invalidation(),
    setCurrent: value => { current = value; }, setPublication: value => { publication = value; },
    publication: () => publication, media: makeMedia, subscriptionCount: () => subscriptionCount };
}

// A fresh peer must already play before an arbitrarily delayed server pause ACK.
for (const ackDelay of [100, 750]) {
  const pending = deferred(); let pauseAck;
  const f = fixture({ pathStableMs: 1000 }, { gate: (request, ack) => {
    if (!request.enabled) { pauseAck = ack; return pending.promise; }
    return Promise.resolve(ack);
  } });
  f.reconcile(); await settle(); equal(f.ports.get("user-1").selected, "sfu");
  await f.clock.advance(1000);
  equal(f.ports.get("user-1").selected, "p2p", "local handoff precedes pause request/ACK");
  await f.clock.advance(ackDelay); pending.resolve(pauseAck); await settle();
  equal(f.controller.getState().routes[0].selected, "p2p", "slow ACK cannot invalidate a playing fresh peer");
  equal(f.controller.getState().routes[0].reason, null); f.controller.dispose(); await settle();
}
{
  const localHandoff = deferred();
  const f = fixture(); const port = f.dependencies.getReceivePort(participant(1));
  port.waitForSelection = () => localHandoff.promise;
  f.reconcile(); await settle(); equal(f.gates.length, 0, "no server pause until local audio handoff completes");
  f.invalidate(); await settle(); localHandoff.resolve(); await settle();
  equal(port.selected, "none", "revocation disconnects immediately during a local fade");
  equal(f.gates.filter(request => !request.enabled).length, 0); f.controller.dispose();
}
{
  const handoff = deferred(); const f = fixture();
  const port = f.dependencies.getReceivePort(participant(1));
  port.waitForSelection = () => handoff.promise;
  f.reconcile(); await settle(); equal(f.gates.length, 0);
  await f.clock.advance(750); handoff.resolve(); await settle();
  equal(port.selected, "p2p"); equal(f.controller.getState().routes[0].reason, null);
  equal(f.gates.filter(request => !request.enabled).length, 1, "refresh media after local handoff before pause");
  f.controller.dispose(); await settle();
}
{
  const handoff = deferred(); const f = fixture();
  const port = f.dependencies.getReceivePort(participant(1));
  port.waitForSelection = () => port.selected === "p2p" ? handoff.promise : Promise.resolve();
  f.reconcile(); await settle(); equal(f.gates.length, 0);
  f.peers[0].receiving = false; f.peers[0].args.onFailure("failed before server pause"); await settle();
  equal(port.selected, "sfu", "lost peer during local handoff still restores fresh SFU before any pause");
  equal(f.gates.map(request => request.enabled), [true]); equal(f.peers[0].disposed, true);
  handoff.resolve(); await settle(); equal(port.selected, "sfu", "late local completion cannot reselect the old peer");
  f.controller.dispose(); await settle(); equal(f.clock.jobs.size, 0);
}
{
  const pause = deferred(), restore = deferred(); let restores = 0, latePause;
  const f = fixture({ switchTimeoutMs: 100 }, { gate: (request, ack) => {
    if (!request.enabled) { latePause = ack; return pause.promise; }
    return ++restores === 1 ? restore.promise : Promise.resolve(ack);
  } });
  f.reconcile(); await settle(); equal(f.ports.get("user-1").selected, "p2p");
  await f.clock.advance(101); equal(f.controller.getState().routes[0].status, "recovering");
  equal(f.ports.get("user-1").selected, "p2p", "pause timeout keeps independently verified audio");
  await f.clock.advance(101); equal(f.peers[0].disposed, false, "restore timeout keeps healthy peer");
  equal(f.ports.get("user-1").selected, "p2p");
  pause.resolve(latePause); await settle(); equal(f.controller.getState().routes[0].forwardingPaused, false);
  await f.clock.advance(1000); equal(f.ports.get("user-1").selected, "sfu");
  equal(f.peers[0].disposed, true); f.controller.dispose(); await settle(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture(); f.reconcile(); await settle(); const port = f.ports.get("user-1");
  const completed = deferred(); port.waitForSelection = () => completed.promise;
  const restoring = f.controller.fallback("user-1"); await settle();
  equal(port.selected, "sfu"); equal(f.peers[0].disposed, false, "do not close outgoing peer before SFU local fade completes");
  f.peers[0].args.onFailure("old peer failed during fresh SFU fade"); await settle();
  equal(port.selected, "sfu", "failed outgoing peer must not clear verified incoming SFU");
  completed.resolve(); await restoring; equal(f.peers[0].disposed, true);
  f.controller.dispose(); await settle(); equal(f.clock.jobs.size, 0);
}

for (const tweaks of [{ noAuthority: true }, { unsupported: true }, { environment: "network" }]) {
  const f = fixture({}, tweaks); f.reconcile(); await settle();
  equal(f.controller.getState().status, "unsupported"); equal(f.peers.length, 0); equal(f.leases.length, 0);
  equal(f.gates.length, 0); equal(f.subscriptionCount(), 0); f.controller.dispose();
}
{
  const f = fixture({ enabled: false }); f.reconcile(); await settle();
  equal(f.controller.getState().status, "disabled"); equal(f.leases.length, 0); equal(f.gates.length, 0); f.controller.dispose();
}
{
  const f = fixture(); f.reconcile(); await settle();
  equal(f.controller.getState().routes[0].status, "p2p"); equal(f.ports.get("user-1").selected, "p2p");
  equal(f.gates[0].enabled, false); equal(f.gates[0].pairConnectionId, "server-pair-1");
  equal(f.controller.getState().routes[0].forwardingPaused, true);
  check(f.events.indexOf("select:p2p:user-1") < f.events.indexOf("gate:false:user-1"), "local direct handoff precedes SFU pause");
  equal(f.signals[0].connectionId, "server-pair-1"); equal(f.signals[0].sequence, 1);
  const peer = f.peers[0]; const base = { ...f.signals[0], sourceSessionId: "session-1", destinationSessionId: "local-session",
    body: { kind: "answer", sdp: "v=0" } };
  f.signal(base); f.signal(base); f.signal({ ...base, sequence: 2, roomGeneration: "old-room" });
  f.signal({ ...base, sequence: 2, sourceSessionId: "stranger" });
  f.signal({ ...base, sequence: 2, body: { kind: "offer", sdp: "x".repeat(65537) } });
  f.signal({ ...base, sequence: 2, body: { kind: "candidate", candidate: { candidate: "x".repeat(4097) } } });
  f.signal({ ...base, sequence: 2 }); await settle();
  equal(peer.accepted.length, 2); equal(f.controller.getState().rejectedSignals, 5);
  peer.args.onSignal({ kind: "offer", sdp: "offer" }); peer.args.onSignal({ kind: "candidate", candidate: null }); await settle();
  equal(f.signals.map(item => item.sequence), [1, 2, 3]);
  const port = f.ports.get("user-1"); port.sfuDeferred = deferred();
  const fallback = f.controller.fallback("user-1"); await settle();
  equal(port.selected, "p2p"); equal(f.controller.getState().routes[0].status, "recovering");
  equal(f.gates.at(-1).enabled, true); equal(peer.disposed, false);
  port.seq++; port.sfuDeferred.resolve(f.media(port.input, port.seq)); await fallback;
  equal(port.selected, "sfu"); equal(peer.disposed, true); equal(f.controller.getState().routes[0].forwardingPaused, false);
  check(f.events.indexOf("gate:true:user-1") < f.events.indexOf("fresh-request:user-1"), "restore ACK before fresh SFU evidence");
  check(f.events.indexOf("select:sfu:user-1") < f.events.indexOf("close:user-1"), "single input restoration before PC close");
  const before = f.controller.getState().routes[0].selectionRevision;
  f.controller.dispose(); await settle(); equal(f.clock.jobs.size, 0); equal(f.subscriptionCount(), 0);
  equal(port.selected, "sfu"); check(before > 0); equal(f.controller.getState().status, "disposed");
}
{
  const pause = deferred(); let sentAck;
  const f = fixture({}, { gate: (request, ack) => { if (!request.enabled) { sentAck = ack; return pause.promise; } return Promise.resolve(ack); } });
  f.reconcile(); await settle(); equal(f.controller.getState().routes[0].status, "switching");
  equal(f.ports.get("user-1").selected, "p2p"); equal(f.controller.getState().routes[0].forwardingPaused, false);
  const oldGeneration = f.controller.getState().routes[0].routeGeneration;
  f.reconcile([]); await settle(); pause.resolve(sentAck); await settle();
  equal(f.controller.getState().routes.length, 0); check(f.peers[0].disposed); check(f.gates.at(-1).routeGeneration > oldGeneration);
  equal(f.gates.at(-1).enabled, true); equal(f.ports.get("user-1").selected, "none");
  equal(f.events.filter(event => event.startsWith("select:p2p")).length, 1); f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
for (const patch of [{ operationId: "wrong" }, { pairConnectionId: "foreign-pair" }, { routeGeneration: -1 },
  { applied: false }, { leaseRemainingMs: 0 }, { enabled: true }, { destinationSessionId: "foreign-session" }]) {
  const f = fixture({}, { gate: (request, ack) => Promise.resolve(request.enabled ? ack : { ...ack, ...patch }) });
  f.reconcile(); await settle(); equal(f.ports.get("user-1").selected, "sfu"); equal(f.peers[0].disposed, true);
  equal(f.controller.getState().routes[0].reason, "forwarding_ack_mismatch");
  equal(f.events.filter(value => value.startsWith("select:p2p")).length, 1); f.controller.dispose();
}
{
  const f = fixture({}, { holdMedia: true }); f.reconcile(); await settle();
  f.peers[0].waiting.resolve({ ...f.media(f.peers[0].input, 1), decodedFrames: 0 }); await settle();
  equal(f.gates.length, 0); equal(f.controller.getState().routes[0].reason, "decoded_media_unavailable");
  f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture({ probeTimeoutMs: 100 }, { holdMedia: true }); f.reconcile(); await settle(); await f.clock.advance(101);
  equal(f.peers[0].disposed, true); equal(f.controller.getState().routes[0].reason, "operation_timeout");
  equal(f.ports.get("user-1").selected, "sfu"); f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture({ switchTimeoutMs: 100 }, { gate: (request, ack) => request.enabled ? Promise.reject(new Error("SECRET MUST NOT LEAK")) : Promise.resolve(ack) });
  f.reconcile(); await settle(); await f.controller.fallback("user-1");
  equal(f.controller.getState().routes[0].status, "recovering"); equal(f.controller.getState().routes[0].reason, "restore_failed");
  equal(f.ports.get("user-1").selected, "p2p"); await f.clock.advance(10001);
  equal(f.controller.getState().routes[0].forwardingPaused, false);
  f.peers[0].receiving = false; f.peers[0].args.onFailure("failed"); await settle();
  equal(f.ports.get("user-1").selected, "none"); equal(f.peers[0].disposed, true); f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture(); f.reconcile(); await settle();
  await f.clock.advance(3400); check(f.gates.filter(request => !request.enabled).length >= 2, "renewal uses acknowledged server pause lease");
  f.invalidate(); await settle(); equal(f.peers[0].disposed, true); equal(f.ports.get("user-1").selected, "none");
  equal(f.controller.getState().routes.length, 0); equal(f.controller.getState().reason, "authority_invalidated");
  f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture(); f.reconcile(); await settle(); const port = f.ports.get("user-1"), old = f.controller.getState().routes[0];
  const replacement = track("final-publication-generation-2");
  f.setPublication({ ...f.publication(), track: replacement, stream: stream(replacement), generation: 2, publicationRevision: 2 });
  f.reconcile(); await settle(); await f.clock.advance(251);
  check(f.peers[0].disposed); equal(f.peers.at(-1).args.publication.track, replacement);
  equal(f.ports.get("user-1"), port, "retain physical manual/DSP route while changing protected publication");
  check(f.controller.getState().routes[0].routeGeneration > old.routeGeneration);
  check(f.controller.getState().routes[0].selectionRevision > old.selectionRevision);
  equal(port.selected, "p2p"); check(f.events.includes("select:sfu:user-1"), "replacement restores fresh SFU before a new probe");
  f.reconcile([participant(1)], { ...scope, canPublish: false }); await settle();
  equal(f.controller.getState().routes.length, 0); check(f.peers.every(peer => peer.disposed));
  equal(port.selected, "none"); equal(f.controller.getState().reason, "permission_unavailable");
  f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture(); f.reconcile(); await settle();
  equal(await f.controller.restoreSfuAndDispose(), true); equal(f.ports.get("user-1").selected, "sfu");
  equal(f.controller.getState().status, "disposed"); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture({}, { gate: (request, ack) => request.enabled ? Promise.reject(new Error("no ACK")) : Promise.resolve(ack) });
  f.reconcile(); await settle(); equal(await f.controller.restoreSfuAndDispose(), false);
  equal(f.controller.getState().reason, "sfu_restore_incomplete"); equal(f.ports.get("user-1").selected, "p2p");
  f.controller.dispose(); equal(f.ports.get("user-1").selected, "none"); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture({}, { holdMedia: true }); f.reconcile(Array.from({ length: 20 }, (_, index) => participant(index + 1)));
  await settle(); equal(f.peers.length, 1); await f.clock.advance(250); equal(f.peers.length, 2);
  equal(f.controller.getState().concurrentProbes, 2); equal(f.controller.getState().queuedProbes, 17);
  equal(f.controller.getState().routes.at(-1).reason, "peer_limit");
  f.controller.setProbeAdmission(false, "uplink_budget");
  for (const peer of f.peers) peer.waiting.resolve(f.media(peer.input, 1)); await settle(); await f.clock.advance(1000);
  equal(f.peers.length, 2); equal(f.controller.getState().reason, "uplink_budget");
  f.controller.setProbeAdmission(true); await settle(); equal(f.peers.length, 3);
  f.controller.dispose(); await settle(); equal(f.controller.getState().concurrentProbes, 0); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture(); f.reconcile(Array.from({ length: 20 }, (_, index) => participant(index + 1))); await settle(); await f.clock.advance(4600);
  equal(f.peers.length, 19); equal(f.controller.getState().peerConnections, 19); equal(f.controller.getState().concurrentProbes, 0);
  const admissions = f.events.filter(value => value.startsWith("lease:")).map(value => Number(value.split(":").at(-1)));
  check(admissions.slice(1).every((value, index) => value - admissions[index] >= 250), "probe starts paced by virtual clock");
  f.controller.dispose(); await settle(); check(f.peers.every(peer => peer.disposed)); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture(); f.reconcile(); await settle(); const peer = f.peers[0];
  let metrics = await f.controller.sampleMetrics(); equal(metrics.knownPayloadUplinkBps, null); equal(metrics.complete, false);
  await f.controller.sampleMetrics(); equal(peer.metricCalls, 1); await f.clock.advance(1000);
  peer.metrics = { ...peer.metrics, observedAtMs: 1000, packetsSent: 50, payloadBytesSent: 3000, headerBytesSent: null };
  metrics = await f.controller.sampleMetrics(); equal(metrics.knownPayloadUplinkBps, 24000); equal(metrics.knownPacketsPerSecond, 50);
  equal(metrics.knownEncoderCpuSecondsPerSecond, null); equal(metrics.knownHeaderUplinkBps, null); equal(metrics.complete, false);
  equal(metrics.environment, "simulation");
  await f.clock.advance(1000); peer.metrics = { ...peer.metrics, observedAtMs: 2000, packetsSent: 1, payloadBytesSent: 1 };
  metrics = await f.controller.sampleMetrics(); equal(metrics.knownPayloadUplinkBps, null); equal(metrics.knownPacketsPerSecond, null);
  f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const context = {}, downstream = { context }, active = new Set(), nodes = [], selections = [];
  const node = name => {
    const value = { name, context, failConnect: false, failDisconnect: false,
      connect: target => { equal(target, downstream); if (value.failConnect) throw new Error("connect_failed"); active.add(value); check(active.size <= 1, "one connected graph input at every operation"); },
      disconnect: target => { equal(target, downstream); if (value.failDisconnect) throw new Error("disconnect_failed"); active.delete(value); },
    }; nodes.push(value); return value;
  };
  const original = node("sfu"); original.connect(downstream); const input = track("sfu-track"); let current = true;
  const options = { sfuNode: original, downstream, sfuTrack: input, createCandidateNode: () => node("p2p"),
    isCurrent: () => current, getSfuMediaSequence: () => 1, waitForSfuMedia: async () => ({}),
    onSelection: (kind, trackId, revision) => selections.push({ kind, trackId, revision }) };
  const selector = new HybridReceiveInput(options), remote = track("p2p-track");
  const candidate = { track: remote, stream: stream(remote) };
  selector.select("p2p", candidate, 1); equal(active.size, 1); equal(selections.at(-1).trackId, remote.id);
  assert.throws(() => selector.select("sfu", undefined, 1), /stale_receive_selection/); assertions++;
  selector.select("sfu", undefined, 2); equal([...active], [original]);
  original.failDisconnect = true;
  assert.throws(() => selector.select("p2p", candidate, 3), /disconnect_failed/); assertions++;
  equal([...active], [original]);
  assert.throws(() => selector.select("p2p", candidate, 4), /disconnect_failed/); assertions++;
  equal([...active], [original]); original.failDisconnect = false;
  options.createCandidateNode = () => { const broken = node("broken"); broken.failConnect = true; return broken; };
  assert.throws(() => selector.select("p2p", candidate, 5), /connect_failed/); assertions++;
  equal(active.size, 0); equal(selections.at(-1).kind, "none"); selector.select("sfu", undefined, 6);
  current = false; selector.dispose(true); equal(active.size, 0); equal(selector.isCurrent(), false);
}
{
  const late = deferred(); let lease;
  const f = fixture({ probeTimeoutMs: 100 }, { lease: value => { lease = value; return late.promise; } });
  f.reconcile(); await settle(); await f.clock.advance(101); equal(f.peers.length, 0);
  equal(f.controller.getState().routes[0].reason, "operation_timeout");
  late.resolve(lease); await settle(); equal(f.releases, [lease.connectionId]);
  equal(f.gates.length, 0); f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture({}, { lease: value => Promise.resolve({ ...value, remoteSessionId: "foreign-session" }) });
  f.reconcile(); await settle(); equal(f.peers.length, 0); equal(f.releases.length, 1);
  equal(f.controller.getState().routes[0].reason, "invalid_pair_lease"); f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const hold = deferred(); let ack;
  const f = fixture({}, { gate: (request, value) => { if (!request.enabled) { ack = value; return hold.promise; } return Promise.resolve(value); } });
  f.reconcile(); await settle(); await f.clock.advance(501);
  f.peers[0].waitForMedia = () => Promise.resolve({ ...f.media(f.peers[0].input, 1), observedAtMs: 0 });
  hold.resolve(ack); await settle();
  equal(f.controller.getState().routes[0].reason, "media_stale_before_switch");
  equal(f.ports.get("user-1").selected, "sfu"); equal(f.peers[0].disposed, true);
  f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture(); f.reconcile(); await settle(); const port = f.ports.get("user-1");
  port.sfuDeferred = deferred(); const fallback = f.controller.fallback("user-1"); await settle();
  f.peers[0].receiving = false; f.peers[0].args.onFailure("during recovery"); await settle();
  equal(port.selected, "none"); equal(f.peers[0].disposed, true);
  port.seq++; port.sfuDeferred.resolve(f.media(port.input, port.seq)); await fallback;
  equal(port.selected, "sfu"); equal(f.controller.getState().routes[0].status, "sfu");
  f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture(); f.reconcile(); await settle(); const port = f.ports.get("user-1");
  port.waitForSfuMedia = () => Promise.resolve(f.media(port.input, port.seq));
  await f.controller.fallback("user-1"); equal(f.controller.getState().routes[0].reason, "fresh_sfu_media_unavailable");
  equal(port.selected, "p2p"); f.controller.dispose(); equal(port.selected, "none"); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture(); const one = f.dependencies.getReceivePort(participant(1)); f.dependencies.getReceivePort = () => one;
  f.reconcile([participant(1), participant(2)]); await settle(); equal(f.controller.getState().routes.length, 1); equal(f.peers.length, 1);
  f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture(); f.reconcile([{ ...participant(1), canReceiveAudio: false }]); await settle();
  equal(f.peers.length, 0); equal(f.leases.length, 0);
  f.setPublication({ ...f.publication(), publicationAcknowledged: false }); f.reconcile(); await settle();
  equal(f.peers.length, 0); equal(f.controller.getState().reason, "protected_publication_unavailable"); f.controller.dispose();
}
{
  const f = fixture(); f.reconcile(); await settle(); const peer = f.peers[0], blocked = deferred();
  peer.acceptSignal = async body => { peer.accepted.push(body); await blocked.promise; };
  const base = { ...f.signals[0], sourceSessionId: "session-1", destinationSessionId: "local-session" };
  const body = { kind: "answer", sdp: "v=0", extra: "discard this field" };
  for (let sequence = 1; sequence <= 65; sequence++) f.signal({ ...base, sequence, body });
  body.sdp = "mutated after delivery"; await settle(); equal(peer.accepted.length, 1); equal(f.controller.getState().rejectedSignals, 1);
  blocked.resolve();
  for (let i = 0; i < 10 && peer.accepted.length < 64; i++) await settle();
  equal(peer.accepted.length, 64);
  equal(peer.accepted.at(-1), { kind: "answer", sdp: "v=0" }, "signal queues hold bounded canonical snapshots");
  for (let i = 0; i < 65; i++) peer.args.onSignal({ kind: "offer", sdp: "v=0", extra: "discard" });
  await settle(); equal(f.controller.getState().rejectedSignals, 2); equal(f.signals.length, 65);
  equal(f.signals.at(-1).body, { kind: "offer", sdp: "v=0" }); f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture(); f.reconcile(); await settle(); const peer = f.peers[0];
  peer.metrics = { ...peer.metrics, headerBytesSent: 0, totalEncodeTimeSeconds: 0 }; await f.controller.sampleMetrics();
  await f.clock.advance(1000); peer.metrics = { ...peer.metrics, observedAtMs: 1000, packetsSent: 50,
    payloadBytesSent: 3000, headerBytesSent: 1200, totalEncodeTimeSeconds: .02 };
  const metrics = await f.controller.sampleMetrics(); equal(metrics.complete, true); equal(metrics.knownHeaderUplinkBps, 9600);
  equal(metrics.knownEncoderCpuSecondsPerSecond, .02); equal(metrics.environment, "simulation");
  await f.clock.advance(1000); const stuck = deferred(); peer.readMetrics = () => stuck.promise;
  const timed = f.controller.sampleMetrics(); await settle(); await f.clock.advance(1001); const missing = await timed;
  equal(missing.reportingPeers, 0); equal(missing.knownPayloadUplinkBps, null); equal(missing.complete, false);
  f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture(); f.reconcile(); await settle(); f.setCurrent(false); await f.clock.advance(3400);
  equal(f.controller.getState().routes.length, 0); equal(f.controller.getState().reason, "binding_stale");
  equal(f.peers[0].disposed, true); equal(f.ports.get("user-1").selected, "none"); f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture(); f.reconcile(); await settle(); f.peers[0].isReceiving = () => { throw new Error("closed PC"); };
  await f.clock.advance(3400); equal(f.controller.getState().routes[0].status, "sfu");
  equal(f.ports.get("user-1").selected, "sfu"); equal(f.peers[0].disposed, true); f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture(); f.reconcile(); await settle(); const port = f.ports.get("user-1");
  port.sfuDeferred = deferred(); const first = f.controller.fallback("user-1"); await settle();
  const same = f.controller.fallback("user-1"); equal(first, same, "single flight recovery");
  let stopped = false; const disable = f.controller.restoreSfuAndDispose().then(value => { stopped = value; });
  await settle(); f.reconcile(); equal(f.controller.getState().routes.length, 1);
  equal(stopped, false); equal(port.selected, "p2p");
  port.seq++; port.sfuDeferred.resolve(f.media(port.input, port.seq)); await disable;
  equal(stopped, true); equal(port.selected, "sfu"); equal(f.controller.getState().status, "disposed"); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture(); f.reconcile(); await settle(); f.ports.get("user-1").getSfuMediaSequence = () => NaN;
  await f.controller.fallback("user-1"); equal(f.controller.getState().routes[0].reason, "invalid_sfu_media_sequence");
  equal(f.ports.get("user-1").selected, "p2p"); f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture({}, { lease: value => Promise.resolve({ ...value, initiator: false }) }); f.reconcile(); await settle();
  equal(f.peers[0].args.lease.initiator, false); equal(f.signals.length, 0); equal(f.controller.getState().rejectedSignals, 1);
  f.peers[0].args.onSignal({ kind: "answer", sdp: "v=0" }); await settle(); equal(f.signals.length, 1);
  const base = { ...f.signals[0], sourceSessionId: "session-1", destinationSessionId: "local-session" };
  f.signal({ ...base, sequence: 1, body: { kind: "offer", sdp: "v=0" } });
  f.signal({ ...base, sequence: 2, body: { kind: "answer", sdp: "v=0" } }); await settle();
  equal(f.peers[0].accepted.length, 1); equal(f.controller.getState().rejectedSignals, 2);
  f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
equal(stoppedTracks, 0, "no capture track is stopped or acquired by the prototype");
{
  const f=fixture();f.reconcile();await settle();const first=f.peers[0];
  for(const revision of [2,3,4,8]){f.setPublication({...f.publication(),publicationRevision:revision});f.reconcile();await settle();}
  equal(f.peers.length,1,"gate ACK revisions do not recreate the peer");equal(first.disposed,false);equal(f.ports.get("user-1").selected,"p2p");
  f.controller.dispose();equal(f.clock.jobs.size,0);
}
{
  const f = fixture(); f.reconcile(); await settle();
  const firstOffer = f.signals[0]; equal(firstOffer.connectionId, "server-pair-1"); equal(firstOffer.sequence, 1);
  f.signal({ ...firstOffer, sourceSessionId: "session-1", destinationSessionId: "local-session", sequence: 1, body: { kind: "answer", sdp: "v=0" } }); await settle();
  await f.controller.fallback("user-1"); await settle(); await f.clock.advance(15000); await settle();
  const secondPeer = f.peers.at(-1), secondOffer = f.signals.at(-1);
  equal(secondOffer.connectionId, "server-pair-2"); equal(secondOffer.sequence, 1, "a new pair starts its offer sequence at one");
  const rejected = f.controller.getState().rejectedSignals;
  f.signal({ ...firstOffer, sourceSessionId: "session-1", destinationSessionId: "local-session", sequence: 2, body: { kind: "answer", sdp: "old-pair-replay" } }); await settle();
  equal(f.controller.getState().rejectedSignals, rejected + 1, "signals from the retired pair are rejected");
  f.signal({ ...secondOffer, sourceSessionId: "session-1", destinationSessionId: "local-session", sequence: 1, body: { kind: "answer", sdp: "v=0" } }); await settle();
  equal(secondPeer.accepted.length, 1, "the first answer on the new pair is accepted");
  f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture({}, { lease: value => Promise.resolve({ ...value, connectionId: "reused-pair" }) }); f.reconcile(); await settle();
  const firstOffer = f.signals[0]; equal(firstOffer.connectionId, "reused-pair"); equal(firstOffer.sequence, 1);
  f.signal({ ...firstOffer, sourceSessionId: "session-1", destinationSessionId: "local-session", sequence: 1, body: { kind: "answer", sdp: "v=0" } }); await settle();
  await f.controller.fallback("user-1"); await settle(); await f.clock.advance(15000); await settle();
  const secondPeer = f.peers.at(-1), secondOffer = f.signals.at(-1);
  equal(secondOffer.connectionId, "reused-pair"); equal(secondOffer.sequence, 2, "same-pair reconnect retains the outgoing sequence");
  const rejected = f.controller.getState().rejectedSignals;
  f.signal({ ...firstOffer, sourceSessionId: "session-1", destinationSessionId: "local-session", sequence: 1, body: { kind: "answer", sdp: "replayed" } }); await settle();
  equal(f.controller.getState().rejectedSignals, rejected + 1, "same-pair replay at the old sequence is rejected");
  f.signal({ ...secondOffer, sourceSessionId: "session-1", destinationSessionId: "local-session", sequence: 2, body: { kind: "answer", sdp: "v=0" } }); await settle();
  equal(secondPeer.accepted.length, 1, "same-pair reconnect accepts the next sequence");
  f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture({ pathStableMs: 100, pathMonitorMs: 50 }); f.reconcile(); await settle();
  equal(f.gates.length, 0, "SFU stays active while the approved path stability window is open");
  equal(f.controller.getState().routes[0].status, "probing"); await f.clock.advance(99);
  equal(f.gates.length, 0); await f.clock.advance(1); await settle();
  equal(f.gates.length, 1); equal(f.controller.getState().routes[0].status, "p2p");
  f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
for (const underlay of ["unknown", "easytier-relay", null]) {
  const f = fixture({}, { peerPath: { underlay } }); f.reconcile(); await settle();
  equal(f.gates.length, 0, `${underlay ?? "null"} underlay cannot pause healthy SFU`);
  equal(f.controller.getState().routes[0].status, "sfu");
  equal(f.controller.getState().routes[0].reason, "peer_path_not_admitted");
  equal(f.peers[0].disposed, true); await f.clock.advance(14999); equal(f.peers.length, 1);
  await f.clock.advance(1); await settle(); equal(f.peers.length, 2, "failed probe is retried after 15 seconds");
  f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture({}, { peerPath: { underlay: "not-easytier", underlayObservedAtMs: Number.NaN } });
  f.reconcile(); await settle();
  equal(f.gates.length, 0, "NaN underlay evidence cannot pause healthy SFU");
  equal(f.controller.getState().routes[0].reason, "peer_path_not_admitted");
  f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture({ pathMonitorMs: 100 }); f.reconcile(); await settle();
  equal(f.controller.getState().routes[0].status, "p2p");
  f.peers[0].setPath({ underlay: "not-easytier", underlayObservedAtMs: 0 });
  await f.clock.advance(3100); await settle();
  equal(f.controller.getState().routes[0].status, "sfu", "stale underlay evidence restores SFU");
  equal(f.ports.get("user-1").selected, "sfu"); f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture({}, { peerPath: { underlay: "unknown" } }); f.reconcile(); await settle();
  equal(f.peers.length, 1); f.controller.setProbeAdmission(false, "uplink_budget");
  await f.clock.advance(15000); await settle();
  equal(f.peers.length, 1, "a retry timer remains pending while probe admission is closed");
  f.controller.setProbeAdmission(true); await settle();
  for (const delay of [30000, 60000, 60000, 60000]) { await f.clock.advance(delay); await settle(); }
  equal(f.peers.length, 5, "reprobe continues after the fourth attempt with a capped interval");
  equal(f.controller.getState().routes[0].status, "sfu"); f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture({}, { noPathObservation: true }); f.reconcile(); await settle();
  equal(f.gates.length, 0, "missing path observation cannot silently become direct");
  equal(f.controller.getState().routes[0].reason, "peer_path_not_admitted"); f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture(); f.reconcile(); await settle(); equal(f.controller.getState().routes[0].status, "p2p");
  f.peers[0].setPath({ underlay: "easytier-relay" }); await f.clock.advance(500); await settle();
  equal(f.controller.getState().routes[0].status, "sfu"); equal(f.ports.get("user-1").selected, "sfu");
  equal(f.gates.at(-1).enabled, true); equal(f.peers[0].disposed, true); f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
{
  const f = fixture({}, { gate: (request, ack) => request.enabled ? Promise.reject(new Error("restore unavailable")) : Promise.resolve(ack) });
  f.reconcile(); await settle(); f.peers[0].setPath({ underlay: "easytier-relay" }); await f.clock.advance(500); await settle();
  equal(f.controller.getState().routes[0].status, "recovering"); equal(f.peers[0].disposed, false);
  for (const delay of [1000, 2000, 4000, 8000]) { await f.clock.advance(delay); await settle(); }
  equal(f.gates.filter(request => request.enabled).length, 5, "restore retries are bounded to five attempts before cooldown");
  equal(f.peers[0].disposed, false, "a healthy peer is retained while SFU restoration is failing");
  await f.clock.advance(59999); equal(f.gates.filter(request => request.enabled).length, 5);
  await f.clock.advance(1); await settle(); equal(f.gates.filter(request => request.enabled).length, 6, "cooldown resumes recovery instead of permanent failure");
  f.controller.dispose(); equal(f.clock.jobs.size, 0);
}
console.log(JSON.stringify({ kind: "pure-simulation", assertions, result: "pass", actualPeerConnections: 0,
  realAuthentication: false, realSfuGate: false, realNetwork: false, maximumSimulatedPeers: 19 }, null, 2));
