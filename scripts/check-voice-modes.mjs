import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path) {
  const code = ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; vm.runInNewContext(code, { exports, Date, Map, WeakMap, Set, Number, JSON, Object }); return exports;
}
const server = load(new URL("../../gryt-server-squad-work/src/socket/handlers/voiceMode.ts", import.meta.url));
const client = load(new URL("../src/lib/voiceMode.ts", import.meta.url));
const base = { v: 1, seq: 1, inputMode: "voice_activity", squad: "standby", transmit: "normal" };
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
check("identical whitelist contract", () => assert.equal(JSON.stringify(client.parseVoiceMode(base)), JSON.stringify(server.parseVoiceMode(base))));
check("private keys/path/raw events rejected by both endpoints", () => {
  for (const field of ["keys", "process", "path", "events", "accessToken"]) {
    assert.equal(client.parseVoiceMode({ ...base, [field]: "private" }), null);
    assert.equal(server.parseVoiceMode({ ...base, [field]: "private" }), null);
  }
});
check("invalid enums/version/seq rejected", () => {
  for (const bad of [{ v: 2 }, { seq: -1 }, { seq: Infinity }, { transmit: "speaking" }, { inputMode: "guessed" }]) assert.equal(server.parseVoiceMode({ ...base, ...bad }), null);
});
const derive = changes => client.deriveVoiceMode({ inputMode: "voice_activity", pttActive: false, manualMuted: false,
  serverMuted: false, squadEnabled: true, squadStatus: "suppressed", gateStatus: "ready", requestedSuppression: true, ...changes });
check("requested suppression never claims actual closed before ACK", () => assert.equal(derive({}).transmit, "pending"));
check("boundary ACK changes actual transmit", () => assert.equal(derive({ gateStatus: "suppressed" }).transmit, "squad-suppressed"));
check("suppression-ack wait distinct from release recovery", () => {
  assert.equal(derive({ gateStatus: "recovering" }).transmit, "pending");
  assert.equal(derive({ gateStatus: "recovering", requestedSuppression: false }).transmit, "resuming");
});
check("manual/server mute priority retains additional Squad reason", () => {
  const state = derive({ gateStatus: "suppressed", manualMuted: true }); assert.equal(state.transmit, "manual-muted"); assert.equal(state.squad, "suppressed");
  assert.equal(derive({ gateStatus: "suppressed", manualMuted: true, serverMuted: true }).transmit, "server-muted");
});
check("actual PTT ref controls idle, not audio level", () => {
  assert.equal(derive({ inputMode: "push_to_talk", gateStatus: "ready", requestedSuppression: false }).transmit, "ptt-idle");
  assert.equal(derive({ inputMode: "push_to_talk", pttActive: true, gateStatus: "ready", requestedSuppression: false }).transmit, "normal");
});
let time = 1000, identified = true;
const outgoing = [], own = { id: "a", emit() {} }, other = { id: "b", emit() {} }, stranger = { id: "c", emit() {} };
const clients = {
  a: { serverUserId: "alice", hasJoinedChannel: true, voiceChannelId: "one", streamID: "mic-a" },
  b: { serverUserId: "bob", hasJoinedChannel: true, voiceChannelId: "one", streamID: "mic-b" },
  c: { serverUserId: "eve", hasJoinedChannel: true, voiceChannelId: "two", streamID: "mic-c" },
};
const io = { sockets: { sockets: new Map([["a", own], ["b", other], ["c", stranger]]) }, to: room => ({ emit: (name, data) => outgoing.push({ room, name, data }) }) };
const context = (id, socket) => ({ socket, io, clientsInfo: clients, clientId: id, roomFor: r => `voice:${r}`, identified: () => identified, now: () => time });
const handlers = server.registerVoiceModeHandlers(context("a", own));
function call(event, state) { let result; handlers[event](state, value => result = value); return result; }
check("optional capabilities, no database or SFU change", () => assert.equal(call("voice:mode:capabilities", {}).supported, true));
check("anonymous or outside voice cannot publish", () => {
  identified = false; assert.equal(call("voice:mode:set", base).accepted, false); identified = true;
  clients.a.hasJoinedChannel = false; assert.equal(call("voice:mode:set", base).accepted, false); clients.a.hasJoinedChannel = true;
});
check("server binds identity and only emits inside own channel", () => {
  assert.equal(call("voice:mode:set", base).accepted, true); assert.equal(outgoing.at(-1).room, "voice:one"); assert.equal(outgoing.at(-1).data.serverUserId, "alice");
});
check("out of order and duplicate sequence rejected", () => assert.equal(call("voice:mode:set", base).accepted, false));
check("same-state duplicates deduped", () => { const before = outgoing.length; assert.equal(call("voice:mode:set", { ...base, seq: 2 }).accepted, true); assert.equal(outgoing.length, before); });
check("fetch filters other channel", () => {
  const foreign = server.registerVoiceModeHandlers(context("c", stranger)); let result;
  foreign["voice:mode:fetch"]({}, value => result = value); assert.equal(result.length, 0);
  assert.equal(call("voice:mode:fetch", {}).length, 1);
});
check("leave and stream replacement invalidate cached state", () => {
  clients.a.hasJoinedChannel = false; assert.equal(call("voice:mode:fetch", {}).length, 0); clients.a.hasJoinedChannel = true;
  clients.a.streamID = "mic-new"; assert.equal(call("voice:mode:fetch", {}).length, 0); clients.a.streamID = "mic-a";
});
check("fresh heartbeats refresh diagnostic TTL", () => { time += 2000; assert.equal(call("voice:mode:set", { ...base, seq: 3 }).accepted, true); assert.equal(call("voice:mode:fetch", {}).length, 1); });
check("stale remote state expires", () => { time += 8001; assert.equal(call("voice:mode:fetch", {}).length, 0); });
check("burst bound", () => { time += 1000; for (let seq = 4; seq < 16; seq++) assert.equal(call("voice:mode:set", { ...base, seq }).accepted, true); assert.equal(call("voice:mode:set", { ...base, seq: 16 }).accepted, false); });
check("handler registration present", () => assert.match(fs.readFileSync(new URL("../../gryt-server-squad-work/src/socket/handlers/voice.ts", import.meta.url), "utf8"), /\.\.\.registerVoiceModeHandlers/));
fs.writeFileSync(new URL("../voice-mode-evidence.json", import.meta.url), JSON.stringify({ checks: count, fakeSocketOnly: true, deployed: false }, null, 2));
console.log(`${count} voice-mode protocol checks passed`);
