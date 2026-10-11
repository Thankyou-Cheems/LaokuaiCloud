// Pure actual-source lifecycle and mounted-boundary checks. No PC/audio/network/native runtime.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import ts from "typescript";

const read = file => fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
const load = (file, dependencies, globals = {}) => {
  const result = ts.transpileModule(read(file), { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } });
  assert.deepEqual(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), []);
  const exports = {};
  vm.runInNewContext(result.outputText, { exports, structuredClone, ...globals,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; },
  });
  return exports;
};
const model = load("src/lib/memberVoiceMediaPath.ts", {});
const { MemberVoiceMediaStore, VoiceRoomEpoch } = load("src/lib/memberVoiceMediaStore.ts", { "./memberVoiceMediaPath": model });
let now = 100_000, checks = 0;
const test = (name, run) => { run(); checks++; console.log("PASS " + name); };
const source = () => {
  const listeners = new Set(); let current = true;
  return { isCurrent: () => current, subscribeRetirement: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    retire() { current = false; for (const listener of [...listeners]) listener(); }, get listeners() { return listeners.size; } };
};
const fixture = () => ({ accountId: "account", host: "host", roomId: "room", localUserId: "local", localSessionId: "local-session",
  localPublicationId: null, socket: {}, peerConnection: {}, members: [{ userId: "remote", sessionId: "remote-session", publicationId: "remote-pub", source: source() }] });
const media = (selected = "sfu") => ({ source: "sdk-selected-receive-media", observedAtMs: now,
  selected, availability: "usable", transition: "stable", mediaRouteId: "route", routeGeneration: 1, selectionRevision: 1, selectedTrackId: "track",
  mediaProof: { source: "sdk-decoded-receive-media", observedAtMs: now, windowStartedAtMs: now - 1000,
    decodedFramesDelta: 20, mediaRouteId: "route", routeGeneration: 1, selectionRevision: 1, selectedTrackId: "track" },
  metrics: { source: "selected-media-stats", observedAtMs: now, mediaRouteId: "route", routeGeneration: 1, selectionRevision: 1,
    scope: selected === "peer" ? "peer-transport" : "sfu-transport", rttMs: 12, loss: { packetsLost: 1, packetsReceived: 99, windowMs: 1000 } },
});
const setup = () => { const store = new MemberVoiceMediaStore(() => now), input = fixture(); store.reconcile(input); return { store, input, lease: store.capture("remote-session") }; };
const path = store => { const { nowMs, entries } = store.getSnapshot(); return model.readMemberVoiceMediaPath({ ...entries[0], nowMs }); };
test("ordinary authenticated SFU receive-only needs neither Hybrid instance nor local publication", () => {
  const { store, lease } = setup(); assert.equal(lease.scope.serverInstanceId, undefined); assert.equal(lease.scope.localPublicationId, null);
  assert.equal(path(store).receive.reason, "not-integrated"); assert.ok(store.acceptReceive(lease, media()));
  assert.equal(path(store).receive.label, "server-relay"); assert.equal(path(store).receive.mediaAvailable, true);
  assert.equal(path(store).receive.rttMs, 12); assert.equal(path(store).send.reason, "missing");
});
test("peer logical selection and fresh media stay known while physical underlay remains unproven", () => {
  const { store, lease } = setup(); assert.ok(store.acceptReceive(lease, media("peer")));
  const receive = path(store).receive; assert.equal(receive.selected, "peer"); assert.equal(receive.mediaAvailable, true);
  assert.equal(receive.reason, "underlay-unproven"); assert.equal(receive.label, "path-pending"); assert.equal(receive.metricsScope, "peer-transport");
});
test("clock ticks and unchanged roster never refresh decoded proof or metrics", () => {
  const { store, input, lease } = setup(); assert.ok(store.acceptReceive(lease, media()));
  now += 5001; store.reconcile(input); store.tick(); assert.equal(path(store).receive.reason, "expired");
  assert.equal(store.getSnapshot().entries[0].evidence.observedAtMs, now - 5001); now -= 5001;
});
test("account, room, host, socket identity/id, PC, local identity/publication and server replacement retire leases", () => {
  for (const change of [input => input.accountId += "2", input => input.roomId += "2", input => input.host += "2",
    input => input.socket = {}, input => input.localSessionId += "2", input => input.peerConnection = {},
    input => input.localUserId += "2", input => input.localPublicationId = "pub", input => input.serverInstanceId = "instance"]) {
    const { store, input, lease } = setup(); assert.ok(store.acceptReceive(lease, media())); change(input); store.reconcile(input);
    assert.ok(!store.acceptReceive(lease, media())); assert.equal(path(store).receive.reason, "not-integrated");
    assert.ok(store.capture("remote-session").scope.connectionGeneration > lease.scope.connectionGeneration);
  }
});
test("disconnect/rejoin same identifiers and source never reactivate an old lease", () => {
  const { store, input, lease } = setup(); store.clear(); store.reconcile(input);
  assert.ok(!store.acceptReceive(lease, media())); assert.ok(store.capture("remote-session").scope.connectionGeneration > lease.scope.connectionGeneration);
});
test("remote session/publication/user and borrowed receive source replacements invalidate only their binding", () => {
  for (const change of [member => member.sessionId += "2", member => member.publicationId += "2", member => member.userId += "2", member => member.source = source()]) {
    const { store, input, lease } = setup(); store.acceptReceive(lease, media()); change(input.members[0]); store.reconcile(input);
    assert.ok(!store.acceptReceive(lease, media())); assert.equal(path(store).receive.reason, "not-integrated");
  }
});
test("duplicate user/session/publication or shared receive nodes are never assigned to two members", () => {
  for (const field of ["userId", "sessionId", "publicationId", "source"]) {
    const { store, input } = setup(), a = input.members[0], b = { userId: "other", sessionId: "other-session", publicationId: "other-pub", source: source() };
    b[field] = a[field]; input.members.push(b); store.reconcile(input); assert.equal(store.getSnapshot().entries.length, 0);
  }
});
test("source retirement clears immediately and unsubscribe never disposes borrowed media", () => {
  const { store, input, lease } = setup(); let notifications = 0; const unsubscribe = store.subscribe(() => notifications++);
  store.acceptReceive(lease, media()); input.members[0].source.retire(); assert.equal(store.getSnapshot().entries.length, 0);
  assert.ok(!store.acceptReceive(lease, media())); assert.equal(input.members[0].source.listeners, 0);
  assert.ok(notifications >= 2); unsubscribe(); const before = notifications; store.clear(); assert.equal(notifications, before);
});
test("synchronous subscription retirement has no listener leak or revived entry", () => {
  const input = fixture(); let removed = 0; input.members[0].source = { subscribeRetirement(listener) { listener(); return () => removed++; } };
  const store = new MemberVoiceMediaStore(() => now); store.reconcile(input); assert.equal(store.getSnapshot().entries.length, 0); assert.equal(removed, 1);
});
test("invalid/expired/contradictory SDK selections and stale asynchronous revisions cannot replace newer evidence", () => {
  const { store, lease } = setup(); const good = media(); good.selectionRevision = 3; good.mediaProof.selectionRevision = 3; good.metrics.selectionRevision = 3;
  assert.ok(store.acceptReceive(lease, good)); assert.ok(!store.acceptReceive(lease, media()));
  for (const change of [m => m.observedAtMs -= 5001, m => m.observedAtMs++, m => m.selected = "none", m => m.source = "ice-connected", m => m.routeGeneration = 0]) {
    const m = media(); m.selectionRevision = 4; change(m); assert.ok(!store.acceptReceive(lease, m));
  }
  good.metrics.rttMs = 999; assert.equal(path(store).receive.rttMs, 12); store.invalidateReceive(lease); assert.equal(path(store).receive.reason, "not-integrated");
  assert.ok(!store.acceptReceive(lease, good)); assert.notEqual(store.capture("remote-session"), lease);
});
test("opaque room epochs preserve exact nonnumeric tokens and never reuse A after B or retirement", () => {
  const epochs = new VoiceRoomEpoch(), pc = {}; const a = epochs.update(pc, "room:opaque/not-a-number");
  assert.equal(epochs.update(pc, "room:opaque/not-a-number"), a); const b = epochs.update(pc, "room:other");
  assert.ok(b > a); assert.ok(epochs.update(pc, "room:opaque/not-a-number") > b);
  const before = epochs.update(undefined, undefined); assert.ok(epochs.update(pc, "room:opaque/not-a-number") > before);
});
test("connection-scoped evidence cannot invent a remote send receipt and room token mismatches reject", () => {
  const { lease } = setup(); const e = { schemaVersion: 1, source: "authenticated-sdk-media-selection", scope: { ...lease.scope }, observedAtMs: now, receive: media(), send: media() };
  e.send.source = "authenticated-selected-send-media"; e.send.mediaProof.source = "authenticated-remote-decoded-media";
  assert.equal(model.readMemberVoiceMediaPath({ scope: lease.scope, evidence: e, nowMs: now }).send.reason, "missing");
  const scope = { ...lease.scope, authority: "authenticated-room", serverInstanceId: "instance", roomGenerationToken: "opaque-token" };
  e.scope = { ...scope, roomGenerationToken: "old-token" }; assert.equal(model.readMemberVoiceMediaPath({ scope, evidence: e, nowMs: now }).receive.reason, "scope-mismatch");
});
test("normalized authenticated room tokens are matched to independent roster and map to new local epochs", () => {
  const { store, input, lease } = setup(); input.serverInstanceId = "instance";
  input.roomAuthority = { serverInstanceId: "instance", roomId: "room", localUserId: "local", localSessionId: "local-session", roomGenerationToken: "opaque-A" };
  store.reconcile(input); const first = store.capture("remote-session"); assert.equal(first.scope.authority, "authenticated-room");
  assert.equal(first.scope.roomGenerationToken, "opaque-A"); assert.ok(!store.acceptReceive(lease, media()));
  input.roomAuthority.roomGenerationToken = "opaque-B"; store.reconcile(input); const second = store.capture("remote-session");
  assert.ok(second.scope.roomGeneration > first.scope.roomGeneration); input.roomAuthority.roomGenerationToken = "opaque-A"; store.reconcile(input);
  assert.ok(store.capture("remote-session").scope.roomGeneration > second.scope.roomGeneration);
  for (const field of ["serverInstanceId", "roomId", "localUserId", "localSessionId"]) {
    const valid = input.roomAuthority[field]; input.roomAuthority[field] += "bad"; store.reconcile(input);
    assert.equal(store.getSnapshot().entries.length, 0); input.roomAuthority[field] = valid; store.reconcile(input);
  }
});

let layout, cleanup, tick, currentStore, authority;
const input = fixture();
const sfu = { currentServerConnected: input.host, currentChannelConnected: input.roomId, isConnected: true,
  getPeerConnection: () => input.peerConnection, getConnectionEpoch: () => 1,
  streamSources: { "remote-pub": { receiveCleanup: input.members[0].source, stream: { mediaStream: { getTracks: () => [{ id: "track", kind: "audio", readyState: "live" }] } } } } };
input.peerConnection.connectionState = "connected";
const socketListeners = new Map(), cleanups = [];
const socket = { id: "local-session", connected: true, on: (event, callback) => socketListeners.set(event, callback),
  off: event => socketListeners.delete(event) };
const clients = { "local-session": { serverUserId: "local", streamID: "", hasJoinedChannel: true, voiceChannelId: "room" },
  "remote-session": { serverUserId: "remote", streamID: "remote-pub", hasJoinedChannel: true, voiceChannelId: "room", isConnectedToVoice: true } };
const sockets = { sockets: { host: socket }, clients: { host: clients }, serverDetailsList: {} };
const passiveClock = { performance: { now: () => now }, setTimeout: () => 8, clearTimeout() {} };
const sdkStats = load("../voice/src/webrtc/hybrid/receivePathStats.ts", {}, passiveClock);
const sdkObserver = load("../voice/src/webrtc/hybrid/ReceivePathObserver.ts", { "./receivePathStats": sdkStats }, passiveClock);
const translator = load("src/lib/memberVoiceReceiveTranslator.ts", { "@gryt/voice": sdkObserver,
  "./memberVoiceMediaStore": { MemberVoiceMediaStore } });
const localNetwork = load("src/lib/memberVoiceLocalNetwork.ts", {});
const bridge = load("src/packages/webRTC/src/adapters/MemberVoiceMediaBridge.tsx", {
  "@gryt/voice": { useSFU: () => sfu }, "@/common": { useUserId: () => "account" }, "@/socket": { useSockets: () => sockets },
  react: { useCallback: fn => fn, useRef: value => ({ current: value }), useState: initialize => { const value = initialize(); if (value instanceof MemberVoiceMediaStore) currentStore = value; return [value]; },
    useLayoutEffect: fn => { layout = fn; }, useEffect: fn => { cleanups.push(fn()); cleanup = () => cleanups.forEach(f => f?.()); }, useSyncExternalStore: (_subscribe, get) => get() },
  "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
  "../../../../lib/memberVoiceMediaStore": { MemberVoiceMediaStore },
  "../../../../lib/memberVoiceReceiveTranslator": translator,
  "../../../../lib/memberVoiceLocalNetwork": localNetwork,
  "../../../../lib/communityLanState": { useEasyTierCommunityState: () => undefined },
  "./MemberVoiceObservationAuthority": { MemberVoiceObservationAuthorityProvider: "ObservationAuthority" },
  "../components/MemberVoiceMediaPathAdapter": { MemberVoiceMediaPathProvider: "MediaProvider" },
}, { Date: { now: () => 1_800_000_000_000 }, performance: { now: () => now }, setInterval: fn => { tick = fn; return 7; }, clearInterval: timer => { assert.equal(timer, 7); } });
test("actual bridge mounts one provider above children, reconciles ordinary roster without enabling Hybrid", () => {
  const wrapped = bridge.MemberVoiceMediaBridge({ children: "room-and-sidebar" }); assert.equal(wrapped.type, "ObservationAuthority");
  authority = wrapped.props.value;
  const rendered = wrapped.props.children; assert.equal(rendered.type, "MediaProvider");
  assert.equal(rendered.props.children, "room-and-sidebar"); layout(); assert.equal(currentStore.getSnapshot().entries.length, 1);
  assert.equal(currentStore.capture("remote-session").scope.localPublicationId, null); assert.equal(path(currentStore).receive.reason, "media-unavailable");
});
test("mounted bridge binds a trusted stable server context to the actual session's distinct instance", () => {
  sockets.serverDetailsList.host = { server_info: { server_id: "stable-community" } };
  const binding = { accountId: "account", host: "host", serverId: "stable-community", roomId: "room",
    localUserId: "local", localSessionId: socket.id, socket, peerConnection: input.peerConnection, connectionEpoch: 1 };
  const scope = { serverInstanceId: "stable-community:runtime-A", roomId: "room", roomGeneration: "opaque-A",
    localParticipantId: "local", localSessionId: socket.id, canReceive: true, canPublish: false };
  const releaseA = authority.registerSession({ getReceiveScope: () => scope }, binding);
  assert.equal(currentStore.capture("remote-session").scope.serverInstanceId, scope.serverInstanceId);
  assert.equal(currentStore.capture("remote-session").scope.authority, "authenticated-room");
  const oldLease = currentStore.capture("remote-session");
  binding.serverId = "mutated-caller-value"; tick();
  assert.equal(currentStore.capture("remote-session").scope.connectionGeneration, oldLease.scope.connectionGeneration); // copied/frozen context
  const scopeB = { ...scope, serverInstanceId: "different-opaque-runtime-B" };
  const releaseB = authority.registerSession({ getReceiveScope: () => scopeB }, { ...binding, serverId: "stable-community" });
  assert.notEqual(currentStore.capture("remote-session"), oldLease);
  releaseA(); assert.equal(currentStore.capture("remote-session").scope.serverInstanceId, scopeB.serverInstanceId);
  releaseB(); assert.equal(currentStore.capture("remote-session").scope.authority, "authenticated-connection");
});
test("mounted registration cannot survive a stable-server change, different room or local user", () => {
  const binding = { accountId: "account", host: "host", serverId: "stable-community", roomId: "room",
    localUserId: "local", localSessionId: socket.id, socket, peerConnection: input.peerConnection, connectionEpoch: 1 };
  const scope = { serverInstanceId: "stable-community:runtime-A", roomId: "room", roomGeneration: "opaque-A",
    localParticipantId: "local", localSessionId: socket.id, canReceive: true, canPublish: false };
  const release = authority.registerSession({ getReceiveScope: () => scope }, binding);
  sockets.serverDetailsList.host.server_info.server_id = "stable-community:runtime-A"; tick();
  assert.equal(currentStore.getSnapshot().entries.length, 0); // even an equal/prefix-compatible string is insufficient
  sockets.serverDetailsList.host.server_info.server_id = "stable-community"; tick();
  sfu.currentChannelConnected = "next-room"; clients["local-session"].voiceChannelId = "next-room"; tick();
  assert.equal(currentStore.getSnapshot().entries.length, 0);
  sfu.currentChannelConnected = "room"; clients["local-session"].voiceChannelId = "room"; tick();
  clients["local-session"].serverUserId = "someone-else"; tick(); assert.equal(currentStore.getSnapshot().entries.length, 0);
  clients["local-session"].serverUserId = "local"; release();
  assert.equal(currentStore.getSnapshot().entries.length, 1);
});
test("bridge rejects screen aliases, duplicate publication and cross-room/unconnected roster", () => {
  for (const mutate of [() => clients["remote-session"].screenShareAudioStreamID = "remote-pub",
    () => clients["other"] = { ...clients["remote-session"] }, () => clients["remote-session"].voiceChannelId = "other-room",
    () => clients["remote-session"].isConnectedToVoice = false]) {
    mutate(); tick(); assert.equal(currentStore.getSnapshot().entries.length, 0);
    delete clients["other"]; delete clients["remote-session"].screenShareAudioStreamID;
    clients["remote-session"].voiceChannelId = "room"; clients["remote-session"].isConnectedToVoice = true; tick();
  }
});
test("rapid disconnect/rejoin same socket and PC retires captured lease before the periodic tick", () => {
  const lease = currentStore.capture("remote-session"); currentStore.acceptReceive(lease, media());
  socket.connected = false; socketListeners.get("disconnect")(); assert.equal(currentStore.getSnapshot().entries.length, 0);
  socket.connected = true; socketListeners.get("connect")(); assert.notEqual(currentStore.capture("remote-session"), lease);
  assert.ok(!currentStore.acceptReceive(lease, media()));
});
test("idle PC/socket retirement and unmount clear the store without owning socket/source/ET", () => {
  const lease = currentStore.capture("remote-session"); currentStore.acceptReceive(lease, media());
  input.peerConnection.connectionState = "closed"; tick(); assert.equal(currentStore.getSnapshot().entries.length, 0);
  input.peerConnection.connectionState = "connected"; tick(); socket.connected = false; tick(); assert.equal(currentStore.getSnapshot().entries.length, 0);
  socket.connected = true; tick(); cleanup(); assert.equal(currentStore.getSnapshot().entries.length, 0);
  assert.equal(input.members[0].source.isCurrent(), true); assert.equal(socket.connected, true);
  const sourceText = read("src/packages/webRTC/src/adapters/MemberVoiceMediaBridge.tsx");
  assert.doesNotMatch(sourceText, /\.getStats\(|\.disconnect\(|\.dispose\(|(?:pc|socket|source|stream|track)\.stop\(|new RTCPeerConnection|useMicrophone|fetch\(/);
  const receive = read("src/packages/webRTC/src/adapters/ReceiveCorrectionBridge.tsx");
  assert.match(receive, /<MemberVoiceMediaBridge><HybridVoiceBridge[^]*\{children\}<\/MemberVoiceMediaBridge>/);
});
test("socket lifecycle listeners are removed on unmount", () => { assert.equal(socketListeners.size, 0); });
console.log(`${checks} passive store/mounted observer boundary scenarios passed. Actual media acceptance remains pending.`);
