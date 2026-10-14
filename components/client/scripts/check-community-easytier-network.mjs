import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import ts from "typescript";

// No real child, socket, profile, permission, core or CLI is used.
const forbidden = () => { throw new Error("Unexpected runtime operation"); };
const deps = { "node:crypto": crypto, "node:path": path, "node:child_process": { spawn: forbidden, execFile: forbidden }, "node:net": { createServer: forbidden } };
let monotonic = 100, utc = 100000, timerId = 0;
const timers = new Map();
function compile(file) {
  const code = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Set, Map, Buffer, URL, AbortController, structuredClone, performance: { now: () => monotonic },
    Date: { now: () => utc }, process: { platform: "win32", env: {} },
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
    require: key => { assert.ok(key in deps, `Unmocked dependency ${key}`); return deps[key]; },
  });
  return exports;
}
deps["../src/lib/communityDnsNames"] = compile("src/lib/communityDnsNames.ts");
const status = deps["./easyTierStatus"] = compile("electron/easyTierStatus.ts");
deps["./easyTierMemberAdapter"] = compile("electron/easyTierMemberAdapter.ts");
deps["./easyTierCommunityManager"] = compile("electron/easyTierCommunityManager.ts");
const network = deps["./easyTierCliNetwork"] = compile("electron/easyTierCliNetwork.ts");
deps["./communityEtGrant"] = compile("electron/communityEtGrant.ts");
deps["./communityEtCredentialObservation"] = compile("electron/communityEtCredentialObservation.ts");
deps["./communityRelayRuntime"] = compile("electron/communityRelayRuntime.ts");
const processes = compile("electron/easyTierWindowsProcesses.ts");
const { WindowsEasyTierCliRuntime } = compile("electron/windowsEasyTierCliRuntime.ts");
const instanceId = "00000000-0000-4000-8000-000000000001";
const connectionId = "00000000-0000-4000-8000-000000000002";
const scope = { serverId: "synthetic-server", generation: 7, instanceId };
const plain = v => JSON.parse(JSON.stringify(v));
function fixture() {
  return { node_info: { inst_id: instanceId, peer_id: 1, ipv4_addr: "10.9.0.1/24", config: "discarded-config", hostname: "discarded-host" },
    peer_routes: [{ route: { peer_id: 2, ipv4_addr: "10.9.0.2/24", next_hop_peer_id: 3, cost: 2, next_hop_peer_id_latency_first: 2, cost_latency_first: 1, path_latency: 11 },
      peer: { peer_id: 2, default_conn_id: { part1: 0, part2: 16384, part3: 2147483648, part4: 2 },
        directly_connected_conns: [{ part1: 0, part2: 16384, part3: 2147483648, part4: 2 }],
        conns: [{ conn_id: connectionId, my_peer_id: 1, peer_id: 2, is_closed: false, tunnel: { tunnel_type: "udp", remote_addr: "discarded-endpoint" }, stats: { latency_us: 4000 }, network_name: "discarded-network" }] } }] };
}
function sample(changes = {}) {
  return { ...scope, acquisitionSource: "owned-cli-route-list", acquisitionStartedAtMs: 100, acquiredAtMs: 110,
    acquisitionStartedAtUnixMs: 100000, acquiredAtUnixMs: 100010, latencyFirst: null, freshRpc: true, bindings: [],
    info: network.sanitizedEasyTierCliNetwork(fixture(), instanceId), ...changes };
}
let checks = 0;
async function test(name, run) { await run(); console.log(`ok ${++checks} ${name}`); }
await test("verbose route response supplies real peer and route facts but drops private/native payloads", () => {
  const result = network.sanitizedEasyTierCliNetwork(fixture(), instanceId);
  assert.equal(result.routes[0].next_hop_peer_id, 3); assert.equal(result.routes[0].next_hop_peer_id_latency_first, 2);
  assert.equal(result.peers[0].default_conn_id, connectionId); assert.equal(result.peers[0].conns.length, 1);
  assert.equal(result.my_node_info.virtual_ipv4, "10.9.0.1");
  const text = JSON.stringify(result);
  for (const key of ["discarded", "stats", "path_latency", "config", "hostname", "remote_addr", "network_name"]) assert.ok(!text.includes(key));
});
await test("table JSON, multi-instance output, wrong instance, duplicate or mismatched peers are rejected", () => {
  for (const value of [{ peers: [] }, [fixture()], { ...fixture(), node_info: { ...fixture().node_info, inst_id: "wrong-instance" } },
    { ...fixture(), peer_routes: [...fixture().peer_routes, ...fixture().peer_routes] },
    { ...fixture(), peer_routes: [{ ...fixture().peer_routes[0], route: { peer_id: 9 } }] }]) {
    assert.throws(() => network.sanitizedEasyTierCliNetwork(value, instanceId), /invalid-owned-network-status/);
  }
});
await test("invalid connection identity and oversized raw graph cannot become local facts", () => {
  for (const edit of [r => { r.peer_routes[0].peer.conns[0].my_peer_id = 9; }, r => { r.peer_routes[0].peer.conns[0].conn_id = "00000000-0000-0000-0000-000000000000"; },
    r => { r.peer_routes[0].peer.conns.push(r.peer_routes[0].peer.conns[0]); }, r => { r.peer_routes = Array(1025).fill(r.peer_routes[0]); }]) {
    const raw = fixture(); edit(raw); assert.throws(() => network.sanitizedEasyTierCliNetwork(raw, instanceId));
  }
});
await test("fixed 2.7 proto3 false omission is trusted only for the owned route-list producer", () => {
  const raw = fixture(); delete raw.peer_routes[0].peer.conns[0].is_closed;
  assert.equal(network.sanitizedEasyTierCliNetwork(raw, instanceId).peers[0].conns[0].is_closed, null);
  assert.equal(network.sanitizedEasyTierV270CliNetwork(raw, instanceId).peers[0].conns[0].is_closed, false);
});
await test("owned 2.7 route-list preserves both members when an indirect peer omits empty repeated fields", () => {
  const raw = fixture();
  const indirect = structuredClone(raw.peer_routes[0]);
  indirect.route.peer_id = 4; indirect.route.ipv4_addr = "10.9.0.4/24";
  indirect.peer.peer_id = 4; indirect.peer.conns[0].peer_id = 4;
  delete indirect.peer.directly_connected_conns;
  raw.peer_routes.push(indirect);
  assert.throws(() => network.sanitizedEasyTierCliNetwork(raw, instanceId), /invalid-owned-network-status/);
  const result = network.sanitizedEasyTierV270CliNetwork(raw, instanceId);
  assert.equal(result.my_node_info.virtual_ipv4, "10.9.0.1");
  assert.equal(result.routes.length, 2); assert.equal(result.peers.length, 2);
  assert.deepEqual(plain(result.peers[1].directly_connected_conns), []);
  assert.equal(result.peers[1].conns.length, 1);
  delete indirect.peer.conns;
  const noConnections = network.sanitizedEasyTierV270CliNetwork(raw, instanceId);
  assert.deepEqual(plain(noConnections.peers[1].conns), []);
  assert.deepEqual(plain(noConnections.peers[1].directly_connected_conns), []);
});
await test("owned proto3 empty defaults do not accept null, wrong types, or oversized connection lists", () => {
  for (const key of ["conns", "directly_connected_conns"]) {
    for (const value of [null, {}, "", Array(65).fill({})]) {
      const raw = fixture(); raw.peer_routes[0].peer[key] = value;
      assert.throws(() => network.sanitizedEasyTierV270CliNetwork(raw, instanceId), /invalid-owned-network-status/);
    }
  }
});
await test("unknown closure/tunnel and nonprivate IP remain unknown; bare RTT has no measurement timestamp", () => {
  const raw = fixture(); raw.node_info.ipv4_addr = "invalid-physical-address";
  delete raw.peer_routes[0].peer.conns[0].is_closed; raw.peer_routes[0].peer.conns[0].tunnel.tunnel_type = "unrecognized";
  const local = status.projectEasyTierLocalDetails(sample({ info: network.sanitizedEasyTierCliNetwork(raw, instanceId) }), scope, 110, 100010);
  assert.equal(local.virtualIp, null); assert.equal(local.peers[0].connections[0].closed, null); assert.equal(local.peers[0].connections[0].tunnelType, null);
  assert.equal(local.rttMs, null); assert.equal(local.memberBinding, "unavailable");
  assert.ok(local.missingEvidence.includes("rtt-measurement-time")); assert.ok(local.missingEvidence.includes("latency-first-setting"));
  assert.deepEqual(plain(status.projectEasyTierStatus(sample(), scope, 110).peers), []);
});
await test("local snapshot uses oldest acquisition time, scopes, both clocks, and defensive copies", () => {
  const input = sample();
  assert.equal(status.projectEasyTierLocalDetails(input, scope, NaN, 100010), null);
  assert.equal(status.projectEasyTierLocalDetails(input, scope, 110, NaN), null);
  for (const age of [0, -1, Infinity, 10000]) assert.equal(status.projectEasyTierLocalDetails(input, scope, 110, 100010, age), null);
  for (const [s, target, now, unix] of [[{ ...input, freshRpc: false }, scope, 110, 100010], [input, { ...scope, generation: 8 }, 110, 100010],
    [input, { ...scope, serverId: "other-server" }, 110, 100010], [input, { ...scope, instanceId: "other-instance" }, 110, 100010],
    [input, scope, 5101, 105001], [input, scope, 110, 105001], [input, scope, 109, 100010], [input, scope, 110, 100009]]) {
    assert.equal(status.projectEasyTierLocalDetails(s, target, now, unix), null);
  }
  const local = status.projectEasyTierLocalDetails(input, scope, 5100, 105000); assert.equal(local.routes.length, 1);
  local.routes[0].nextHopPeerId = 99; assert.equal(input.info.routes[0].next_hop_peer_id, 3);
});
class Child extends EventEmitter {
  pid = 123; exitCode = null; signalCode = null; kills = 0; stdout = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), { end: () => { this.exitCode = 0; this.emit("exit", 0); } });
  kill() { this.kills++; this.exitCode = 1; this.emit("exit", 1); return true; }
}
const pending = []; let child;
deps["node:child_process"].spawn = () => { child = new Child(); queueMicrotask(() => child.emit("spawn")); return child; };
deps["node:child_process"].execFile = (file, args, options, callback) => {
  assert.ok(file.endsWith("easytier-cli.exe")); assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
  assert.equal(options.timeout, 2000); assert.equal(options.maxBuffer, 1024 * 1024);
  assert.deepEqual(plain(args), ["--rpc-portal", "127.0.0.1:34567", "--instance-id", instanceId, "--verbose", "--output", "json", "route", "list"]);
  const reader = new Child(); pending.push({ callback, reader, options }); return reader;
};
deps["node:net"].createServer = () => {
  const server = { once: () => server, listen: (_options, callback) => callback(), address: () => ({ port: 34567 }), close: callback => callback() }; return server;
};
const config = { serverId: scope.serverId, instanceId, configFile: "synthetic-never-read.toml", latencyFirst: false };
function finish(error = null, value = fixture()) { const p = pending.shift(); p.callback(error, JSON.stringify(value)); p.reader.exitCode = 0; p.reader.emit("exit", 0); }
await test("owned CLI reads are bounded, scoped and single-flight; each observer gets an isolated copy", async () => {
  const owner = new processes.EasyTierWindowsProcesses(); const core = await owner.start("synthetic-no-files", config, new AbortController().signal);
  const a = core.readNetwork(new AbortController().signal), b = core.readNetwork(new AbortController().signal);
  assert.equal(pending.length, 1); monotonic = 120; utc = 100020; finish(); const [left, right] = await Promise.all([a, b]);
  assert.equal(left.acquisitionStartedAtMs, 100); assert.equal(left.acquiredAtMs, 120);
  left.info.routes[0].peer_id = 99; assert.equal(right.info.routes[0].peer_id, 2);
  await core.close(); assert.equal(child.kills, 0); assert.equal(timers.size, 0);
});
await test("production credential network collection accepts a joined indirect member without losing issuer proof", async () => {
  const raw = fixture(), localKey = Buffer.alloc(32, 0x31).toString("base64"), issuerKey = Buffer.alloc(32, 0x22).toString("base64");
  const issuer = raw.peer_routes[0].peer.conns[0];
  Object.assign(issuer, { noise_local_static_pubkey: localKey, noise_remote_static_pubkey: issuerKey,
    secure_auth_level: "PeerVerified", peer_identity_type: "Admin", network_name: "fixture-network" });
  const indirect = structuredClone(raw.peer_routes[0]);
  indirect.route.peer_id = 4; indirect.peer.peer_id = 4; indirect.peer.conns[0].peer_id = 4;
  indirect.peer.conns[0].peer_identity_type = "Credential";
  delete indirect.peer.directly_connected_conns;
  raw.peer_routes.push(indirect);
  const fingerprint = value => crypto.createHash("sha256").update(Buffer.from(value, "base64")).digest("hex");
  const credentialIdentity = { networkName: "fixture-network", virtualIp: "10.9.0.1",
    publicKeyFingerprint: fingerprint(localKey), issuerPublicKeyFingerprint: fingerprint(issuerKey) };
  const core = await new processes.EasyTierWindowsProcesses().start("synthetic-no-files", {...config, credentialIdentity}, new AbortController().signal);
  try {
    const read = core.readCredentialNetwork(new AbortController().signal); finish(null, raw);
    const result = await read;
    assert.equal(result.observation.issuerPinVerified, true);
    assert.equal(result.network.info.my_node_info.virtual_ipv4, "10.9.0.1");
    assert.equal(result.network.info.routes.length, 2);
    assert.equal(core.isAlive(), true);
    assert.equal(child.kills, 0);
  } finally { await core.close(); }
});
await test("cancelled joining observer does not kill shared acquisition, and next read is not cached", async () => {
  const core = await new processes.EasyTierWindowsProcesses().start("synthetic-no-files", config, new AbortController().signal);
  const first = core.readNetwork(new AbortController().signal), cancel = new AbortController(), second = core.readNetwork(cancel.signal);
  const rejected = assert.rejects(second, e => e.reason === "runtime-exited"); cancel.abort(); await rejected;
  assert.equal(pending[0].reader.kills, 0); finish(); await first;
  const next = core.readNetwork(new AbortController().signal); assert.equal(pending.length, 1); finish(); await next; await core.close();
});
await test("malformed or failed CLI output exposes a stable reason; retired core cannot publish late data", async () => {
  const core = await new processes.EasyTierWindowsProcesses().start("synthetic-no-files", config, new AbortController().signal);
  const bad = core.readNetwork(new AbortController().signal), rejected = assert.rejects(bad, e => e.reason === "status-unavailable");
  finish(new Error("discarded-native-error")); await rejected;
  const late = core.readNetwork(new AbortController().signal), retired = assert.rejects(late, e => e.reason === "runtime-exited");
  await core.close(); finish(); await retired; assert.equal(timers.size, 0);
});
await test("production adapter returns acquired nonempty graph; session close drops an in-flight result", async () => {
  let alive = true, resolve;
  const core = { isAlive: () => alive, readNode: async () => ({ peerId: 1, virtualIp: "10.9.0.1" }),
    readNetwork: async () => new Promise(r => { resolve = r; }), close: async () => { alive = false; }, terminateOwned: forbidden };
  const runtime = new WindowsEasyTierCliRuntime({ platform: "win32", configuration: async () => config, permission: async () => true,
    verifiedAssets: async () => "synthetic", start: async () => core, pause: forbidden, shutdownOwned: forbidden });
  const session = await runtime.connect({ ...scope, signal: new AbortController().signal });
  const read = session.read(new AbortController().signal); resolve(sample()); const result = await read;
  assert.equal(result.info.routes.length, 1); assert.equal(result.info.peers.length, 1); assert.equal(result.bindings.length, 0);
  assert.equal(result.latencyFirst, false);
  const late = session.read(new AbortController().signal); await session.close(); resolve(sample()); assert.equal((await late).freshRpc, false);
});
await test("existing manager IPC returns local facts without inventing a member binding and expires them", async () => {
  monotonic = 110; utc = 100010;
  const { EasyTierCommunityManager } = deps["./easyTierCommunityManager"];
  let connectScope;
  const manager = new EasyTierCommunityManager({ activationReason: () => null, shutdownOwned: forbidden,
    connect: async s => { connectScope = s; return { instanceId, read: async () => sample({ generation: s.generation }), close: async () => {} }; },
  }, () => {}, () => monotonic, 8000, 10000, () => utc);
  await manager.setEnabled(true); const lease = { serverId: scope.serverId, leaseId: "synthetic-consumer" }; await manager.connect(lease);
  await manager.refresh(scope.serverId); const state = manager.getState(scope.serverId);
  assert.equal(state.generation, connectScope.generation); assert.equal(state.localDetails.routes[0].peerId, 2);
  assert.equal(state.lanSnapshot, null); state.localDetails.routes[0].peerId = 99;
  assert.equal(manager.getState(scope.serverId).localDetails.routes[0].peerId, 2);
  monotonic = 5101; utc = 105001; assert.equal(manager.getState(scope.serverId).localDetails, null);
  await manager.disconnect(lease); assert.equal(manager.getState(scope.serverId).localDetails, null); assert.equal(timers.size, 0);
});
await test("configuration is read before permission and missing administrator permission blocks native acquisition", async () => {
  let configurationCalls=0;
  const runtime=new WindowsEasyTierCliRuntime({platform:"win32",permission:async()=>false,
    configuration:async()=>{configurationCalls++;return config;},
    verifiedAssets:forbidden,start:forbidden,pause:forbidden,shutdownOwned:forbidden});
  await assert.rejects(runtime.connect({...scope,signal:new AbortController().signal}),error=>error.reason==="needs-permission");
  assert.equal(configurationCalls,1);
});
console.log(`${checks} read-only network checks passed; every runtime port was fake`);
