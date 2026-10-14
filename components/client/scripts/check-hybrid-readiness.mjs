// Actual React effect dependencies and async boot in a pure VM; no media/native ownership.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const compile = p => ts.transpileModule(read(p), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const recorded = [], diagnosticModule = { exports: {} }, schemaModule = { exports: {} };
vm.runInNewContext(compile("src/lib/localDiagnostics.ts"), { exports: schemaModule.exports });
vm.runInNewContext(compile("src/lib/hybridDiagnostics.ts"), { exports: diagnosticModule.exports, require: name => {
  assert.equal(name, "./localDiagnostics"); return { ...schemaModule.exports, localDiagnostic: value => recorded.push(value) };
} });
function fixture(ready = true) {
  const refs = [], effects = [], pending = [], sessions = [], timers = [], diagnostics = [];
  let refIndex = 0, effectIndex = 0, epoch = 1, account = "synthetic-account";
  const noOwnership = () => { throw Error("No actual media/native ownership allowed"); };
  const pc = { connectionState: "connected", getConfiguration: () => ({ iceServers: [] }) };
  const socket = { connected: true, id: "synthetic-session", disconnect: noOwnership };
  const local = { serverUserId: "synthetic-user", voiceChannelId: "synthetic-room", hasJoinedChannel: true };
  const sockets = { sockets: { "synthetic-host": socket }, serverDetailsList: { "synthetic-host": { server_info: { server_id: "synthetic-server" } } }, clients: { "synthetic-host": ready ? { "synthetic-session": local } : {} } };
  const sfu = { currentServerConnected: "synthetic-host", currentChannelConnected: "synthetic-room", isConnected: true,
    streamSources: {}, getPeerConnection: () => pc, getConnectionEpoch: () => epoch };
  const registry = { selectTrack: noOwnership }, observations = { update() {}, registerSession: () => () => {} };
  let config = { connection: { microphoneCodec: { codec: "opus", maxBitrateBps: 64000 }, maxBitrate: 16000 } };
  const policy = { enabled: true, allowNetwork: true, onDiagnostic: value => diagnostics.push(value) };
  class Session {
    constructor(options) { this.options = options; this.disposed = false; this.updates = 0; this.restored = true; this.disableCalls = 0; sessions.push(this); }
    async update() { this.updates++; }
    async setEnabled(enabled) { if (!enabled) { this.disableCalls++; if (this.wait) await this.wait; } }
    getState() { return { status: this.restored ? "disabled" : "recovering" }; }
    dispose() { this.disposed = true; }
  }
  const deps = { "@gryt/voice": { BrowserHybridVoiceSession: Session, useSFU: () => sfu, useMicrophone: () => ({ stop: noOwnership }) },
    react: { useRef(value) { const n = refIndex++; return refs[n] ??= { current: value }; }, useEffect(callback, dependencies) {
      const n = effectIndex++, prior = effects[n];
      if (!prior || dependencies.length !== prior.dependencies.length || dependencies.some((v, i) => !Object.is(v, prior.dependencies[i]))) {
        effects[n] = { dependencies, cleanup: prior?.cleanup }; pending.push({ n, callback });
      }
    } }, "@/common": { useUserId: () => account, getServerAccessToken: () => "synthetic-only" }, "@/socket": { useSockets: () => sockets },
    "../../../../lib/communityLanState": { useEasyTierCommunityState: () => undefined },
    "../../../../lib/easyTierVoiceUnderlay": { createEasyTierVoiceUnderlayResolver: () => ({ resolve: () => null }) },
    "../../../../lib/memberVoiceLocalNetwork": { readVoiceLocalNetwork: () => undefined },
    "../../../../lib/hybridDiagnostics": diagnosticModule.exports,
    "./MemberVoiceObservationAuthority": { useMemberVoiceObservationAuthority: () => observations } };
  const exports = {};
  vm.runInNewContext(compile("src/packages/webRTC/src/adapters/HybridVoiceBridge.tsx"), { exports,
    setTimeout(callback) { const timer = { callback, cancelled: false }; timers.push(timer); return timer; }, clearTimeout(timer) { if (timer) timer.cancelled = true; },
    require: name => { assert.ok((Object.hasOwn(deps, name) || (name.endsWith("/voiceFacade") && Object.hasOwn(deps,"@gryt/voice"))), name); return name.endsWith("/voiceFacade") ? deps["@gryt/voice"] : deps[name]; } });
  const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
  const render = async () => { refIndex = effectIndex = 0; exports.HybridVoiceBridge({ policy, config, registry });
    for (const { n, callback } of pending.splice(0)) { effects[n].cleanup?.(); effects[n].cleanup = callback(); } await flush(); };
  return { render, flush, sessions, timers, diagnostics, sockets, local, sfu,
    arriveRoster() { sockets.clients = { "synthetic-host": { "synthetic-session": local } }; },
    setEpoch(value) { epoch = value; }, setAccount(value) { account = value; },
    changeProfile() { config = { connection: { ...config.connection, microphoneCodec: { codec: "opus", maxBitrateBps: config.connection.microphoneCodec.maxBitrateBps - 1000 } } }; },
    dispose() { effects.forEach(effect => effect.cleanup?.()); } };
}
const delayed = fixture(false); await delayed.render(); assert.equal(delayed.sessions.length, 0);
assert.equal(delayed.diagnostics[0].reason, "roster_unavailable");
delayed.arriveRoster(); await delayed.render(); assert.equal(delayed.sessions.length, 1, "late roster must bootstrap");
const original = delayed.sessions[0];
delayed.sfu.streamSources = { publication: { receiveCleanup: {} } }; await delayed.render();
delayed.sockets.clients = { "synthetic-host": { ...delayed.sockets.clients["synthetic-host"], remote: { serverUserId: "remote" } } }; await delayed.render();
for (let n = 0; n < 100; n++) await delayed.render();
assert.equal(delayed.sessions.length, 1); assert.equal(original.disposed, false); assert.ok(original.updates >= 3);
delayed.local.serverUserId = "replacement-user"; await delayed.render();
assert.equal(original.disposed, true); assert.equal(delayed.sessions.length, 2); assert.equal(original.options.isCurrent(), false);
delayed.setEpoch(2); await delayed.render(); assert.equal(delayed.sessions[1].disposed, true); assert.equal(delayed.sessions.length, 3);
delayed.setAccount("replacement-account"); await delayed.render(); assert.equal(delayed.sessions[2].disposed, true); assert.equal(delayed.sessions.length, 4);
delayed.local.hasJoinedChannel = false; await delayed.render(); assert.equal(delayed.sessions[3].disposed, true); assert.equal(delayed.sessions.length, 4);
delayed.local.hasJoinedChannel = true; await delayed.render(); assert.equal(delayed.sessions.length, 5);
delayed.sfu.currentChannelConnected = "replacement-room"; await delayed.render(); assert.equal(delayed.sessions[4].disposed, true); assert.equal(delayed.sessions.length, 5);
delayed.local.voiceChannelId = "replacement-room"; await delayed.render(); assert.equal(delayed.sessions.length, 6); delayed.dispose();

const reconfigure = fixture(); await reconfigure.render(); const old = reconfigure.sessions[0]; old.restored = false;
reconfigure.changeProfile(); await reconfigure.render();
assert.equal(reconfigure.sessions.length, 1); assert.equal(old.disposed, false); assert.equal(old.disableCalls, 1);
assert.equal(reconfigure.diagnostics.at(-1).reason, "reconfigure_restore_pending");
old.restored = true; reconfigure.timers.at(-1).callback(); await reconfigure.flush();
assert.equal(old.disposed, true); assert.equal(reconfigure.sessions.length, 2); reconfigure.dispose();

const delayedEpoch = fixture(); delayedEpoch.setEpoch(0); await delayedEpoch.render(); assert.equal(delayedEpoch.sessions.length, 0);
delayedEpoch.setEpoch(1); await delayedEpoch.render(); assert.equal(delayedEpoch.sessions.length, 1); delayedEpoch.dispose();
const replacementPc = fixture(); await replacementPc.render(); const pcOld = replacementPc.sessions[0]; pcOld.restored = false;
const newPc = { connectionState: "connected", getConfiguration: () => ({ iceServers: [] }) };
replacementPc.sfu.getPeerConnection = () => newPc; await replacementPc.render();
assert.equal(pcOld.disposed, true); assert.equal(pcOld.disableCalls, 0); assert.equal(replacementPc.sessions.length, 2); replacementPc.dispose();
const replacementSocket = fixture(); await replacementSocket.render(); const socketOld = replacementSocket.sessions[0]; socketOld.restored = false;
replacementSocket.sockets.sockets["synthetic-host"] = { id: "synthetic-session", connected: true }; await replacementSocket.render();
assert.equal(socketOld.disposed, true); assert.equal(socketOld.options.isCurrent(), false); assert.equal(socketOld.disableCalls, 0);
assert.equal(replacementSocket.sessions.length, 2); replacementSocket.dispose();

// An old async configuration must not dispose the session owned by a newer effect.
const racing = fixture(); await racing.render(); const racingOld = racing.sessions[0];
let release; racingOld.wait = new Promise(resolve => { release = resolve; });
racing.changeProfile(); await racing.render(); racing.setEpoch(2); await racing.render();
assert.equal(racing.sessions.length, 2); release(); await racing.flush();
assert.equal(racing.sessions.length, 2); assert.equal(racing.sessions[1].disposed, false); racing.dispose();

const safe = [], observer = diagnosticModule.exports.createHybridDiagnosticObserver(value => safe.push(value));
const state = { status: "active", reason: "secret-user-IP-token", routing: { routes: [{ participantId: "secret-participant", sessionId: "secret-session", publicationId: "secret-publication", selectedTrackId: "secret-track", routeGeneration: 2, selectionRevision: 3, status: "p2p", selected: "p2p", reason: "peer_path_changed", forwardingPaused: true }] } };
observer.state(state); observer.state(state); assert.equal(safe.length, 2, "repeat states deduplicate");
assert.equal(safe[0].reason, "other"); assert.equal(safe[1].routeOrdinal, 0); assert.equal(safe[1].forwardingPaused, true);
assert.equal(JSON.stringify(safe).includes("secret"), false);
const media = { kind: "peer-media", pathClass: "non-turn-candidate", pathReason: "selected-pair", localCandidateType: "host", remoteCandidateType: "host",
  underlayClass: "easytier-direct", decodeProof: "fresh", decodeReason: "fresh_decode", failureReason: null, secretToken: "secret-token", address: "secret-address" };
observer.sdk(media); observer.sdk(media); observer.sdk({ kind: "forwarding", action: "restore", result: "acknowledged", reason: "validated_ack", token: "secret-token" });
assert.equal(safe.length, 4); assert.equal(safe[2].underlayClass, "easytier-direct"); assert.equal(safe[2].decodeProof, "fresh");
assert.equal(safe[3].result, "acknowledged"); assert.equal(JSON.stringify(safe).includes("secret"), false);
const failureEvents = [], failureObserver = diagnosticModule.exports.createHybridDiagnosticObserver(value => failureEvents.push(value));
for (const failureReason of diagnosticModule.exports.HYBRID_PROTOCOL_DIAGNOSTIC_REASONS) {
  failureObserver.state({ status: "unsupported", reason: failureReason, routing: null });
  failureObserver.sdk({ kind: "forwarding", action: "pause", result: "failed", reason: "request_failed", failureReason });
  assert.equal(failureEvents.at(-2).reason, failureReason);
  assert.equal(failureEvents.at(-1).failureReason, failureReason);
}
failureObserver.sdk({ kind: "forwarding", action: "pause", result: "failed", reason: "request_failed", failureReason: "raw secret token address" });
assert.equal(failureEvents.at(-1).failureReason, undefined);
safe.forEach(value => diagnosticModule.exports.localHybridDiagnostic(value)); assert.equal(recorded.length, 4);
observer.sdk({ kind: "handoff", stage: "local_handoff_completed", elapsedMs: 24, reason: "local_handoff_before_pause", token: "secret-token" });
observer.sdk({ kind: "handoff", stage: "sfu_restore_completed", elapsedMs: 750, reason: "fresh_sfu_restored" });
observer.sdk({ kind: "forwarding", action: "restore", result: "acknowledged", reason: "validated_ack", elapsedMs: 700 });
assert.equal(safe.at(-3).operation, "hybrid-handoff"); assert.equal(safe.at(-3).elapsedMs, 24);
assert.equal(safe.at(-2).handoffStage, "sfu_restore_completed"); assert.equal(safe.at(-1).elapsedMs, 700);
assert.equal(JSON.stringify(safe).includes("secret"), false);
safe.slice(-3).forEach(value => diagnosticModule.exports.localHybridDiagnostic(value)); assert.equal(recorded.length, 7);
const bridged = fixture(); await bridged.render(); bridged.sessions[0].options.onDiagnostic(media);
assert.equal(bridged.diagnostics.at(-1).operation, "hybrid-path"); bridged.dispose();
for (const reason of ["peer_path_inconsistent", "invalid_receive_candidate", "invalid_receive_node"]) {
  const events = [];
  const observer = diagnosticModule.exports.createHybridDiagnosticObserver(value => events.push(value));
  observer.state({ status: "active", reason: null, routing: { routes: [{ participantId: "synthetic-peer", sessionId: "synthetic-session", publicationId: "synthetic-publication", status: "recovering", reason, selected: "none", routeGeneration: 1, selectionRevision: 1, forwardingPaused: false }] } });
  assert.equal(events.at(-1).reason, reason, "controller recovery reason must survive diagnostic projection");
}
console.log("PASS late roster readiness, stable remote roster/source updates, local identity/account/room/epoch retirement, ACK-gated reconfigure, cancelled async boot and safe deduplicated diagnostics; VM only");
