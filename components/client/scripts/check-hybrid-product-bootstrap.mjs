// Actual bridge callbacks in a pure VM; no PC/capture/socket/helper execution.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import ts from "typescript";

import { peerVoicePreset, sharedVoicePreset, voicePresetCodec } from "../src/lib/voiceTransportPreset.ts";

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const policyCode = ts.transpileModule(read("src/lib/hybridVoicePolicy.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const policyModule = { exports: {} };
vm.runInNewContext(policyCode, { exports: policyModule.exports, Object, require: name => {
  assert.equal(name, "./hybridDiagnostics"); return { localHybridDiagnostic() {} };
} });
const productPolicy = policyModule.exports.LAOKUAI_HYBRID_VOICE_POLICY;
const provider = read("src/packages/webRTC/src/adapters/VoiceProvider.tsx");
const peerPolicyExpression = provider.match(/const effectiveHybrid = useMemo\(\(\) => ([\s\S]*?), \[hybrid, voiceTransportPreset\]\)/)[1];
const productPeerPolicy = (hybrid, voiceTransportPreset) => vm.runInNewContext(peerPolicyExpression, { hybrid, voiceTransportPreset, peerVoicePreset, voicePresetCodec });
const standardPeerPolicy = productPeerPolicy(productPolicy, sharedVoicePreset());
assert.equal(sharedVoicePreset().maxBitrateBps, 16_000);
assert.equal(sharedVoicePreset().packetTimeMs, 60);
assert.equal(standardPeerPolicy.microphoneCodec.maxBitrateBps, 64_000);
const customPreset = { ...sharedVoicePreset(), selection: "custom", maxBitrateBps: 32000, packetTimeMs: 40, requestDtx: false };
assert.equal(productPeerPolicy(productPolicy, customPreset).microphoneCodec.maxBitrateBps, 32000);
assert.equal(productPeerPolicy(productPolicy, customPreset).microphoneCodec.packetTimeMs, 40);
assert.equal(productPeerPolicy(productPolicy, customPreset).microphoneCodec.dtx, false);
assert.equal(productPeerPolicy(undefined, sharedVoicePreset()), undefined);
const main = read("electron/main.ts"), preload = read("electron/preload.ts"), renderer = read("src/main.tsx");
const argsExpression = main.match(/additionalArguments:\s*(\[[\s\S]*?\n\s*\]),\n\s*contextIsolation/)[1];
for (const own of [false, true]) for (const chrome of [false, true]) {
  const args = vm.runInNewContext(argsExpression, { IS_LAOKUAI: own, drawsWindowButtons: () => chrome, NO_WINDOW_CHROME_FLAG: "--gryt-no-window-chrome" });
  assert.equal(args.includes("--laokuai-hybrid-voice"), own);
  assert.equal(args.includes("--gryt-no-window-chrome"), !chrome);
  const enabled = vm.runInNewContext(preload.match(/hybridVoiceEnabled: ([^\n]+),/)[1], { process: { argv: args } });
  const selected = vm.runInNewContext(renderer.match(/<VoiceProvider hybrid=\{([^\n]+)\}>/)[1], { window: { electronAPI: { hybridVoiceEnabled: enabled } }, LAOKUAI_HYBRID_VOICE_POLICY: productPolicy });
  assert.equal(selected === productPolicy, own);
}
assert.equal(vm.runInNewContext(renderer.match(/<VoiceProvider hybrid=\{([^\n]+)\}>/)[1], { window: {}, LAOKUAI_HYBRID_VOICE_POLICY: productPolicy }), undefined);
const bridgeCode = ts.transpileModule(read("src/packages/webRTC/src/adapters/HybridVoiceBridge.tsx"), { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
assert.deepEqual(bridgeCode.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), []);
function fixture(policy, options = {}) {
  const effects = [], sessions = [], microphoneArgs = [], emitted = [], registrations = [];
  const noOwnership = () => { throw Error("Observer must not acquire capture, stop publication, disconnect socket or touch ET"); };
  const source = { receiveCleanup: {} }, inheritedIce = { iceServers: [{ urls: "stun:existing.invalid" }] };
  let configurationReads = 0;
  const pc = { connectionState: "connected", getConfiguration() { configurationReads++; if (options.badConfiguration) throw Error("closed"); return inheritedIce; } };
  const socket = { id: "local-session", connected: true, disconnect: noOwnership };
  const roster = { "local-session": { serverUserId: "local-user", voiceChannelId: "room", hasJoinedChannel: true },
    "remote-session": { serverUserId: "remote-user", streamID: "remote-publication", voiceChannelId: "room", hasJoinedChannel: true } };
  if (options.missingLocal) delete roster["local-session"];
  let epoch = options.missingEpoch ? 0 : 1;
  const sfu = { currentServerConnected: "host", currentChannelConnected: "room", isConnected: true, streamSources: { "remote-publication": source }, getPeerConnection: () => pc, getConnectionEpoch: () => epoch };
  const microphone = { stop: noOwnership };
  class Session {
    constructor(opts) { this.options = opts; this.disposed = false; this.updates = 0; sessions.push(this); }
    async update() { this.updates++; }
    async setEnabled(value) { this.enabled = value; }
    getState() { return { status: "disabled" }; }
    dispose() { this.disposed = true; }
  }
  const deps = { "@gryt/voice": { BrowserHybridVoiceSession: Session, useSFU: () => sfu, useMicrophone: value => { microphoneArgs.push(value); return microphone; } }, react: { useRef: value => ({ current: value }), useEffect: fn => effects.push(fn) }, "@/common": { useUserId: () => "account", getServerAccessToken: () => "fake-in-memory-only" }, "@/socket": { useSockets: () => ({ sockets: { host: socket }, serverDetailsList: { host: { server_info: { server_id: "server" } } }, clients: { host: roster } }) } };
  deps["../../../../lib/communityLanState"] = { useEasyTierCommunityState: () => undefined };
  deps["../../../../lib/easyTierVoiceUnderlay"] = { createEasyTierVoiceUnderlayResolver: () => ({ resolve: () => null }) };
  deps["../../../../lib/memberVoiceLocalNetwork"] = { readVoiceLocalNetwork: () => undefined };
  deps["../../../../lib/hybridDiagnostics"] = { createHybridDiagnosticObserver: () => ({ scope() {}, state() {}, sdk() {} }) };
  deps["./MemberVoiceObservationAuthority"] = { useMemberVoiceObservationAuthority: () => ({ update() {},
    registerSession: (session, binding) => { const registration = { session, binding, released: false }; registrations.push(registration); return () => { registration.released = true; }; } }) };
  const exports = {};
  vm.runInNewContext(bridgeCode.outputText, { exports, JSON, setTimeout: noOwnership, clearTimeout() {}, require: name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; } });
  const suppliedPolicy = policy && { ...policy, onState: state => emitted.push(state) };
  exports.HybridVoiceBridge({ policy: suppliedPolicy, config: { connection: { microphoneCodec: { codec: "opus", maxBitrateBps: 48000 }, maxBitrate: options.channelCap ?? null } }, registry: { selectTrack() {} } });
  const cleanups = effects.map(effect => effect());
  return { sessions, pc, socket, roster, source, inheritedIce, microphoneArgs, emitted, registrations,
    setEpoch(value) { epoch = value; }, get configurationReads() { return configurationReads; }, dispose: () => cleanups.forEach(cleanup => typeof cleanup === "function" && cleanup()) };
}
const disabled = fixture(undefined); await Promise.resolve();
assert.equal(disabled.sessions.length, 0); assert.equal(disabled.configurationReads, 0); disabled.dispose();
const active = fixture(standardPeerPolicy); await Promise.resolve();
assert.equal(active.sessions.length, 1); assert.equal(active.configurationReads, 1); assert.deepEqual(active.microphoneArgs, [false]);
const session = active.sessions[0];
const registration = active.registrations[0]; assert.equal(registration.session, session); assert.equal(Object.isFrozen(registration.binding), true);
for (const [field,value] of Object.entries({ accountId: "account", host: "host", serverId: "server", roomId: "room",
  localUserId: "local-user", localSessionId: "local-session", socket: active.socket, peerConnection: active.pc, connectionEpoch: 1 })) assert.equal(registration.binding[field], value);
assert.equal(session.options.rtcConfiguration, active.inheritedIce); assert.equal(session.options.allowNetwork, true);
assert.equal(typeof session.options.pathUnderlayResolver?.resolve, "function");
assert.equal(session.options.microphoneCodec.maxBitrateBps, 64000);
assert.equal(session.options.getPeerConnection(), active.pc); assert.equal(session.options.isCurrent(), true);
const remote = { participantId: "remote-user", sessionId: "remote-session", publicationId: "remote-publication" };
assert.equal(session.options.getSource(remote), active.source);
active.roster["local-session"].serverUserId = "another-local-user"; assert.equal(session.options.isCurrent(), false);
active.roster["local-session"].serverUserId = "local-user"; assert.equal(session.options.isCurrent(), true);
active.setEpoch(2); assert.equal(session.options.isCurrent(), false); active.setEpoch(1);
assert.equal(session.options.getSource({ ...remote, participantId: "wrong-user" }), null);
active.roster["remote-session"].screenShareAudioStreamID = "remote-publication";
assert.equal(session.options.getSource(remote), null); delete active.roster["remote-session"].screenShareAudioStreamID;
active.socket.id = "new-session"; assert.equal(session.options.isCurrent(), false); assert.equal(session.options.getSource(remote), null);
active.dispose(); assert.equal(session.disposed, true); assert.equal(registration.released, true);
for (const guard of [{ missingLocal: true }, { missingEpoch: true }]) {
  const unavailableContext = fixture(standardPeerPolicy, guard); await Promise.resolve();
  assert.equal(unavailableContext.sessions.length, 0); assert.equal(unavailableContext.registrations.length, 0); unavailableContext.dispose();
}
const capped = fixture(standardPeerPolicy, { channelCap: 16000 }); await Promise.resolve();
assert.equal(capped.sessions[0].options.microphoneCodec.maxBitrateBps, 64000);
assert.equal(capped.sessions[0].options.channelMaxBitrateBps, 16000); capped.dispose();
const explicitIce = { iceServers: [] }, override = fixture({ ...productPolicy, rtcConfiguration: explicitIce }, { badConfiguration: true });
await Promise.resolve(); assert.equal(override.sessions[0].options.rtcConfiguration, explicitIce); assert.equal(override.configurationReads, 0); override.dispose();
const unavailable = fixture(productPolicy, { badConfiguration: true }); await Promise.resolve(); await Promise.resolve();
assert.equal(unavailable.sessions.length, 0); assert.equal(unavailable.emitted[0].status, "unsupported"); unavailable.dispose();
console.log("PASS private main/preload/renderer opt-in, browser/i18n absence, chrome preservation, current ICE inheritance/override, auth/publication scope, retired socket, ownership cleanup and SFU fallback; pure VM only");
