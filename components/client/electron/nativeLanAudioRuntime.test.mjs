/* eslint-env node */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function compile(path, imports = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(source, { exports, require: name => imports[name] ?? require(name),
    setTimeout, clearTimeout, console }, { filename: path });
  return exports;
}
const contract = compile("../src/lib/nativeLanAudio.ts");
const { NativeLanAudioRuntime } = compile("./nativeLanAudioRuntime.ts", { "../src/lib/nativeLanAudio": contract });
const session = overrides => ({ serverId: "community", roomId: "room", epoch: "epoch-1", localIp: "10.203.217.1",
  key: "1".repeat(64), expiresInMs: 15000, peers: [{ userId: "friend", virtualIp: "10.203.217.2" }],
  muted: false, deafened: false, inputGain: 1, outputGain: 1, memberVolumes: {}, ...overrides });
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const spawned = [], statuses = [];
  const runtime = new NativeLanAudioRuntime({ shutdownMs: 5, startupMs: 1000, onStatus: s => statuses.push(s),
    verifyExecutable: () => "D:/verified/helper.exe",
    spawn: (file, args, opts) => {
      const c = new EventEmitter(); c.stdin = new PassThrough(); c.stdout = new PassThrough(); c.stderr = new PassThrough();
      c.input = ""; c.stdin.on("data", d => { c.input += d; });
      c.closed = false; c.kills = 0;
      c.close = () => { if (!c.closed) { c.closed = true; c.emit("close", 0); } };
      c.stdin.on("finish", () => { if (!options.hung) c.close(); });
      c.kill = () => { ++c.kills; if (!options.unkillable) c.close(); return true; };
      spawned.push({ c, file, args, opts }); return c;
    }, ...options.ports });
  return { runtime, spawned, statuses };
}

test("idle construction and stop never spawn or enumerate audio", async () => {
  const f = fixture(); assert.equal(f.runtime.getStatus().phase, "idle");
  await f.runtime.stop(); await f.runtime.dispose(); assert.equal(f.spawned.length, 0);
});
test("solo room starts with current controls, secret only stdin and safe process arguments", async () => {
  const f = fixture();
  await f.runtime.reconcile(session({ peers: [], muted: true, deafened: true, inputGain: 0.5, outputGain: 0 }));
  const { c, args, opts } = f.spawned[0];
  assert.deepEqual(Array.from(args), ["--stdio"]); assert.equal(opts.shell, false); assert.equal(opts.windowsHide, true);
  assert.equal(c.input.split("\n")[3], ""); assert.match(c.input, /start 1 1 0.5 0\n$/);
  c.stdout.write('{"event":"ready","peerCount":0}\n'); assert.equal(f.runtime.getStatus().phase, "running");
  assert.ok(!JSON.stringify(f.statuses).includes("1".repeat(64)));
  await f.runtime.dispose();
});
test("stable refreshed and reordered snapshots do not restart; controls and permission edits use stdin", async () => {
  const f = fixture(); const peers = [{ userId: "b", virtualIp: "10.203.217.3" }, { userId: "a", virtualIp: "10.203.217.2" }];
  await f.runtime.reconcile(session({ peers }));
  const c = f.spawned[0].c; c.stdout.write('{"event":"ready","peerCount":2}\n'); const initial = c.input;
  await f.runtime.reconcile(session({ peers: [...peers].reverse() }));
  assert.equal(c.input, initial);
  await f.runtime.reconcile(session({ peers: [peers[0], { ...peers[1], canPublish: false, canReceive: false }],
    muted: true, deafened: true, inputGain: 0.3, outputGain: 0.5, memberVolumes: { a: 0 } }));
  assert.equal(f.spawned.length, 1);
  assert.match(c.input, /deafen\nmute\ninput-gain 0.3\noutput-gain 0.5\n/);
  assert.match(c.input, /peer-gain 10.203.217.2:39177 0\npeer-permissions 10.203.217.2:39177 0 0\n/);
  await f.runtime.dispose();
});
test("room, key and endpoints change closes owned helper before replacement", async () => {
  const f = fixture(); await f.runtime.reconcile(session());
  await f.runtime.reconcile(session({ roomId: "other-room", key: "2".repeat(64) }));
  assert.equal(f.spawned.length, 2); assert.equal(f.spawned[0].c.closed, true);
  assert.match(f.spawned[0].c.input, /stop\n$/);
  await f.runtime.reconcile(session({ roomId: "other-room", key: "2".repeat(64), peers: [] }));
  assert.equal(f.spawned.length, 3); await f.runtime.dispose();
});
test("deafen precedes unmute and mute precedes undeafen when both controls change", async () => {
  const f = fixture(); await f.runtime.reconcile(session({ muted: true })); const c = f.spawned[0].c;
  let before = c.input.length;
  await f.runtime.reconcile(session({ muted: false, deafened: true }));
  assert.equal(c.input.slice(before), "deafen\nunmute\n");
  before = c.input.length;
  await f.runtime.reconcile(session({ muted: true, deafened: false }));
  assert.equal(c.input.slice(before), "mute\nundeafen\n");
  assert.equal(f.spawned.length, 1); await f.runtime.dispose();
});
test("failure codes and telemetry cannot expose helper arbitrary fields", async () => {
  const f = fixture(); await f.runtime.reconcile(session()); const c = f.spawned[0].c;
  c.stdout.write('{"event":"ready","peerCount":1,"secret":"sensitive"}\n');
  c.stdout.write('{"event":"stats","captureRms":0.25,"playbackRms":9,"packetsSent":5,"packetsReceived":-1,"secret":"sensitive"}\n');
  assert.equal(f.runtime.getStatus().packetsSent, 5); assert.equal(f.runtime.getStatus().playbackRms, 0);
  c.stdout.write('{"event":"error","code":"private-secret"}\n'); await tick();
  assert.equal(f.runtime.getStatus().error, "helper-protocol");
  await f.runtime.reconcile(session()); assert.equal(f.spawned.length, 1);
  assert.ok(!JSON.stringify(f.statuses).includes("sensitive")); await f.runtime.dispose();
});
test("invalid session fails closed, never permits LAN/public IP, duplicate identities or bad gains", async () => {
  const f = fixture();
  for (const s of [session({ localIp: "192.168.1.1" }), session({ key: "0".repeat(64) }), session({ outputGain: NaN }),
    session({ peers: [{ userId: "a", virtualIp: "10.203.217.2" }, { userId: "b", virtualIp: "10.203.217.2" }] }),
    session({ expiresInMs: 15001 })]) {
    assert.equal((await f.runtime.reconcile(s)).error, "invalid-session");
  }
  assert.equal(f.spawned.length, 0);
  await f.runtime.reconcile(session());
  await f.runtime.reconcile(session({ peers: [{ userId: "bad", virtualIp: "8.8.8.8" }] }));
  assert.equal(f.spawned[0].c.closed, true); await f.runtime.dispose();
});
test("lease expiry stops owned audio and repeated snapshot refresh renews without restart", async () => {
  const f = fixture(); await f.runtime.reconcile(session({ expiresInMs: 30 }));
  await new Promise(resolve => setTimeout(resolve, 15));
  await f.runtime.reconcile(session({ expiresInMs: 30 }));
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(f.spawned[0].c.closed, false);
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(f.spawned[0].c.closed, true);
  assert.equal(f.spawned.length, 1); assert.equal(f.runtime.getStatus().phase, "idle"); await f.runtime.dispose();
});
test("hung cleanup kills only its child; unkillable child prevents second capture", async () => {
  const f = fixture({ hung: true }); await f.runtime.reconcile(session()); await f.runtime.stop();
  assert.equal(f.spawned[0].c.kills, 1); assert.equal(f.runtime.getStatus().phase, "idle"); await f.runtime.dispose();
  const stuck = fixture({ hung: true, unkillable: true }); await stuck.runtime.reconcile(session());
  await stuck.runtime.reconcile(session({ roomId: "other" })); assert.equal(stuck.spawned.length, 1);
  assert.equal(stuck.runtime.getStatus().error, "helper-stop"); stuck.spawned[0].c.close(); await stuck.runtime.dispose();
});
test("superseded helper verification cannot spawn after leave or disposal", async () => {
  let release; const verified = new Promise(resolve => { release = resolve; });
  const f = fixture({ ports: { verifyExecutable: () => verified } });
  const pending = f.runtime.reconcile(session()); await tick(); const stop = f.runtime.stop();
  release("D:/verified/helper.exe"); await pending; await stop; assert.equal(f.spawned.length, 0);
  await f.runtime.dispose(); await f.runtime.reconcile(session()); assert.equal(f.spawned.length, 0);
});
test("hash verification and helper startup fail closed and stable events do not retry", async () => {
  const f = fixture({ ports: { verifyExecutable: () => null } });
  assert.equal((await f.runtime.reconcile(session())).error, "helper-unavailable");
  await f.runtime.reconcile(session()); assert.equal(f.spawned.length, 0); await f.runtime.dispose();
  const timeout = fixture({ ports: { startupMs: 5 } }); await timeout.runtime.reconcile(session());
  await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(timeout.runtime.getStatus().error, "helper-timeout");
  assert.equal(timeout.spawned[0].c.closed, true); await timeout.runtime.dispose();
});
