// Actual SDK source observer/parser + client translator/store, fake PCs only.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import ts from "typescript";

let now = 1000, checks = 0, nextTimer = 0;
const timers = new Map();
const clock = { now: () => now, schedule: f => { const id = ++nextTimer; timers.set(id, f); return id; }, cancel: id => timers.delete(id) };
const client = new URL("../", import.meta.url), voice = new URL("../../voice/src/", import.meta.url);
const compile = (url, deps = {}) => {
  const out = ts.transpileModule(fs.readFileSync(url, "utf8"), { reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  assert.deepEqual(out.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), []);
  const exports = {};
  vm.runInNewContext(out.outputText, { exports, structuredClone, performance: { now: () => now },
    setTimeout: clock.schedule, clearTimeout: clock.cancel, require: key => { assert.ok(Object.hasOwn(deps, key), key); return deps[key]; } });
  return exports;
};
const stats = compile(new URL("webrtc/hybrid/receivePathStats.ts", voice));
const sdk = compile(new URL("webrtc/hybrid/ReceivePathObserver.ts", voice), { "./receivePathStats": stats });
const model = compile(new URL("src/lib/memberVoiceMediaPath.ts", client));
const storeModule = compile(new URL("src/lib/memberVoiceMediaStore.ts", client), { "./memberVoiceMediaPath": model });
const { MemberVoiceReceiveTranslator } = compile(new URL("src/lib/memberVoiceReceiveTranslator.ts", client), {
  "@gryt/voice": sdk, "./memberVoiceMediaStore": storeModule,
});
const { readVoiceLocalNetwork } = compile(new URL("src/lib/memberVoiceLocalNetwork.ts", client));
const test = async (name, fn) => { await fn(); checks++; console.log("PASS " + name); };
const track = () => { const listeners = new Set(); return { id: "track", kind: "audio", readyState: "live",
  addEventListener: (_event, f) => listeners.add(f), removeEventListener: (_event, f) => listeners.delete(f),
  end() { this.readyState = "ended"; for (const f of [...listeners]) f(); }, get listeners() { return listeners.size; } }; };
function fixture() {
  let active = true, deferred = null, packets = 100, samples = 48000, responses = 10, lost = 5, reads = 0;
  const retire = new Set(), inputTrack = track();
  const control = { isCurrent: () => active, subscribeRetirement: f => { retire.add(f); return () => retire.delete(f); } };
  const source = { receiveCleanup: control, stream: { mediaStream: { getTracks: () => [inputTrack] } } };
  const report = () => new Map([
    ["audio", { id: "audio", type: "inbound-rtp", kind: "audio", trackIdentifier: "track", transportId: "transport", packetsReceived: packets, totalSamplesReceived: samples, packetsLost: lost }],
    ["transport", { type: "transport", selectedCandidatePairId: "pair" }],
    ["pair", { type: "candidate-pair", id: "pair", state: "succeeded", responsesReceived: responses, currentRoundTripTime: 0 }],
  ]);
  const pc = { connectionState: "connected", getStats: () => { reads++; return deferred ?? Promise.resolve(report()); } };
  const c = { accountId: "account", host: "server", serverId: "stable-server", serverInstanceId: "instance", roomId: "room", localUserId: "self", localSessionId: "self-session",
    localPublicationId: null, socket: {}, peerConnection: pc, members: [{ userId: "remote", sessionId: "remote-session", publicationId: "publication", source: control }] };
  const host = { connection: c, connectionEpoch: stats.receiveConnectionEpoch(pc), bindings: [{ participantId: "remote", sessionId: "remote-session", publicationId: "publication", role: "microphone", source }], hybridScope: null };
  const sfu = { getPeerConnection: () => c.peerConnection, getConnectionEpoch: () => host.connectionEpoch, isConnected: true,
    currentServerConnected: "server", currentChannelConnected: "room", streamSources: { publication: source } };
  const store = new storeModule.MemberVoiceMediaStore(() => now);
  const translator = new MemberVoiceReceiveTranslator(store, { getSfu: () => sfu, getHost: () => active ? host : null, now: () => now, clock });
  translator.start();
  return { translator, store, source, control, pc, host, sfu, track: inputTrack, report,
    path() { const snapshot = store.getSnapshot(); return model.readMemberVoiceMediaPath({ ...snapshot.entries[0], nowMs: snapshot.nowMs }); },
    advance() { now += 1000; packets += 50; samples += 48000; responses++; },
    async fresh() { await translator.observer.sample(); this.advance(); await translator.observer.sample(); },
    defer(value) { deferred = value; }, setCounters(p, s, l = lost, r = responses) { packets = p; samples = s; lost = l; responses = r; },
    retire() { active = false; for (const f of [...retire]) f(); }, get reads() { return reads; }, get retireListeners() { return retire.size; },
    dispose() { translator.dispose(); assert.equal(retire.size, 0); assert.equal(inputTrack.listeners, 0); },
  };
}
const hybridBinding = f => ({ accountId: f.host.connection.accountId, host: f.host.connection.host,
  serverId: f.host.connection.serverId, roomId: f.host.connection.roomId, localUserId: f.host.connection.localUserId,
  localSessionId: f.host.connection.localSessionId, socket: f.host.connection.socket,
  peerConnection: f.host.connection.peerConnection, connectionEpoch: f.host.connectionEpoch });
function selectedPeer(f, instance = "opaque-runtime-instance") {
  delete f.host.connection.serverInstanceId;
  const scope = { serverInstanceId: instance, roomId: "room", roomGeneration: "opaque-A",
    localParticipantId: "self", localSessionId: "self-session", canReceive: true, canPublish: false };
  f.host.hybridScope = scope; f.host.hybridBinding = hybridBinding(f);
  let selection = { current: true, kind: "p2p", track: f.track, revision: 1, routeGeneration: 7,
    status: "active", reason: null, hybridScope: scope,
    remoteIdentity: { participantId: "remote", sessionId: "remote-session", publicationId: "publication" } };
  let observation = null;
  f.source.receivePath = { getSelection: () => selection, getObservation: () => observation, subscribe: () => () => {} };
  f.translator.update();
  return {
    get selection() { return selection; }, set selection(v) { selection = v; },
    fresh() { f.advance(); observation = { trackId: "track", observedAtMs: now, reason: null,
      decode: { startAtMs: now - 1000, endAtMs: now, packetsDelta: 50, samplesDelta: 48000, decodedFramesDelta: 48000,
        fresh: true, source: "rtc-inbound-rtp-totalSamplesReceived" }, metrics: null }; f.translator.update(); },
  };
}
await test("trusted session context explicitly binds stable server ID to a different opaque runtime instance", async () => {
  for (const instance of ["stable-server:random-instance", "unrelated-opaque-runtime-id"]) {
    const f = fixture(), peer = selectedPeer(f, instance);
    assert.equal(f.store.getSnapshot().entries.length, 1);
    assert.equal(f.store.capture("remote-session").scope.serverInstanceId, instance);
    assert.equal(f.path().receive.mediaAvailable, false); peer.fresh();
    assert.equal(f.path().receive.selected, "peer"); assert.equal(f.path().receive.mediaAvailable, true);
    assert.equal(f.path().receive.reason, "underlay-unproven"); assert.equal(f.path().send.selected, "unknown"); f.dispose();
  }
});
await test("same stable server with a new runtime instance retires old leases and rejects old-instance callbacks", () => {
  const f = fixture(), peer = selectedPeer(f, "instance-A"); peer.fresh();
  const oldLease = f.store.capture("remote-session"), oldEvidence = f.store.getSnapshot().entries[0].evidence.receive;
  const oldSnapshot = f.translator.observer.getSnapshot();
  f.host.hybridScope = { ...f.host.hybridScope, serverInstanceId: "instance-B" };
  f.host.hybridBinding = hybridBinding(f); f.translator.update();
  assert.notEqual(f.store.capture("remote-session"), oldLease); assert.equal(f.store.acceptReceive(oldLease, oldEvidence), false);
  f.translator.accept(oldSnapshot); assert.notEqual(f.path().receive.mediaAvailable, true);
  peer.selection = { ...peer.selection, hybridScope: f.host.hybridScope }; f.translator.update();
  assert.notEqual(f.path().receive.mediaAvailable, true); peer.fresh();
  assert.equal(f.path().receive.mediaAvailable, true); assert.equal(f.store.capture("remote-session").scope.serverInstanceId, "instance-B"); f.dispose();
});
await test("session binding requires exact stable server, account, host, socket, PC, epoch, room and local member", () => {
  for (const [field,value] of [["serverId", "stable-server-other"], ["accountId", "other-account"], ["host", "other-host"],
    ["socket", {}], ["peerConnection", {}], ["connectionEpoch", 99], ["roomId", "other-room"],
    ["localUserId", "other-user"], ["localSessionId", "other-session"]]) {
    const f = fixture(), peer = selectedPeer(f); peer.fresh();
    f.host.hybridBinding = { ...f.host.hybridBinding, [field]: value }; f.translator.update();
    assert.equal(f.store.getSnapshot().entries.length, 0); f.dispose();
  }
  const f = fixture(); selectedPeer(f); delete f.host.hybridBinding; f.translator.update();
  assert.equal(f.store.getSnapshot().entries.length, 0); f.dispose();
});
await test("room change and old connection epoch flights cannot revive a registered Hybrid proof", async () => {
  for (const change of [f => { f.host.connection.roomId = "next-room"; }, f => { f.host.connectionEpoch++; }]) {
    const f = fixture(), peer = selectedPeer(f); peer.fresh();
    const old = f.translator.observer.getSnapshot(); let resolve; f.defer(new Promise(r => { resolve = r; }));
    const flight = f.translator.observer.sample(); change(f); f.translator.update(); resolve(f.report()); await flight;
    f.translator.accept(old); assert.equal(f.store.getSnapshot().entries.length, 0); f.dispose();
  }
});
await test("remote user, session or publication substitution cannot borrow another member's valid P2P proof", () => {
  for (const field of ["participantId", "sessionId", "publicationId"]) {
    const f = fixture(), peer = selectedPeer(f); peer.fresh();
    peer.selection = { ...peer.selection, remoteIdentity: { ...peer.selection.remoteIdentity, [field]: "someone-else" } };
    f.translator.update(); assert.equal(f.store.getSnapshot().entries[0].evidence, undefined); f.dispose();
  }
});
await test("ordinary SFU receive-only keeps logical selection but first report is never decoded proof", async () => {
  const f = fixture(); assert.equal(f.path().receive.selected, "sfu"); assert.equal(f.path().receive.mediaAvailable, false);
  await f.translator.observer.sample(); assert.equal(f.path().receive.mediaAvailable, false); f.dispose();
});
await test("two exact-track reports produce SFU decode, no send receipt, details opt-in preserves measured zero RTT/loss", async () => {
  const f = fixture(); await f.fresh(); assert.equal(f.path().receive.label, "server-relay"); assert.equal(f.path().receive.mediaAvailable, true);
  assert.equal(f.path().receive.rttMs, null); const close = f.translator.requestDetails();
  assert.equal(f.path().receive.rttMs, 0); assert.equal(f.path().receive.lossPercent, 0); assert.equal(f.path().receive.lossWindowMs, 1000);
  assert.equal(f.path().receive.metricsAgeMs, 0); assert.equal(f.path().send.reason, "missing");
  const reads = f.reads; close(); assert.equal(f.reads, reads); assert.equal(f.path().receive.rttMs, null); f.dispose();
});
await test("performance clock and Unix clock cannot substitute for each other", async () => {
  const f = fixture(); await f.fresh(); const row = f.store.getSnapshot().entries[0].evidence.receive;
  assert.equal(row.observedAtMs, now); assert.ok(now < 1e12); now += 3001; f.translator.update();
  assert.equal(f.path().receive.mediaAvailable, false); assert.equal(f.path().receive.selected, "sfu"); f.dispose();
});
await test("missing full-snapshot row clears prior proof and rotates captured lease", async () => {
  const f = fixture(); await f.fresh(); const lease = f.store.capture("remote-session"); f.host.bindings = []; f.translator.update();
  assert.equal(f.store.getSnapshot().entries[0].evidence, undefined); assert.notEqual(f.store.capture("remote-session"), lease); f.dispose();
});
await test("old in-flight stats cannot cross PC epoch, account or room lifetime", async () => {
  for (const change of [f => { f.host.connection.peerConnection = { ...f.pc }; f.host.connectionEpoch++; },
    f => { f.host.connection.accountId = "new-account"; }, f => { f.host.connection.roomId = "next-room"; f.sfu.currentChannelConnected = "next-room"; }]) {
    const f = fixture(); let resolve; f.defer(new Promise(r => { resolve = r; }));
    const flight = f.translator.observer.sample(), lease = f.store.capture("remote-session"); change(f); f.translator.update();
    resolve(f.report()); await flight; assert.notEqual(f.store.capture("remote-session"), lease);
    assert.equal(f.path().receive.mediaAvailable, false); f.dispose();
  }
});
await test("publication/source/alias conflicts and retirement clear evidence synchronously", async () => {
  const f = fixture(); await f.fresh(); f.host.bindings.push({ ...f.host.bindings[0], role: "screen" }); f.translator.update();
  assert.equal(f.store.getSnapshot().entries[0].evidence, undefined); f.host.bindings.pop(); f.translator.update();
  f.retire(); assert.equal(f.store.getSnapshot().entries.length, 0); f.dispose();
});
await test("ended input and closed PC cannot retain decoded proof", async () => {
  const f = fixture(); await f.fresh(); f.track.end(); assert.equal(f.path().receive.mediaAvailable, undefined);
  f.pc.connectionState = "closed"; f.translator.update(); assert.equal(f.store.getSnapshot().entries[0]?.evidence, undefined); f.dispose();
});
await test("zero/backward/missing counters never become fresh and signed loss regression never becomes zero", async () => {
  for (const values of [[100, 48000], [99, 47000], [undefined, undefined], [150, 96000, 4, 11]]) {
    const f = fixture(), close = f.translator.requestDetails(); await f.translator.observer.sample(); now += 1000;
    f.setCounters(...values); await f.translator.observer.sample();
    if (values[2] === 4) { assert.equal(f.path().receive.mediaAvailable, true); assert.equal(f.path().receive.lossPercent, null); }
    else assert.equal(f.path().receive.mediaAvailable, false); close(); f.dispose();
  }
});
await test("actual passive Hybrid marker maps peer and decode independently from physical path, including healthy failed fallback", async () => {
  const f = fixture(); const scope = { serverInstanceId: "instance", roomId: "room", roomGeneration: "opaque-A", localParticipantId: "self", localSessionId: "self-session", canReceive: true, canPublish: false };
  f.host.hybridScope = scope; f.host.hybridBinding = hybridBinding(f); let selected = { current: true, kind: "p2p", track: f.track, revision: -1, routeGeneration: 7, status: "failed", reason: "fallback_failed",
    hybridScope: scope, remoteIdentity: { participantId: "remote", sessionId: "remote-session", publicationId: "publication" } };
  let observation = null; const listeners = new Set();
  f.source.receivePath = { getSelection: () => selected, getObservation: () => observation, subscribe: cb => { listeners.add(cb); return () => listeners.delete(cb); } };
  f.translator.update(); const epoch = f.store.capture("remote-session").scope.roomGeneration;
  now += 1000; observation = { trackId: "track", observedAtMs: now, reason: null,
    decode: { startAtMs: now - 1000, endAtMs: now, packetsDelta: 50, samplesDelta: 48000, decodedFramesDelta: 48000, fresh: true, source: "rtc-inbound-rtp-totalSamplesReceived" },
    metrics: { selectedPairId: null, rttMs: null, rttWindow: null, lossFraction: null, lossWindow: null, rttSource: "rtc-selected-candidate-pair", lossSource: "exact-audio-track-inbound-rtp" } };
  f.translator.update(); assert.equal(f.path().receive.selected, "peer"); assert.equal(f.path().receive.mediaAvailable, true);
  assert.equal(f.path().receive.label, "path-pending"); assert.equal(f.path().receive.reason, "underlay-unproven");
  assert.equal(f.path().receive.transition, "stable"); assert.equal(f.path().send.selected, "unknown");
  const lease = f.store.capture("remote-session"); selected = { ...selected, track: track() }; f.translator.update();
  assert.notEqual(f.store.capture("remote-session"), lease); assert.equal(f.path().receive.mediaAvailable, false);
  for (const token of ["opaque-B", "opaque-A"]) { f.host.hybridScope = { ...scope, roomGeneration: token }; selected.hybridScope = f.host.hybridScope; f.translator.update(); }
  assert.ok(f.store.capture("remote-session").scope.roomGeneration > epoch);
  selected = { ...selected, hybridScope: { ...scope, serverInstanceId: "wrong" } }; f.translator.update(); assert.equal(f.store.getSnapshot().entries[0].evidence, undefined);
  f.dispose(); assert.equal(listeners.size, 0);
});
await test("last unsubscribe cancels sampling/retirement and late flight writes; restart uses fresh lifecycle", async () => {
  const f = fixture(); const close = f.translator.requestDetails(); let resolve; f.defer(new Promise(r => { resolve = r; }));
  const flight = f.translator.observer.sample(); f.translator.stop(); assert.equal(timers.size, 0); assert.equal(f.retireListeners, 0);
  resolve(f.report()); await flight; assert.equal(f.store.getSnapshot().entries.length, 0); close();
  f.defer(null); f.translator.start(); assert.equal(f.path().receive.mediaAvailable, false); f.dispose(); assert.equal(timers.size, 0);
});
await test("authenticated scope capability changes retire a lease even when the room token and PC remain identical", async () => {
  const f = fixture(); f.host.hybridScope = { serverInstanceId: "instance", roomId: "room", roomGeneration: "same-token",
    localParticipantId: "self", localSessionId: "self-session", canReceive: true, canPublish: false };
  f.host.hybridBinding = hybridBinding(f);
  f.translator.update(); await f.fresh(); const lease = f.store.capture("remote-session");
  const receive = f.store.getSnapshot().entries[0].evidence.receive;
  f.host.hybridScope.canPublish = true; f.translator.update();
  assert.notEqual(f.store.capture("remote-session"), lease); assert.equal(f.store.acceptReceive(lease, receive), false);
  assert.equal(f.path().receive.mediaAvailable, false); f.dispose();
});
await test("local ET facts have independent UTC scope/TTL, never member mapping, RTT or physical voice proof", () => {
  const details = { source: "owned-cli-route-list", serverId: "community", instanceId: "instance", generation: 2,
    acquisitionStartedAtUnixMs: 100000, acquiredAtUnixMs: 101000, maxAgeMs: 5000, running: true, localPeerId: 1,
    virtualIp: "10.0.0.1", latencyFirst: null, routes: [{ peerId: 2, virtualIp: null, nextHopPeerId: 3, latencyFirstNextHopPeerId: null, cost: 2, latencyFirstCost: null }],
    peers: [], memberBinding: "unavailable", rttMs: null, missingEvidence: ["full-physical-path"], secret: "must-not-project" };
  const state = { serverId: "community", generation: 2, phase: "connected", localDetails: details };
  const good = readVoiceLocalNetwork("community", state, 101000); assert.equal(good.reason, "available");
  assert.deepEqual(Array.from(good.memberBindings), []); assert.equal(good.physicalPath, "unknown"); assert.equal(good.rttMs, null);
  assert.equal(good.details.secret, undefined); assert.equal(readVoiceLocalNetwork("community", state, 105001).reason, "expired");
  assert.equal(readVoiceLocalNetwork("different", state, 101000).reason, "scope-mismatch");
  assert.equal(readVoiceLocalNetwork("community", { ...state, generation: 3 }, 101000).reason, "scope-mismatch");
  assert.equal(readVoiceLocalNetwork("community", state, now).reason, "invalid");
});
assert.equal(timers.size, 0);
assert.ok(path.basename(client.pathname));
console.log(`${checks} actual-source translator/observer/local-ET scenarios passed; fake PCs only, no real media/network acceptance.`);
