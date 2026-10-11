/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] || fileURLToPath(new URL("../", import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const code = stripTypeScriptTypes(read("src/packages/lib/receiveAudio.ts"));
const { receiveAudioRoles, applyReceiveAudioRoles, setReceiveAudioGain } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const roles = receiveAudioRoles([{ streamID: "mic", screenShareAudioStreamID: "screen" }, { streamID: "screen" }]);
assert.equal(roles.get("mic"), "microphone");
assert.equal(roles.get("screen"), "screen");
assert.equal(roles.get("unknown"), undefined);
assert.equal(receiveAudioRoles([]).size, 0);
const roleCalls = [];
const makeSource = label => ({ receiveCleanup: { setRole: role => roleCalls.push([label, role]) } });
const sources = { mic: makeSource("first mic"), screen: makeSource("screen"), late: makeSource("late") };
const members = [{ streamID: "mic", screenShareAudioStreamID: "screen" }];
applyReceiveAudioRoles(sources, members);
assert.deepEqual(roleCalls.splice(0), [["first mic", "microphone"], ["screen", "screen"], ["late", "unknown"]]);
sources.mic = makeSource("rebuilt mic");
applyReceiveAudioRoles(sources, [...members, { streamID: "late" }]);
assert.deepEqual(roleCalls.splice(0), [["rebuilt mic", "microphone"], ["screen", "screen"], ["late", "microphone"]]);
applyReceiveAudioRoles(sources, []);
assert.deepEqual(roleCalls.splice(0), [["rebuilt mic", "unknown"], ["screen", "unknown"], ["late", "unknown"]]);
// Aliases share one ReceiveStreamControl: resolve role priority per physical route.
const permutations = values => values.length === 0 ? [[]] : values.flatMap((value, index) =>
  permutations(values.filter((_, i) => i !== index)).map(rest => [value, ...rest]));
let aliasCases = 0;
for (const order of permutations(["mic", "alias"])) {
  const shared = makeSource("shared mic");
  applyReceiveAudioRoles(Object.fromEntries(order.map(id => [id, shared])), [{ streamID: "mic" }]);
  assert.deepEqual(roleCalls.splice(0), [["shared mic", "microphone"]], `mic alias order: ${order}`);
  ++aliasCases;
}
for (const order of permutations(["mic", "screen", "alias"])) {
  const shared = makeSource("shared screen");
  applyReceiveAudioRoles(Object.fromEntries(order.map(id => [id, shared])), members);
  assert.deepEqual(roleCalls.splice(0), [["shared screen", "screen"]], `screen alias order: ${order}`);
  ++aliasCases;
}
const sharedRoute = makeSource("transition");
const aliases = { mic: sharedRoute, screen: sharedRoute, alias: sharedRoute };
applyReceiveAudioRoles(aliases, members);
applyReceiveAudioRoles(aliases, [{ streamID: "mic" }]);
applyReceiveAudioRoles(aliases, []);
assert.deepEqual(roleCalls.splice(0), [["transition", "screen"], ["transition", "microphone"], ["transition", "unknown"]]);
++aliasCases;
applyReceiveAudioRoles({ alias: sharedRoute }, members);
assert.deepEqual(roleCalls.splice(0), [["transition", "unknown"]], "removing known alias resets surviving route");
++aliasCases;
const rebuiltRoute = makeSource("rebuilt alias route");
applyReceiveAudioRoles({ mic: rebuiltRoute, alias: rebuiltRoute }, [{ streamID: "mic" }]);
assert.deepEqual(roleCalls.splice(0), [["rebuilt alias route", "microphone"]], "replacement receives role without touching old route");
++aliasCases;
// Distinct source wrappers with the same cleanup still operate on the same route.
for (const order of permutations(["mic", "screen", "alias"])) {
  const cleanup = { setRole(role) { assert.equal(this, cleanup); roleCalls.push(["same cleanup", role]); } };
  const wrappers = Object.fromEntries(order.map(id => [id, { receiveCleanup: cleanup }]));
  assert.notEqual(wrappers.mic, wrappers.screen);
  applyReceiveAudioRoles(wrappers, members);
  assert.deepEqual(roleCalls.splice(0), [["same cleanup", "screen"]], `cleanup identity: ${order}`);
  ++aliasCases;
}
const legacy = {};
applyReceiveAudioRoles({ mic: legacy, alias: legacy, screen: makeSource("modern") }, members);
assert.deepEqual(roleCalls.splice(0), [["modern", "screen"]], "legacy routes without cleanup are ignored");
++aliasCases;
const independent = { mic: makeSource("independent mic"), screen: makeSource("independent screen") };
applyReceiveAudioRoles(independent, members);
assert.deepEqual(roleCalls.splice(0), [["independent mic", "microphone"], ["independent screen", "screen"]]);
++aliasCases;
applyReceiveAudioRoles({}, members);
assert.deepEqual(roleCalls.splice(0), []);
++aliasCases;
console.log(`Receive alias regressions: ${aliasCases} cases passed.`);

const calls = [];
const source = { receiveCleanup: { setMuted: value => calls.push(["muted", value]) },
  gain: { gain: { setValueAtTime: (...args) => calls.push(["gain", ...args]) } } };
for (const [value, time] of [[0, 42], [1.5, 43], [NaN, 44], [-1, 45], [Infinity, 46]]) setReceiveAudioGain(source, value, time);
assert.deepEqual(calls, [["muted", true], ["gain", 0, 42], ["muted", false], ["gain", 1.5, 43],
  ["muted", true], ["gain", 0, 44], ["muted", true], ["gain", 0, 45], ["muted", true], ["gain", 0, 46]]);
setReceiveAudioGain(undefined, 1, 0);
const legacyCalls = [];
setReceiveAudioGain({ gain: { gain: { setValueAtTime: (...args) => legacyCalls.push(args) } } }, 2, 5);
assert.deepEqual(legacyCalls, [[2, 5]]);
const settings = read("src/packages/settings/src/hooks/useAudioSettings.ts");
// Private defaults are explicitly enabled; persisted false remains respected.
assert.match(settings, /receiveLevelingEnabled: true/);
assert.match(settings, /setUserValue\("receiveLevelingEnabled", enabled\)/);
assert.match(read("src/packages/webRTC/src/adapters/voiceConfig.ts"), /receiveLevelingEnabled: s.receiveLevelingEnabled/);
const adapter = read("src/packages/webRTC/src/adapters/useReceiveAudioRoles.ts");
assert.match(adapter, /registry\.reconcile\(/);
assert.match(adapter, /\[registry, scopeKey, clients, currentServerConnected, currentChannelConnected, connectionState, isConnected, streamSources\]/);
for (const file of ["hooks/useServerState.ts", "components/LegacyMediaVoiceView.tsx", "components/FocusedVideoView.tsx", "hooks/usePopoutStreams.ts"]) {
  const source = read(`src/packages/socket/src/${file}`);
  assert.ok(source.includes("setReceiveAudioGain("), file);
  assert.ok(!source.includes(".gain.gain.setValueAtTime("), file);
}
assert.doesNotMatch(read("src/packages/socket/src/components/VoiceView.tsx"),/setReceiveAudioGain|useCamera|useScreenShare|<video/);
console.log("Receive leveling: explicit roles, mute-before-gain, finite manual gain, safe default and config wiring passed.");
