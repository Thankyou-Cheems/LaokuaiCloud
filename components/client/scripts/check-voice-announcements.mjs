import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import ts from "typescript";

const root = new URL("../", import.meta.url);
const timers = new Map(); let timerId = 0;
const setTimer = callback => { timers.set(++timerId, callback); return timerId; };
function load(path, imports = {}, globals = {}) {
  const source = readFileSync(new URL(path, root), "utf8").replaceAll("import.meta", "privateInputs");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} };
  runInNewContext(compiled, { module, exports: module.exports, require: name => {
    if(name.endsWith('/voiceFacade') && '@gryt/voice' in imports) return {...imports['@gryt/voice'],nativeVoiceEnabled:false};
    if (!(name in imports)) throw new Error(`Unexpected dependency: ${name}`);
    return imports[name];
  }, setTimeout: setTimer, clearTimeout: id => timers.delete(id), Date, ...globals });
  return module.exports;
}
const policy = load("src/lib/voiceAnnouncements.ts");
const connection = new policy.VoiceConnectionCuePolicy();
assert.equal(connection.update("", "disconnected"), undefined, "startup must not announce a disconnect");
assert.equal(connection.update("a", "recovering"), undefined, "unconfirmed initial connection stays silent");
assert.equal(connection.update("a", "connected"), "connected");
assert.equal(connection.update("a", "connected"), undefined);
assert.equal(connection.update("a", "recovering"), undefined);
assert.equal(connection.update("a", "connected"), undefined, "automatic recovery never replays connected");
assert.equal(connection.update("b", "connected"), "connected", "an actual new room is announced");
assert.equal(connection.update("", "disconnected"), "disconnected");
assert.equal(connection.update("", "disconnected"), undefined);
connection.reset(); assert.equal(connection.update("", "disconnected"), undefined);
assert.equal(policy.VOICE_PHRASES.connected, "已连接到语音频道");
const invalid = policy.resolveVoiceAnnouncements({ pack: "remote", custom: { connected: "https://unsafe.invalid/audio", moved: "data:audio/wav;base64,AAAA" } });
assert.equal(invalid.pack, "classic"); assert.equal(invalid.custom.connected, undefined);
assert.equal(invalid.custom.moved, "data:audio/wav;base64,AAAA");

let now = 1000; const played = []; const pending = [];
const queue = new policy.VoiceAnnouncementQueue(() => now);
const item = (key, allowed = () => true) => ({ key, allowed, play() {
  played.push(key); let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const playback = { finished, stop() { finish(false); }, finish };
  pending.push(playback); return playback;
} });
const spin = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
assert.equal(queue.enqueue(item("a")), true);
assert.equal(queue.enqueue(item("a")), false, "duplicate event rejected");
for (const key of ["b", "c", "d"]) assert.equal(queue.enqueue(item(key)), true);
assert.equal(queue.enqueue(item("overflow")), false, "queue contains at most one active and three waiting");
assert.deepEqual(played, ["a"], "phrases never overlap");
pending[0].finish(true); await spin(); assert.deepEqual(played, ["a", "b"]);
queue.cancel(); await spin(); assert.deepEqual(played, ["a", "b"], "cancel cannot resurrect queued old-room events");
now += 6000; queue.enqueue(item("fresh")); queue.enqueue(item("expired"));
now += 6000; pending.at(-1).finish(true); await spin(); assert.equal(played.includes("expired"), false);
let enabled = true; queue.enqueue(item("first")); queue.enqueue(item("disabled", () => enabled));
enabled = false; pending.at(-1).finish(true); await spin(); assert.equal(played.includes("disabled"), false);
queue.enqueue(item("hung")); const watchdog = [...timers.values()].at(-1); watchdog(); await spin();
queue.enqueue(item("after-hang")); assert.equal(played.at(-1), "after-hang"); queue.cancel(); await spin();

// Execute the real lifecycle hook with a deterministic React effect runner.
const slots = []; let cursor = 0; let effects = []; let rerender = false;
const react = {
  useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
  useState(value) { const i = cursor++; slots[i] ??= { value }; return [slots[i].value, next => {
    slots[i].value = typeof next === "function" ? next(slots[i].value) : next; rerender = true;
  }]; },
  useEffect(fn, deps) { const i = cursor++; const prior = slots[i];
    if (!prior || !deps || deps.some((value, index) => !Object.is(value, prior.deps[index]))) {
      effects.push(() => { prior?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
    }
  },
};
const window = new EventTarget();
const state = { connectionState: "disconnected", connectionError: "", currentServerConnected: "", currentChannelConnected: "", disconnect: async () => {} };
const settings = { isMuted: false, isDeafened: false, isServerDeafened: false, outputVolume: 100, outputDeviceID: "", peerVoiceCues: { dnd: false },
  connectSoundEnabled: true, disconnectSoundEnabled: true, voiceAnnouncements: {} };
const announced = []; let userId = "alice"; let generation = "socket1";
const hook = load("src/packages/webRTC/src/adapters/useVoiceLifecycle.tsx", {
  react, "react/jsx-runtime": { jsx() {} }, "react-hot-toast": { default: { error() {} } },
  "@gryt/voice": { useSFU: () => state, SFUConnectionState: { CONNECTED: "connected", DISCONNECTED: "disconnected", CONNECTING: "connecting" } },
  "@/common": { useUserId: () => userId }, "@/settings": { useSettings: () => settings },
  "@/socket": { useServerManagement: () => ({ servers: { host: {} } }), useSockets: () => ({ serverDetailsList: {}, sockets: { host: { id: generation } } }) },
  "../../../../lib/localDiagnostics": { localDiagnostic() {}, diagnosticCode: value => value },
  "../../../../lib/voiceAnnouncements": policy,
  "./useVoiceSounds": { cancelVoiceAnnouncements() {}, useVoiceSounds: () => ({ announce: (event, key, allowed) => { if (allowed()) announced.push([event, key]); } }) },
}, { window, CustomEvent });
function render() {
  do { rerender = false; cursor = 0; effects = []; hook.useVoiceLifecycle(); for (const effect of effects) effect(); } while (rerender);
}
render(); assert.equal(announced.length, 0);
Object.assign(state, { currentServerConnected: "host", currentChannelConnected: "room1", connectionState: "connecting" }); render();
state.connectionState = "connected"; render(); render(); assert.equal(announced.filter(([event]) => event === "connected").length, 1);
state.connectionState = "failed"; render(); state.connectionState = "connected"; render();
assert.equal(announced.filter(([event]) => event === "connected").length, 1);
const status = (phase, requestId = "move1", source = "room1", account = userId, socketGeneration = generation) => {
  window.dispatchEvent(new CustomEvent("voice_move_playback_status", { detail: {
    host: "host", source, channel: "room2", requestId, account, generation: socketGeneration, phase,
  } })); render();
};
status("promoting");
assert.equal(announced.some(([event]) => event === "moved"), false, "move prepare/commit receipt cannot announce before promotion");
state.currentChannelConnected = "room2"; render();
assert.equal(announced.filter(([event]) => event === "connected").length, 1, "generic cue waits until SDK promotion settles");
assert.equal(announced.some(([event]) => event === "moved"), false);
status("promoted"); status("promoted");
assert.equal(announced.filter(([event]) => event === "moved").length, 1);
assert.equal(announced.filter(([event]) => event === "connected").length, 1, "admin move replaces generic connected cue");
settings.isMuted = true; render(); settings.isMuted = false; render();
settings.isDeafened = true; settings.isMuted = true; render();
settings.isDeafened = false; settings.isMuted = false; render();
assert.deepEqual(announced.slice(-4).map(([event]) => event), ["microphoneMuted", "microphoneUnmuted", "outputMuted", "outputUnmuted"]);
state.connectionState = "disconnected"; state.currentChannelConnected = ""; state.currentServerConnected = ""; render(); render();
assert.equal(announced.filter(([event]) => event === "disconnected").length, 1);
userId = "bob"; render(); assert.equal(announced.filter(([event]) => event === "disconnected").length, 1, "account change retires old call");
const movedCount = () => announced.filter(([event]) => event === "moved").length;
const reconnectSource = () => {
  Object.assign(state, { currentServerConnected: "host", currentChannelConnected: "room1", connectionState: "connected" }); render();
};
reconnectSource(); status("promoting", "failed-move"); status("failed", "failed-move");
state.currentChannelConnected = "room2"; render();
assert.equal(movedCount(), 1, "failed local promotion then manual target join must not announce moved");
assert.equal(announced.at(-1)[0], "connected");
reconnectSource(); status("promoting", "left-move");
state.connectionState = "disconnected"; state.currentChannelConnected = ""; render();
state.currentChannelConnected = "room2"; state.connectionState = "connected"; render();
status("promoted", "left-move");
assert.equal(movedCount(), 1, "leaving then re-entering the target retires the original call's move");
assert.equal(announced.at(-1)[0], "connected");
reconnectSource(); status("promoting", "account-move");
userId = "carol"; render(); state.currentChannelConnected = "room2"; render();
status("promoted", "account-move", "room1", "bob");
assert.equal(movedCount(), 1, "account switch retires move even on the same host and target room");
reconnectSource(); status("promoting", "generation-move");
generation = "socket2"; render(); state.currentChannelConnected = "room2"; render();
status("promoted", "generation-move", "room1", userId, "socket1");
assert.equal(movedCount(), 1, "replacement socket cannot inherit a pending move");
for (const slot of slots) slot?.cleanup?.();
// The real provider resolves private-build inputs and preserves old imports.
const recordings = Object.fromEntries(Object.keys(policy.VOICE_PHRASES).map(event => [`/src/private-voice/manbo/${event}.wav`, `private:${event}`]));
const soundImports = {
  "@/audio/src/assets/connect.mp3": { default: "classic:connect" },
  "@/audio/src/assets/disconnect.mp3": { default: "classic:disconnect" },
  "../../../../lib/peerVoiceCues": { peerCueUrl: kind => `classic:${kind}` },
  "../../../../lib/voiceAnnouncements": policy,
};
const packs = load("src/packages/webRTC/src/adapters/voiceSoundPacks.ts", soundImports, { privateInputs: { glob: path => path.endsWith("*.wav") ? recordings : {} } });
const cache = {};
const audioImports = {
  react: {}, "@/lib/desktopNotification": { requestNotificationPermission() {} },
  "../../../../lib/peerVoiceCues": load("src/lib/peerVoiceCues.ts"),
  "../../../../lib/squadMode": load("src/lib/squadMode.ts"),
  "../../../../lib/voiceAnnouncements": policy,
  "../../../../lib/voiceTransportPreset": load("src/lib/voiceTransportPreset.ts"),
  "../../../webRTC/src/adapters/voiceSoundPacks": packs,
  "./userStorage": { getUserValue: (key, fallback) => cache[key] === undefined ? fallback : cache[key], setUserValue() { assert.fail("Loading defaults must not write preferences"); } },
};
const audioDefaults = load("src/packages/settings/src/hooks/useAudioSettings.ts", audioImports);
const volumeCurve = load("src/packages/lib/audioVolume.ts");
const freshAudio = audioDefaults.loadAudioFromCache();
assert.equal(freshAudio.connectSoundVolume, 75, "untouched Manbo defaults must not attenuate speech by 31 dB");
assert.equal(freshAudio.disconnectSoundVolume, 75);
assert.equal(freshAudio.peerVoiceCues.joinVolume, 75);
assert.equal(freshAudio.peerVoiceCues.leaveVolume, 75);
assert.equal(volumeCurve.sliderToGain(freshAudio.connectSoundVolume), 0.421875);
Object.assign(cache, { connectSoundVolume: 30, disconnectSoundVolume: 0, outputVolume: 0, outputDeviceID: "chosen-headset",
  connectSoundEnabled: false, peerVoiceCues: { enabled: false, dnd: true, joinVolume: 12, leaveVolume: 0 } });
const preserved = audioDefaults.loadAudioFromCache();
for (const key of Object.keys(cache)) assert.deepEqual(JSON.parse(JSON.stringify(preserved[key])), cache[key], `explicit ${key} must survive`);
for (const key of Object.keys(cache)) delete cache[key];
cache.voiceAnnouncements = { pack: "classic", custom: {} };
assert.equal(audioDefaults.loadAudioFromCache().connectSoundVolume, 30, "classic default stays unchanged in a private build");
assert.equal(audioDefaults.loadAudioFromCache().peerVoiceCues.joinVolume, 60);
delete cache.voiceAnnouncements;
cache.customConnectSoundFile = "imported:connect";
assert.equal(audioDefaults.loadAudioFromCache().connectSoundVolume, 30, "imported legacy sound is not made louder");
delete cache.customConnectSoundFile;
assert.equal(packs.MANBO_PACK_AVAILABLE, true);
for (const event of Object.keys(policy.VOICE_PHRASES)) assert.equal(packs.voiceSoundUrl(event, { pack: "manbo" }), `private:${event}`);
assert.equal(packs.voiceSoundUrl("connected", { pack: "manbo" }, { customConnectSoundFile: "imported:connect" }), "imported:connect");
assert.equal(packs.voiceSoundUrl("disconnected", { pack: "custom", custom: {} }, { customDisconnectSoundFile: "imported:disconnect" }), "imported:disconnect");
const noPack = load("src/packages/webRTC/src/adapters/voiceSoundPacks.ts", soundImports, { privateInputs: { glob: () => ({}) } });
assert.equal(noPack.MANBO_PACK_AVAILABLE, false);
const publicAudio = load("src/packages/settings/src/hooks/useAudioSettings.ts", { ...audioImports, "../../../webRTC/src/adapters/voiceSoundPacks": noPack });
assert.equal(publicAudio.loadAudioFromCache().connectSoundVolume, 30);
assert.equal(publicAudio.loadAudioFromCache().peerVoiceCues.joinVolume, 60);
assert.equal(noPack.voiceSoundUrl("connected", { pack: "manbo" }), "classic:connect", "previous manbo preference cannot silence a build without private inputs");
assert.equal(packs.voiceSoundUrl("peerJoined", { pack: "custom", custom: {} }), undefined);
const audioPlays = [];
Object.assign(settings, { voiceAnnouncements: { pack: "manbo", custom: {} }, peerVoiceCues: { enabled: true, dnd: false, joinVolume: 60, leaveVolume: 60 },
  connectSoundVolume: 30, disconnectSoundVolume: 30 });
const sounds = load("src/packages/webRTC/src/adapters/useVoiceSounds.ts", {
  react: { useRef: value => ({ current: value }), useCallback: fn => fn },
  "@/settings": { useSettings: () => settings },
  "@/lib/notificationSound": { playNotificationSound(url, volume, options) {
    assert.equal(options.shouldPlay(), true); audioPlays.push([url, volume]); return { stop() {}, finished: Promise.resolve(true) };
  } }, "../../../../lib/voiceAnnouncements": policy, "./voiceSoundPacks": packs,
});
const { announce } = sounds.useVoiceSounds();
settings.isDeafened = true;
assert.equal(announce("peerJoined", "silent-peer"), false);
assert.equal(announce("outputMuted", "local-deafen"), true); await spin();
assert.equal(audioPlays.at(-1)[0], "private:outputMuted", "local deafen receives one acknowledgement");
settings.peerVoiceCues.dnd = true; assert.equal(announce("outputMuted", "dnd-local"), false);
settings.peerVoiceCues.dnd = false; settings.isServerDeafened = true; assert.equal(announce("outputMuted", "server-local"), false);
settings.isServerDeafened = false; settings.outputVolume = 0; assert.equal(announce("outputMuted", "zero-local"), false);
settings.outputVolume = 100; settings.isDeafened = false; settings.isMuted = false;
assert.equal(announce("microphoneMuted", "stale-mute"), false);
settings.connectSoundEnabled = false; assert.equal(announce("connected", "disabled"), false);
settings.connectSoundEnabled = true; settings.customConnectSoundFile = "imported:connect";
assert.equal(announce("connected", "import-priority"), true); await spin(); assert.equal(audioPlays.at(-1)[0], "imported:connect");
sounds.cancelVoiceAnnouncements(); await spin();
// All nine real preview buttons and the live hook receive the same saved/default
// percentages. No audio hardware is opened by this deterministic fixture.
Object.assign(settings, freshAudio, { isDeafened: false, isServerDeafened: false, isMuted: false });
const jsx = (type, props) => ({ type, props });
let previewEligible;
const previewComponent = load("src/packages/settings/src/components/VoiceAnnouncementSettings.tsx", {
  "@gryt/ui": { Button: "Button", Select: "Select" },
  react: { useRef: value => ({ current: value }), useEffect: fn => fn() },
  "react/jsx-runtime": { jsx, jsxs: jsx }, "@/settings": { useSettings: () => settings },
  "@/lib/notificationSound": { playNotificationSound(url, volume, options) { previewEligible = options.shouldPlay;
    assert.equal(previewEligible(), true); audioPlays.push([url, volume]); return { stop() {}, finished: Promise.resolve(true) }; } },
  "../../../../lib/voiceAnnouncements": policy, "../../../webRTC/src/adapters/voiceSoundPacks": packs,
  "./settingsComponents": { SettingGroup: "Group" }, "./SoundSettings": { SoundSettings: "SoundSettings" },
}).VoiceAnnouncementSettings;
const previewView = previewComponent({ showAlert() {} });
const buttons = [];
const visit = node => {
  if (Array.isArray(node)) { node.forEach(visit); return; }
  if (!node?.props) return;
  if (node.type === "Button") buttons.push(node);
  visit(node.props.children);
};
visit(previewView); assert.equal(buttons.length, 9);
for (const [index, event] of Object.keys(policy.VOICE_PHRASES).entries()) {
  assert.equal(buttons[index].props.disabled, false);
  buttons[index].props.onClick(); const previewPlay = audioPlays.at(-1);
  settings.isMuted = event === "microphoneMuted";
  settings.isDeafened = event === "outputMuted";
  assert.equal(announce(event, `audible:${event}`), true); await spin();
  assert.deepEqual(audioPlays.at(-1), previewPlay, `preview/live ${event} volume agrees`);
  assert.equal(audioPlays.at(-1)[1], 75);
  settings.isDeafened = false;
}
sounds.cancelVoiceAnnouncements(); await spin();
buttons[0].props.onClick(); settings.peerVoiceCues.dnd = true;
assert.equal(previewEligible(), false, "DND selected during decode cancels a pending preview");
settings.peerVoiceCues.dnd = false; settings.peerVoiceCues.enabled = false;
buttons.length = 0; visit(previewComponent({ showAlert() {} }));
assert.equal(buttons[2].props.disabled, true, "disabled peer cues cannot preview from the announcement list");
settings.peerVoiceCues.enabled = true;
// Actual socket adapter: no roster/self/foreign-room event may invent a cue.
slots.length = 0;
const listeners = new Map(); const peerEvents = [];
const socket = { connected: true, id: "self", on(event, fn) { listeners.set(event, fn); }, off(event, fn) {
  if (listeners.get(event) === fn) listeners.delete(event);
} };
let peerChannel = "room1";
const peerHook = load("src/packages/webRTC/src/adapters/usePeerVoiceCues.ts", {
  react, "@gryt/voice": { useSFU: () => ({ isConnected: true, currentServerConnected: "host", currentChannelConnected: peerChannel }) },
  "@/settings": { useSettings: () => settings }, "@/socket": { useSockets: () => ({ sockets: { host: socket } }) },
  "../../../../lib/peerVoiceCues": load("src/lib/peerVoiceCues.ts"),
  "./useVoiceSounds": { useVoiceSounds: () => ({ announce: (event, key, allowed) => { if (allowed()) peerEvents.push([event, key]); } }) },
});
const renderPeers = () => { cursor = 0; effects = []; peerHook.usePeerVoiceCues(); for (const effect of effects) effect(); };
renderPeers(); assert.deepEqual([...listeners.keys()].sort(), ["voice:peer:joined", "voice:peer:left"]);
listeners.get("voice:peer:joined")({ clientId: "self", channelId: "room1" });
listeners.get("voice:peer:joined")({ clientId: "other", channelId: "foreign" });
assert.equal(peerEvents.length, 0);
listeners.get("voice:peer:joined")({ clientId: "other", channelId: "room1" });
listeners.get("voice:peer:joined")({ clientId: "other", channelId: "room1" });
assert.equal(peerEvents.length, 1);
const oldRoomCallback = listeners.get("voice:peer:joined");
peerChannel = "room2"; renderPeers();
oldRoomCallback({ clientId: "late", channelId: "room1" }); assert.equal(peerEvents.length, 1);
listeners.get("voice:peer:left")({ clientId: "peer", channelId: "room2" });
assert.equal(peerEvents.at(-1)[0], "peerLeft");
settings.isDeafened = true; renderPeers();
listeners.get("voice:peer:joined")({ clientId: "silent", channelId: "room2" }); assert.equal(peerEvents.length, 2);
for (const slot of slots) slot?.cleanup?.(); assert.equal(listeners.size, 0);
// Execute the real move coordinator: server confirmation alone is insufficient.
const movePhases = [];
window.addEventListener("voice_move_playback_status", event => movePhases.push(event.detail.phase));
async function coordinatorCase(rejection) {
  slots.length = 0; const handlers = new Map(); let resolveCommit, rejectCommit;
  const commit = new Promise((resolve, reject) => { resolveCommit = resolve; rejectCommit = reject; });
  const request = { requestId: "exact", sourceChannelId: "source", destinationChannelId: "target", generation: "g", channelSettings: {} };
  const transport = { isConnected: true, currentServerConnected: "host", currentChannelConnected: "source",
    prepareMove: async () => ({ requestId: "exact", streamId: "stream" }), commitMove: () => commit,
    abortMove: async () => {}, resumeMoveTransmission: async () => {} };
  const moveSocket = { connected: true, id: "g", on: (event, fn) => handlers.set(event, fn), off: event => handlers.delete(event) };
  const authority = { stagingSupported: true, generation: "g", confirmCommit: async () => ({ status: "committed", sourceChannelId: "source", destinationChannelId: "target" }),
    getDestinationPolicy: () => ({}), isDestinationPolicyApplied: () => true, onInvalidated: () => () => {} };
  const coordinator = load("src/packages/webRTC/src/adapters/useVoiceMoves.ts", {
    react: { ...react, createElement: () => ({}) }, "react-hot-toast": { default: { error() {} } },
    "@/common": { useUserId: () => "alice" }, "@/i18n": { i18n: { t: value => value } },
    "@gryt/voice": { useSFU: () => transport, useMicrophone: () => ({ transmissionState: { publicationRevision: 1 } }) },
    "@/socket": { useSockets: () => ({ sockets: { host: moveSocket } }) },
    "../../../../lib/movePrepare": { readMovePrepare: value => value },
    "../../../socket/src/utils/tokenManager": { emitAuthenticated: async () => true },
    "../components/VoiceMoveRecoveryNotice": { VoiceMoveRecoveryNotice() {} },
  }, { window, CustomEvent });
  cursor = 0; effects = []; coordinator.useVoiceMoves({ host: authority }, () => {}); for (const effect of effects) effect();
  handlers.get("voice:move:prepare")(request); await spin();
  const offset = movePhases.length;
  handlers.get("voice:move:result")({ v: 1, ...request, status: "committed" }); await spin();
  assert.deepEqual(movePhases.slice(offset), ["promoting"], "the SDK promise has not promoted the destination yet");
  if (rejection) rejectCommit(rejection); else { transport.currentChannelConnected = "target"; resolveCommit(); }
  await spin();
  assert.deepEqual(movePhases.slice(offset), ["promoting", rejection ? "failed" : "promoted"]);
  for (const slot of slots) slot?.cleanup?.();
}
await coordinatorCase(new Error("not_ready"));
await coordinatorCase(Object.assign(new Error("destination recovery"), { code: "destination_recovery_required" }));
await coordinatorCase();
assert.equal(timers.size, 0, "queue cleanup releases timers");
console.log("Voice announcements: fixed phrases, import validation, confirmed lifecycle events, reconnect silence, move promotion, audio toggles, bounded serial queue, cancellation, expiry and watchdog passed");
