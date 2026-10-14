/* eslint-env node */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url), ts = require("typescript");
function compiled(path, imports = {}) {
  const exports = {};
  const js = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(js, { exports, require: name => imports[name] ?? require(name) });
  return exports;
}
const contract = compiled("../src/lib/nativeLanAudio.ts");
const { registerNativeLanAudioIpc } = compiled("./nativeLanAudioIpc.ts", { "../src/lib/nativeLanAudio": contract });
const desired = changes => ({ serverId: "community", roomId: "room", epoch: "epoch", localIp: "10.203.217.1",
  key: "1".repeat(64), expiresInMs: 15000, peers: [{ userId: "friend", virtualIp: "10.203.217.2" }],
  muted: false, deafened: false, inputGain: 1, outputGain: 1, memberVolumes: {}, ...changes });
function fixture(changes = {}) {
  const handlers = new Map(), calls = [], trusted = { senderFrame: {} };
  const binding = { v: 1, communityId: "community", deviceId: "device", nativeInstanceId: "instance", grantId: "grant" };
  const status = { phase: "idle", peerCount: 0 };
  const runtime = {
    stop: () => { calls.push(["audio-stop"]); return status; },
    getStatus: () => { calls.push(["audio-status"]); return status; },
    reconcile: value => { calls.push(["audio-reconcile", value]); return { ...status, phase: "starting" }; },
  };
  // If an IPC implementation accidentally crosses into ET mutation, the spy fails immediately.
  const mutateEt = () => { throw new Error("IPC must never mutate EasyTier"); };
  registerNativeLanAudioIpc({ handle: (name, fn) => handlers.set(name, fn) }, {
    allowed: event => event === trusted,
    runtime,
    binding: serverId => { calls.push(["binding", serverId]); return binding; },
    virtualIp: serverId => { calls.push(["virtual-ip", serverId]); return serverId === "community" ? "10.203.217.1" : undefined; },
    start: mutateEt, stop: mutateEt, reconcile: mutateEt, ...changes,
  });
  return { invoke: (name, value, event = trusted) => handlers.get(name)(event, value), handlers, calls, binding, status };
}

test("binding contains exact current device proof handles only, no secret and no ET mutation", async () => {
  const f = fixture(); assert.deepEqual(await f.invoke("native-lan-audio-binding", "community"), f.binding);
  assert.deepEqual(f.calls, [["virtual-ip", "community"], ["binding", "community"]]);
  assert.deepEqual(Array.from(f.handlers.keys()).sort(), ["native-lan-audio-binding", "native-lan-audio-reconcile", "native-lan-audio-status"]);
});
test("all native IPC requires trusted main renderer frame before any binding or runtime calls", async () => {
  const f = fixture();
  for (const [name, value] of [["native-lan-audio-binding", "community"], ["native-lan-audio-reconcile", desired()],
    ["native-lan-audio-reconcile", null], ["native-lan-audio-status", undefined]]) {
    await assert.rejects(async () => f.invoke(name, value, { senderFrame: {} }), /native-audio-unavailable/);
  }
  assert.deepEqual(f.calls, []);
});
test("authenticated own LAN address and active binding allow only normalized audio desired state", async () => {
  const f = fixture(); assert.equal((await f.invoke("native-lan-audio-reconcile", desired({ junk: "discard" }))).phase, "starting");
  assert.deepEqual(f.calls.map(c => c[0]), ["virtual-ip", "binding", "audio-reconcile"]);
  const requested = f.calls[2][1]; assert.equal(requested.localIp, "10.203.217.1");
  assert.equal(requested.peers[0].canPublish, true); assert.equal(requested.junk, undefined);
});
test("different own address, unknown community, public peers and invalid control fail closed by stopping audio", async () => {
  for (const input of [desired({ localIp: "10.203.217.9" }), desired({ serverId: "other-community" }),
    desired({ peers: [{ userId: "friend", virtualIp: "1.1.1.1" }] }), desired({ outputGain: 5 })]) {
    const f = fixture(); await assert.rejects(async () => f.invoke("native-lan-audio-reconcile", input), /native-voice-lan-unavailable/);
    assert.equal(f.calls.at(-1)[0], "audio-stop"); assert.ok(!f.calls.some(c => c[0] === "audio-reconcile"));
  }
});
test("expired/replaced grant throws and stops current audio without ET shutdown", async () => {
  const f = fixture({ binding: () => { throw new Error("expired-grant-with-private-context"); } });
  await assert.rejects(async () => f.invoke("native-lan-audio-reconcile", desired()), /^Error: native-voice-lan-unavailable$/);
  assert.deepEqual(f.calls, [["virtual-ip", "community"], ["audio-stop"]]);
});
test("explicit leave remains available with missing grant or disconnected LAN, touches only audio", async () => {
  const unavailable = () => { throw new Error("must not read bindings on leave"); };
  const f = fixture({ binding: unavailable, virtualIp: unavailable });
  assert.deepEqual(await f.invoke("native-lan-audio-reconcile", null), f.status);
  assert.deepEqual(f.calls, [["audio-stop"]]);
  assert.deepEqual(await f.invoke("native-lan-audio-status"), f.status);
  assert.deepEqual(f.calls, [["audio-stop"], ["audio-status"]]);
});
