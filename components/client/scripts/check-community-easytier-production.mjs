/* eslint-env node */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { unzipSync } from "fflate";
import ts from "typescript";

// All runtime/filesystem/socket/child-process ports are mocked. Static archive read is optional.
const forbidden = () => { throw new Error("Runtime execution is forbidden in these checks"); };
let timerId = 0;
const timers = new Map();
const deps = {
  "node:crypto": crypto, "node:path": path, "fflate": { unzipSync },
  "node:fs/promises": { mkdir: forbidden, readFile: forbidden, rename: forbidden, writeFile: forbidden, realpath: forbidden, stat: forbidden },
  "node:child_process": { spawn: forbidden, execFile: forbidden }, "node:net": { createServer: forbidden },
};
function compile(file) {
  const code = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, AbortController, Date, Buffer, Uint8Array, Set, Map, URL,
    performance: { now: () => 1000 }, process: { platform: "win32", env: {} },
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id), fetch: forbidden,
    require: key => { assert.ok(key in deps, `Unmocked import ${key}`); return deps[key]; },
  });
  return exports;
}
deps["./easyTierStatus"] = compile("electron/easyTierStatus.ts");
deps["./easyTierMemberAdapter"] = compile("electron/easyTierMemberAdapter.ts");
deps["./easyTierCommunityManager"] = compile("electron/easyTierCommunityManager.ts");
deps["./easyTierTarget"] = compile("electron/easyTierTarget.ts");
const assets = compile("electron/easyTierWindowsAssets.ts"); deps["./easyTierWindowsAssets"] = assets;
const configuration = compile("electron/easyTierExistingConfiguration.ts");
const processes = compile("electron/easyTierWindowsProcesses.ts");
const { WindowsEasyTierCliRuntime } = compile("electron/windowsEasyTierCliRuntime.ts");
const { EasyTierCommunitySubscriptions, easyTierCommunityAction } = compile("src/lib/easyTierCommunitySubscriptions.ts");
const plain = v => JSON.parse(JSON.stringify(v));
const defer = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const scope = (serverId = "synthetic-community", signal = new AbortController().signal) => ({ serverId, generation: 1, signal });
const config = { serverId: "synthetic-community", instanceId: "00000000-0000-4000-8000-000000000001", networkName: "synthetic-community", configFile: path.resolve("never-read.toml"), configSha256: "a".repeat(64), bootstrap: "product-owned" };
const receipt = () => ({ schemaVersion: 1, approved: true, driverPermissionApproved: true, localManagementApproved: true, communities: [config] });
function ports(overrides = {}) {
  const calls = []; let live = true;
  const core = { isAlive: () => live, readNode: async () => ({ peerId: 1, virtualIp: "10.9.8.7" }), close: async () => { calls.push("close"); live = false; }, terminateOwned() { calls.push("terminate"); live = false; } };
  return { calls, core, platform: "win32", configuration: async id => { calls.push("configuration"); return { ...config, serverId: id }; },
    permission: async () => { calls.push("permission"); return true; }, verifiedAssets: async () => { calls.push("assets"); return "never-read"; },
    start: async () => { calls.push("start"); return core; }, shutdownOwned: () => core.terminateOwned(), pause: async () => {}, ...overrides };
}
let checks = 0;
async function test(name, run) { await run(); console.log(`ok ${++checks} ${name}`); }
await test("receipt approval, token permission and public-bootstrap gates cannot be skipped", async () => {
  assert.equal(configuration.parseEasyTierActivationReceipt(receipt()).communities.length, 1);
  for (const [changes, reason] of [[{ approved: false }, "activation-required"], [{ driverPermissionApproved: false }, "needs-permission"], [{ localManagementApproved: false }, "needs-permission"], [{ communities: [{ ...config, bootstrap: "public" }] }, "configuration-required"]]) {
    assert.throws(() => configuration.parseEasyTierActivationReceipt({ ...receipt(), ...changes }), e => e.reason === reason);
  }
  assert.throws(() => configuration.parseEasyTierActivationReceipt({ ...receipt(), communities: [config, config] }), e => e.reason === "configuration-required");
});
await test("missing configuration cannot touch permissions, assets or processes", async () => {
  const p = ports({ configuration: async () => { throw new deps["./easyTierCommunityManager"].EasyTierOperationError("configuration-required"); } });
  await assert.rejects(new WindowsEasyTierCliRuntime(p).connect(scope()), e => e.reason === "configuration-required");
  assert.deepEqual(p.calls, []);
});
await test("unprivileged user gets needs-permission before any executable access", async () => {
  const p = ports({ permission: async () => false });
  await assert.rejects(new WindowsEasyTierCliRuntime(p).connect(scope()), e => e.reason === "needs-permission");
  assert.deepEqual(p.calls, ["configuration"]);
});
await test("missing static assets never start core", async () => {
  const p = ports({ verifiedAssets: async () => { throw new deps["./easyTierCommunityManager"].EasyTierOperationError("runtime-required"); } });
  await assert.rejects(new WindowsEasyTierCliRuntime(p).connect(scope()), e => e.reason === "runtime-required");
  assert.deepEqual(p.calls, ["configuration", "permission"]);
});
await test("official CLI read produces private local virtual IP and no user route claims", async () => {
  const p = ports(); const runtime = new WindowsEasyTierCliRuntime(p); const session = await runtime.connect(scope());
  const sample = await session.read(new AbortController().signal);
  assert.equal(deps["./easyTierStatus"].projectEasyTierStatus(sample, scope(), 1000).virtualIp, null); // wrong instance scope rejects
  assert.equal(deps["./easyTierStatus"].projectEasyTierStatus(sample, { ...scope(), instanceId: config.instanceId }, 1000).virtualIp, "10.9.8.7");
  assert.deepEqual(plain(sample.bindings), []);
  assert.equal(deps["./easyTierMemberAdapter"].projectEasyTierMembers(sample, { ...scope(), instanceId: config.instanceId }, "connected", 1000, Date.now(), 10000), null);
  await session.close(); await session.close(); assert.equal(p.calls.filter(c => c === "close").length, 1);
});
await test("concurrent second community cannot launch another core or restart active LAN", async () => {
  const pending = defer(); const p = ports({ configuration: () => pending.promise }); const runtime = new WindowsEasyTierCliRuntime(p);
  const first = runtime.connect(scope());
  await assert.rejects(runtime.connect(scope()), e => e.reason === "multi-community-unavailable");
  await assert.rejects(runtime.connect(scope("other-community")), e => e.reason === "multi-community-unavailable");
  pending.resolve(config); const session = await first;
  assert.equal(p.calls.filter(c => c === "start").length, 1); assert.ok(p.core.isAlive()); await session.close();
});
await test("cancel while own launch is pending closes its late handle", async () => {
  const pending = defer(), dispatched = defer(); const p = ports({ start: () => { dispatched.resolve(); return pending.promise; } }); const runtime = new WindowsEasyTierCliRuntime(p);
  const cancel = new AbortController(); const start = runtime.connect(scope("synthetic-community", cancel.signal));
  await dispatched.promise;
  cancel.abort(); pending.resolve(p.core); await assert.rejects(start); assert.equal(p.calls.filter(c => c === "close").length, 1);
});
await test("failed readiness cleans owned core and cannot leave a false connected state", async () => {
  const p = ports(); p.core.readNode = async () => ({ peerId: 1, virtualIp: null });
  await assert.rejects(new WindowsEasyTierCliRuntime(p).connect(scope()), e => e.reason === "connect-failed");
  assert.equal(p.calls.filter(c => c === "close").length, 1);
});
await test("unconfirmed startup cleanup retains ownership and retries before replacement", async () => {
  const p = ports(); let fail = true, reads = 0;
  p.core.readNode = async () => ({ peerId: 1, virtualIp: ++reads > 12 ? "10.9.8.7" : null });
  p.core.close = async () => { if (fail) throw new Error("unconfirmed"); p.calls.push("close"); };
  const runtime = new WindowsEasyTierCliRuntime(p);
  await assert.rejects(runtime.connect(scope()), e => e.reason === "cleanup-failed");
  await assert.rejects(runtime.connect(scope("other-community")), e => e.reason === "multi-community-unavailable");
  fail = false; const replacement = await runtime.connect(scope());
  assert.equal(p.calls.filter(c => c === "close").length, 1); await replacement.close();
});
await test("shutdown is exact owned-process port and terminal for late connect", async () => {
  const p = ports(); const runtime = new WindowsEasyTierCliRuntime(p); await runtime.connect(scope());
  runtime.shutdownOwned(); runtime.shutdownOwned(); assert.equal(p.calls.filter(c => c === "terminate").length, 1);
  await assert.rejects(runtime.connect(scope()));
});
await test("real CLI node output is sanitized before entering lifecycle status", async () => {
  const value = processes.sanitizedEasyTierCliNode({ peer_id: 7, ipv4_addr: "10.9.8.7/24", config: "must-not-leave-main", stun_info: { public_ip: ["must-not-leave-main"] }, ip_list: {} });
  assert.deepEqual(plain(value), { peerId: 7, virtualIp: "10.9.8.7" });
  assert.equal(processes.sanitizedEasyTierCliNode({ peer_id: 7, ipv4_addr: "8.8.8.8" }).virtualIp, null);
  assert.throws(() => processes.sanitizedEasyTierCliNode([{ peer_id: 7 }]));
  const args = plain(processes.easyTierCoreArguments(config, "127.0.0.1:34567"));
  assert.deepEqual(args.slice(0, 5), ["--disable-env-parsing", "--rpc-portal", "127.0.0.1:34567", "--rpc-portal-whitelist", "127.0.0.1/32"]);
  assert.ok(!args.includes("--network-secret")); assert.ok(!args.includes("--config-server"));
  assert.ok(args.includes("--laokuai-owned-stdin"));
  assert.deepEqual(plain(processes.easyTierCliArguments(config.instanceId, "127.0.0.1:34567")).slice(-4), ["--output", "json", "node", "info"]);
});
await test("membership synchronization ignores room changes and does not close LAN on renderer remount", async () => {
  const calls = [];
  const api = { syncMemberships: async ids => { calls.push([...ids]); return []; }, connect: async () => { calls.push("retry"); } };
  const owner = new EasyTierCommunitySubscriptions(api, () => {});
  owner.reconcile(["server-a"]); owner.reconcile(["server-a", "server-a"]); owner.reconcile(["server-a"]);
  owner.dispose(); assert.deepEqual(calls, [["server-a"]]);
  const fresh = new EasyTierCommunitySubscriptions(api, () => {}); fresh.reconcile([]);
  assert.deepEqual(calls, [["server-a"], []]); // reload removes retained stale main lease
});
await test("actionable missing permission/config copy preserves independent SFU voice", async () => {
  for (const reason of ["needs-permission", "configuration-required", "runtime-required", "multi-community-unavailable"]) {
    const action = easyTierCommunityAction({ phase: "activation-required", reason });
    assert.ok(action.message.length > 10); assert.ok(!action.message.includes("network_secret"));
  }
  assert.ok(easyTierCommunityAction({ reason: "needs-permission" }).message.includes("不会自行提权"));
});
await test("existing config path/hash is read only inside the product-owned root", async () => {
  const io = deps["node:fs/promises"], saved = { ...io };
  const root = path.resolve("synthetic-not-a-profile");
  const text = Buffer.from("synthetic pure test data");
  let entry = { ...config, configFile: path.join(root, "configs", "synthetic.toml"), configSha256: assets.easyTierSha256(text) };
  const touched = [];
  io.stat = async () => ({ size: 10 }); io.realpath = async file => file;
  io.readFile = async file => { touched.push(file); return file.endsWith("activation.json") ? JSON.stringify({ ...receipt(), communities: [entry] }) : text; };
  try {
    assert.equal((await configuration.readEasyTierExistingConfiguration(root, config.serverId)).configFile, entry.configFile);
    assert.equal(touched.length, 2);
    entry = { ...entry, configFile: path.resolve("outside-synthetic-root.toml") };
    await assert.rejects(configuration.readEasyTierExistingConfiguration(root, config.serverId), e => e.reason === "configuration-required");
    assert.equal(touched.length, 3); // outside config bytes never read
    entry = { ...entry, configFile: path.join(root, "configs", "synthetic.toml"), configSha256: "b".repeat(64) };
    await assert.rejects(configuration.readEasyTierExistingConfiguration(root, config.serverId), e => e.reason === "configuration-required");
  } finally { Object.assign(io, saved); }
});
await test("owned process implementation uses fake child handles and exact CLI selector only", async () => {
  const cp = deps["node:child_process"], net = deps["node:net"], savedCp = { ...cp }, savedNet = { ...net };
  const children = [], invocations = [];
  class FakeChild extends EventEmitter {
    pid = 123; exitCode = null; signalCode = null; kills = 0;
    stdout = new EventEmitter();
    stdin = Object.assign(new EventEmitter(), { end: command => {
      assert.equal(command, "LAOKUAI_OWNED_STOP_V1\n");
      this.stdout.emit("data", Buffer.from("LAOKUAI_OWNED_STOPPED_V1\n"));
      this.exitCode = 0; this.emit("exit", 0);
    } });
    kill() { this.kills++; this.exitCode = 0; this.emit("exit", 0); return true; }
  }
  const foreign = new FakeChild(); // represents the user's process, never given to this implementation
  cp.spawn = (file, args, options) => {
    invocations.push({ file, args, options }); const child = new FakeChild(); children.push(child);
    Promise.resolve().then(() => child.emit("spawn")); return child;
  };
  cp.execFile = (file, args, options, callback) => {
    invocations.push({ file, args, options }); const child = new FakeChild(); children.push(child);
    Promise.resolve().then(() => { child.exitCode = 0; child.emit("exit", 0); callback(null, JSON.stringify({ peer_id: 8, ipv4_addr: "10.9.8.7", config: "discarded-native-only" })); });
    return child;
  };
  net.createServer = () => {
    const server = { once() { return server; }, listen(options, callback) { assert.equal(options.host, "127.0.0.1"); callback(); }, address: () => ({ port: 34567 }), close: callback => callback() };
    return server;
  };
  try {
    const owner = new processes.EasyTierWindowsProcesses();
    const core = await owner.start("synthetic-no-files", config, new AbortController().signal);
    assert.deepEqual(plain(await core.readNode(new AbortController().signal)), { peerId: 8, virtualIp: "10.9.8.7" });
    assert.equal(invocations[0].options.shell, false); assert.equal(invocations[0].options.windowsHide, true);
    assert.deepEqual(plain(invocations[0].options.stdio), ["pipe", "pipe", "ignore"]); assert.ok(invocations[1].args.includes(config.instanceId));
    owner.shutdownOwned(); await owner.drainOwned(); assert.equal(children[0].kills, 0); assert.equal(children[1].kills, 0); assert.equal(foreign.kills, 0);
    assert.equal(owner.cleanupReports()[0].outcome, "graceful");
    await core.close(); assert.equal(timers.size, 0);
  } finally { Object.assign(cp, savedCp); Object.assign(net, savedNet); }
});
await test("renderer full membership snapshot drains departing session before replacement", async () => {
  const events = [];
  const runtime = { activationReason: () => null, shutdownOwned() {}, connect: async scope => {
    events.push(`start:${scope.serverId}`); return { instanceId: "synthetic-instance", read: forbidden, close: async () => events.push(`close:${scope.serverId}`) };
  } };
  const manager = new deps["./easyTierCommunityManager"].EasyTierCommunityManager(runtime);
  await manager.setEnabled(true); await manager.syncMemberships(["server-a"]);
  await manager.syncMemberships(["server-b"]);
  assert.deepEqual(events, ["start:server-a", "close:server-a", "start:server-b"]);
  await manager.syncMemberships([]); assert.equal(manager.getState("server-b").phase, "disabled");
  assert.equal(timers.size, 0);
});
async function ownedStopFixture(run, { naturalExit = false, failKill = false } = {}) {
  const cp = deps["node:child_process"], net = deps["node:net"], savedCp = { ...cp }, savedNet = { ...net };
  class Child extends EventEmitter {
    pid = 456; exitCode = null; signalCode = null; kills = 0; stops = 0;
    stdout = new EventEmitter();
    stdin = Object.assign(new EventEmitter(), { end: command => {
      assert.equal(command, "LAOKUAI_OWNED_STOP_V1\n"); this.stops++;
      if (naturalExit) { this.exitCode = 0; this.emit("exit", 0); }
    } });
    kill() { this.kills++; if (!failKill) { this.exitCode = 1; this.emit("exit", 1); } return !failKill; }
  }
  const child = new Child();
  cp.spawn = () => { Promise.resolve().then(() => child.emit("spawn")); return child; };
  net.createServer = () => {
    const server = { once: () => server, listen: (_options, callback) => callback(), address: () => ({ port: 34567 }), close: callback => callback() }; return server;
  };
  const fireNext = () => { const [id, fire] = timers.entries().next().value; timers.delete(id); fire(); };
  try { const owner = new processes.EasyTierWindowsProcesses(); const core = await owner.start("synthetic-no-files", config, new AbortController().signal); await run({ child, owner, core, fireNext }); }
  finally { Object.assign(cp, savedCp); Object.assign(net, savedNet); }
}
await test("stop requests share one promise; timeout only kills its owned child and reports actual NIC identifiers", async () => {
  await ownedStopFixture(async ({ child, owner, core, fireNext }) => {
    const guid = "00000000-0000-4000-8000-000000000001";
    child.stdout.emit("data", Buffer.from(`discard native endpoints and configuration\nLAOKUAI_OWNED_NIC_V1 ${guid} 123 30\n`));
    const first = core.close(), second = core.close(); assert.equal(first, second); assert.equal(child.kills, 0);
    assert.equal(child.stops, 1); fireNext(); await first;
    assert.equal(child.kills, 1); assert.equal(timers.size, 0);
    assert.deepEqual(plain(owner.cleanupReports()), [{ outcome: "forced", ownedPid: 456,
      interfaces: [{ guid, luid: "123", ifIndex: 30 }], residualCheckRequired: true }]);
    const reports = owner.cleanupReports(); reports[0].interfaces[0].guid = "changed";
    assert.equal(owner.cleanupReports()[0].interfaces[0].guid, guid);
  });
});
await test("missing stop receipt never claims graceful OS cleanup; long native lines cannot forge a tail receipt", async () => {
  await ownedStopFixture(async ({ child, owner, core }) => {
    child.stdout.emit("data", Buffer.from("x".repeat(400)));
    child.stdout.emit("data", Buffer.from("LAOKUAI_OWNED_STOPPED_V1\n"));
    await core.close(); assert.equal(child.kills, 0); assert.equal(timers.size, 0);
    assert.equal(owner.cleanupReports()[0].outcome, "unconfirmed"); assert.equal(owner.cleanupReports()[0].residualCheckRequired, true);
  }, { naturalExit: true });
});
await test("unconfirmed forced exit retains the owned core until cleanup can be retried", async () => {
  await ownedStopFixture(async ({ child, owner, core, fireNext }) => {
    const close = core.close(); fireNext(); fireNext(); await assert.rejects(close, e => e.reason === "cleanup-failed");
    assert.equal(core.isAlive(), true); assert.equal(owner.cleanupReports()[0].outcome, "unconfirmed");
    const retry = core.close(); child.stdout.emit("data", Buffer.from("LAOKUAI_OWNED_STOPPED_V1\n"));
    child.exitCode = 0; child.emit("exit", 0); await retry; assert.equal(timers.size, 0);
    assert.equal(owner.cleanupReports().at(-1).outcome, "forced"); // prior force cannot be erased by a late receipt
  }, { failKill: true });
});
await test("downstream identity requires reviewed host policy and owned-stop contract; official core hash is forbidden", async () => {
  const manifest = { schemaVersion: 1, version: "2.7.0-laokuai", upstreamCommit: "8b7f1f0196edb5b580829ed5f135050fb5853478",
    hostPolicy: "externally-managed", ownedStopProtocol: 1, sourcePatchSha256: assets.EASYTIER_LAOKUAI_SOURCE_PATCH_SHA256, coreSha256: "b".repeat(64) };
  assert.equal(assets.verifiedEasyTierProductManifest(manifest).coreSha256, manifest.coreSha256);
  for (const changes of [{ version: "2.7.0" }, { coreSha256: assets.EASYTIER_WINDOWS_FILES["easytier-core.exe"] },
    { ownedStopProtocol: 0 }, { hostPolicy: "legacy" }, { sourcePatchSha256: null }, { sourcePatchSha256: "c".repeat(64) }]) {
    assert.throws(() => assets.verifiedEasyTierProductManifest({ ...manifest, ...changes }), e => e.reason === "runtime-required");
  }
});
await test("missing release-owned downstream manifest cannot download, write cache, start or load a driver", async () => {
  const io = deps["node:fs/promises"], previousStat = io.stat;
  io.stat = async () => { throw new Error("manifest-not-built"); };
  try { await assert.rejects(new assets.EasyTierWindowsAssets(() => "synthetic-no-profile", () => "synthetic-no-package").prepareProductBundled(), e => e.reason === "runtime-required"); }
  finally { io.stat = previousStat; }
});
await test("unverified or corrupt archive is rejected before extraction", async () => {
  assert.throws(() => assets.verifiedEasyTierArchive(new Uint8Array(10)), e => e.reason === "unsupported-target");
});
const archiveArg = process.argv.indexOf("--archive");
if (archiveArg !== -1) await test("downloaded official archive and five executable/driver file hashes match pins", async () => {
  const contents = assets.verifiedEasyTierArchive(fs.readFileSync(process.argv[archiveArg + 1]));
  assert.equal(Object.keys(contents).length, 5);
  assert.ok(!("easytier-web.exe" in contents)); assert.ok(!("easytier-web-embed.exe" in contents));
});
console.log(`${checks} production adapter checks passed; core/CLI/driver/network processes never executed`);
