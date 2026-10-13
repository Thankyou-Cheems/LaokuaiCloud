import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import ts from "typescript";

// Pure source tests. Every import is explicitly supplied; no Electron/core/driver,
// child_process, filesystem profile, network socket or fixture service can execute.
let time = 1000, nextTimer = 0;
const timers = new Map();
const dependencies = {};
function compile(path) {
  const source = fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, AbortController, performance: { now: () => time }, Date: { now: () => time },
    setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    require: key => { assert.ok(key in dependencies, `Forbidden/unmocked import: ${key}`); return dependencies[key]; },
  }, { filename: path });
  return exports;
}
const status = compile("electron/easyTierStatus.ts");
dependencies["./easyTierStatus"] = status;
const dnsNames = compile("src/lib/communityDnsNames.ts");
dependencies["../src/lib/communityDnsNames"] = dnsNames;
dependencies["./communityDnsNames"] = dnsNames;
const memberAdapter = compile("electron/easyTierMemberAdapter.ts");
dependencies["./easyTierMemberAdapter"] = memberAdapter;
const memberContract = compile("src/lib/memberLanStatus.ts");
const lifecycle = compile("electron/easyTierCommunityManager.ts");
dependencies["./easyTierCommunityManager"] = lifecycle;
dependencies["./easyTierTarget"] = compile("electron/easyTierTarget.ts");
const { WindowsEasyTierRuntime } = compile("electron/windowsEasyTierRuntime.ts");
const { registerEasyTierCommunityIpc } = compile("electron/easyTierCommunityIpc.ts");
const { EasyTierCommunityManager } = lifecycle;
const plain = value => JSON.parse(JSON.stringify(value));
const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let checks = 0;
async function test(name, run) { await run(); assert.equal(timers.size, 0, `${name}: leaked watchdog`); checks++; console.log(`ok ${checks} ${name}`); }
const lease = (serverId = "community-a", leaseId = "community-owner") => ({ serverId, leaseId });
const scope = { serverId: "community-a", generation: 1, instanceId: "instance-a" };
const connId = "11111111-2222-3333-4444-555555555555";
const conn = (peer = 7) => ({ conn_id: connId, my_peer_id: 1, peer_id: peer, is_closed: false, tunnel: { tunnel_type: "udp", remote_addr: "omitted-private-endpoint" }, stats: { latency_us: 24000 } });
function sample() {
  return { ...scope, acquiredAtMs: time, acquiredAtUnixMs: time, freshRpc: true, latencyFirst: false,
    info: { running: true, my_node_info: { peer_id: 1, virtual_ipv4: "10.44.0.2/24", ips: { public_ip: ["omitted-private-endpoint"] } },
      routes: [{ peer_id: 7, next_hop_peer_id: 7, cost: 1, ipv4_addr: "10.44.0.7" }],
      peers: [{ peer_id: 7, default_conn_id: connId, directly_connected_conns: [connId], conns: [conn()] }],
      events: ["private-details-must-be-discarded"],
    }, bindings: [{ ...scope, userId: "user-a", peerId: 7, authenticated: true, expiresAtMs: time + 60000,
      deviceId: "device-a", observedAtUnixMs: time, enrollment: "joined", enrollmentObservedAtUnixMs: time }],
    rtt: [{ source: "easytier-local", fromPeerId: 1, toPeerId: 7, observedAtMs: time, observedAtUnixMs: time, ms: 24 }],
    selectedRoutes: [{ fromPeerId: 1, toPeerId: 7, nextHopPeerId: 7, observedAtMs: time, observedAtUnixMs: time }] };
}
function enrolledSample() {
  const s = sample(); s.bindings.push({ ...s.bindings[0], userId: "local-user", deviceId: "local-device", peerId: 1 }); return s;
}
const projection = s => plain(status.projectEasyTierStatus(s, scope, time));
await test("friendly DNS projection preserves authenticated device assignments and exact namespace boundaries",async()=>{
  for(const zone of ['lk.internal.','lk-0123abcd.internal.']) {
    const s=enrolledSample();s.directoryObservedAtUnixMs=time;
    s.directory=[{serverUserId:'remote',virtualIp:'10.44.0.8'},{serverUserId:'remote',virtualIp:'10.44.0.9'}];
    s.dnsReady=true;s.dnsAddresses=s.directory.map((entry,index)=>({virtualIp:entry.virtualIp,dnsName:`shizi-${12+index}.${zone}`,expiresAtUnixMs:time+5000}));
    const project=()=>memberAdapter.projectEasyTierMembers(s,scope,'connected',time,time);
    const remote=project().members.find(member=>member.binding.authenticatedUserId==='remote');
    assert.deepEqual(plain(remote.dnsAddresses),s.dnsAddresses);assert.equal(remote.enrollment.state,'assigned');
    for(const change of [row=>row.dnsName='shizi-12.lk.internal.\n',row=>row.dnsName='shizi-12.foreign.internal.',
      row=>row.dnsName='shizi-12.lk.other.internal.',row=>row.virtualIp='10.44.0.99',
      row=>row.expiresAtUnixMs=time,row=>row.expiresAtUnixMs=time+10001]) {
      const original={...s.dnsAddresses[0]};change(s.dnsAddresses[0]);
      assert.ok(project().members.every(member=>!member.dnsAddresses));s.dnsAddresses[0]=original;
    }
    s.dnsAddresses[1].dnsName='shizi-13.lk-ffffffff.internal.';
    assert.ok(project().members.every(member=>!member.dnsAddresses));
  }
});
function session(id = "instance-a", close = async () => {}) { return { instanceId: id, close, read: async () => sample() }; }
function fakeRuntime(connect = async () => session()) { return { activationReason: () => null, connect, shutdownOwned() {} }; }

await test("activation is off and cannot launch from an IPC enable request", async () => {
  const manager = new EasyTierCommunityManager(null);
  assert.equal((await manager.connect(lease())).phase, "disabled");
  await manager.setEnabled(true);
  assert.equal(manager.getState(scope.serverId).phase, "activation-required");
  assert.equal(manager.getState(scope.serverId).reason, "activation-required");
  await manager.disconnectCommunity(scope.serverId);
  assert.equal(manager.getState(scope.serverId).phase, "disabled");
});
await test("leases are idempotent and room-independent; last consumer releases once", async () => {
  let starts = 0, closes = 0;
  const manager = new EasyTierCommunityManager(fakeRuntime(async () => { starts++; return session("instance-a", async () => { closes++; }); }));
  await manager.setEnabled(true);
  await Promise.all([manager.connect(lease()), manager.connect(lease()), manager.connect(lease("community-a", "lan-owner"))]);
  assert.equal(starts, 1);
  await manager.disconnect(lease());
  assert.equal(closes, 0);
  assert.equal(manager.getState("community-a").phase, "connected");
  assert.equal(typeof manager.joinRoom, "undefined");
  await manager.disconnect(lease("community-a", "lan-owner"));
  await manager.disconnect(lease("community-a", "lan-owner"));
  assert.equal(closes, 1);
});
await test("cancel during connect and rapid reconnect drains late owned instance first", async () => {
  const pending = defer(); const events = []; let firstSignal;
  const manager = new EasyTierCommunityManager(fakeRuntime(async context => {
    events.push("start");
    if (events.length === 1) { firstSignal = context.signal; return pending.promise; }
    return session("replacement", async () => { events.push("close-replacement"); });
  }));
  await manager.setEnabled(true);
  const first = manager.connect(lease()); await drain();
  const disconnect = manager.disconnectCommunity("community-a");
  const reconnect = manager.connect(lease()); await drain();
  assert.equal(firstSignal.aborted, true);
  assert.deepEqual(events, ["start"]);
  pending.resolve(session("late", async () => { events.push("close-late"); }));
  await Promise.all([first, disconnect, reconnect]);
  assert.deepEqual(events, ["start", "close-late", "start"]);
  assert.equal(manager.getState("community-a").phase, "connected");
  await manager.disconnectCommunity("community-a");
});
await test("connect timeout settles UI and late success is closed instead of published", async () => {
  const pending = defer(); let closed = 0;
  const manager = new EasyTierCommunityManager(fakeRuntime(() => pending.promise));
  await manager.setEnabled(true);
  const connect = manager.connect(lease()); await drain();
  for (const fn of [...timers.values()]) fn();
  assert.equal((await connect).reason, "operation-timeout");
  pending.resolve(session("late", async () => { closed++; })); await drain();
  assert.equal(closed, 1);
  assert.equal(manager.getState("community-a").phase, "error");
});
await test("start failure settles safely with no private error text or identity reset", async () => {
  const manager = new EasyTierCommunityManager(fakeRuntime(async () => { throw new Error("private-runtime-output"); }));
  await manager.setEnabled(true);
  const state = await manager.connect(lease());
  assert.equal(state.reason, "connect-failed");
  assert.ok(!JSON.stringify(state).includes("private-runtime-output"));
});
await test("cleanup failure blocks replacement until owned session cleanup succeeds", async () => {
  let starts = 0, fail = true;
  const manager = new EasyTierCommunityManager(fakeRuntime(async () => {
    starts++; return session("instance-a", async () => { if (fail) throw new Error("cleanup"); });
  }));
  await manager.setEnabled(true); await manager.connect(lease());
  assert.equal((await manager.disconnectCommunity("community-a")).reason, "cleanup-failed");
  assert.equal((await manager.connect(lease())).reason, "cleanup-failed"); assert.equal(starts, 1);
  fail = false; await manager.connect(lease()); assert.equal(starts, 2);
  await manager.disconnectCommunity("community-a");
});
await test("global disable preserves community references for re-enable", async () => {
  let starts = 0, closes = 0;
  const manager = new EasyTierCommunityManager(fakeRuntime(async () => { starts++; return session("a", async () => { closes++; }); }));
  await manager.setEnabled(true); await manager.connect(lease());
  await manager.setEnabled(false); assert.equal(closes, 1);
  await manager.setEnabled(true); assert.equal(starts, 2);
  await manager.disconnectCommunity("community-a");
  await manager.setEnabled(false); await manager.setEnabled(true); assert.equal(starts, 2);
});
await test("status expiry and observer mutation cannot retain a false direct route", async () => {
  const manager = new EasyTierCommunityManager(fakeRuntime(), state => { if (state.lanSnapshot) state.lanSnapshot.members.length = 0; }, () => time);
  await manager.setEnabled(true); await manager.connect(lease());
  const generation = manager.getState("community-a").generation;
  const real = enrolledSample(); real.generation = generation; for (const b of real.bindings) b.generation = generation;
  const replacement = fakeRuntime(async () => ({ ...session(), read: async () => real }));
  const m = new EasyTierCommunityManager(replacement, () => {}, () => time);
  await m.setEnabled(true); await m.connect(lease()); await m.refresh("community-a");
  assert.equal(m.getState("community-a").lanSnapshot.members[0].path.kind, "direct");
  const state = m.getState("community-a"); state.lanSnapshot.members[0].path.kind = "unknown";
  assert.equal(m.getState("community-a").lanSnapshot.members[0].path.kind, "direct");
  time += 10001;
  assert.equal(m.getState("community-a").lanSnapshot, null);
  time -= 10001;
  await manager.disconnectCommunity("community-a"); await m.disconnectCommunity("community-a");
});
await test("late poll after disconnect cannot resurrect old generation", async () => {
  const pending = defer();
  const manager = new EasyTierCommunityManager(fakeRuntime(async () => ({ ...session(), read: () => pending.promise })));
  await manager.setEnabled(true); await manager.connect(lease());
  const poll = manager.refresh("community-a"); await drain();
  await manager.disconnectCommunity("community-a"); pending.resolve(sample()); await poll;
  assert.equal(manager.getState("community-a").virtualIp, null);
  assert.equal(manager.getState("community-a").phase, "disabled");
});
await test("poll failure clears telemetry without closing a live LAN session", async () => {
  let closes = 0, fail = false;
  const manager = new EasyTierCommunityManager(fakeRuntime(async () => ({ ...session("instance-a", async () => { closes++; }), read: async () => { if (fail) throw new Error("private"); return sample(); } })));
  await manager.setEnabled(true); await manager.connect(lease()); await manager.refresh("community-a");
  fail = true; await manager.refresh("community-a");
  assert.equal(manager.getState("community-a").reason, "status-unavailable");
  assert.equal(manager.getState("community-a").virtualIp, null); assert.equal(closes, 0);
  await manager.disconnectCommunity("community-a");
});
await test("owned shutdown is terminal, synchronous and idempotent", async () => {
  let stops = 0;
  const runtime = fakeRuntime(); runtime.shutdownOwned = () => { stops++; };
  const manager = new EasyTierCommunityManager(runtime); await manager.setEnabled(true); await manager.connect(lease());
  manager.shutdownOwned(); manager.shutdownOwned(); await manager.setEnabled(true); await manager.connect(lease());
  assert.equal(stops, 1); assert.equal(manager.getState("community-a").phase, "disabled");
});

await test("real RPC route/default connection/direct list jointly prove direct RTT", async () => {
  assert.deepEqual(projection(sample()), { running: true, virtualIp: "10.44.0.2", peers: [{ userId: "user-a", virtualIp: "10.44.0.7", route: "physical-direct", rttMs: 24 }] });
  assert.equal(JSON.stringify(projection(sample())).includes("private"), false);
});
await test("one-hop IP and a direct tunnel do not prove the selected route is direct", async () => {
  const s = sample(); s.info.routes[0].next_hop_peer_id = 9;
  s.selectedRoutes[0].nextHopPeerId = 9;
  assert.equal(projection(s).peers[0].route, "unknown");
  s.info.peers.push({ peer_id: 9, default_conn_id: connId, conns: [conn(9)], directly_connected_conns: [connId] });
  assert.equal(projection(s).peers[0].route, "relay"); assert.equal(projection(s).peers[0].rttMs, null);
});
await test("latency-first chooses its real next-hop and unknown policy stays unknown", async () => {
  const s = sample(); s.latencyFirst = true;
  assert.equal(projection(s).peers[0].route, "unknown");
  s.info.routes[0].next_hop_peer_id_latency_first = 7;
  assert.equal(projection(s).peers[0].route, "physical-direct");
  s.latencyFirst = null; assert.equal(projection(s).peers[0].route, "unknown");
});
await test("unauthenticated expired duplicated and mismatched bindings remain unknown", async () => {
  for (const mutate of [s => { s.bindings[0].authenticated = false; }, s => { s.bindings[0].expiresAtMs = time; }, s => { s.bindings.push({ ...s.bindings[0], userId: "other-user" }); }]) {
    const s = sample(); mutate(s); assert.ok(projection(s).peers.every(p => p.route === "unknown" && p.virtualIp === null && p.rttMs === null));
  }
  const s = sample(); s.generation++; assert.deepEqual(projection(s).peers, []);
});
await test("stale cached future and exited telemetry never reports physical direct", async () => {
  for (const mutate of [s => { s.acquiredAtMs -= 5001; }, s => { s.acquiredAtMs++; }, s => { s.freshRpc = false; }, s => { s.info.running = false; }]) {
    const s = sample(); mutate(s); assert.equal(projection(s).peers[0].route, "unknown"); assert.equal(projection(s).virtualIp, null);
  }
});
await test("unselected closed relayed unknown tunnels and invalid RTT are conservative", async () => {
  for (const mutate of [s => { s.info.peers[0].default_conn_id = "invalid"; }, s => { s.info.peers[0].directly_connected_conns = []; }, s => { s.info.peers[0].conns[0].is_closed = true; }, s => { s.info.peers[0].conns[0].tunnel.tunnel_type = "relay"; }]) {
    const s = sample(); mutate(s); assert.equal(projection(s).peers[0].route, "unknown");
  }
  const s = sample(); s.rtt[0].ms = NaN; assert.equal(projection(s).peers[0].rttMs, null);
});
await test("protobuf virtual-IP conversion allows only private virtual addresses", async () => {
  assert.equal(status.easyTierVirtualIp({ address: { addr: 0x0a2c0007 }, network_length: 24 }), "10.44.0.7");
  assert.equal(status.easyTierVirtualIp("256.0.0.1"), null);
  assert.equal(status.easyTierVirtualIp("1.1.1.1"), null);
});
await test("server roster supplies stable member addresses without inventing a route", async () => {
  const s = enrolledSample();
  s.directory = [
    {serverUserId: "user-a", virtualIp: "10.44.0.7"},
    {serverUserId: "local-user", virtualIp: "10.44.0.2"},
    {serverUserId: "remote-user", virtualIp: "10.44.0.8"},
  ];
  s.directoryObservedAtUnixMs = time;
  const snapshot = memberAdapter.projectEasyTierMembers(s, scope, "connected", time, time);
  assert.ok(snapshot);
  assert.deepEqual([...snapshot.members.find(member => member.binding.authenticatedUserId === "user-a").virtualIps], ["10.44.0.7"]);
  const remote = snapshot.members.find(member => member.binding.authenticatedUserId === "remote-user");
  assert.deepEqual(JSON.parse(JSON.stringify(remote)), {
    binding: {authenticatedUserId: "remote-user", peerId: null, confidence: "verified", source: "authenticated-community", observedAtMs: time},
    enrollment: {state: "assigned", source: "authenticated-community", observedAtMs: time}, virtualIps: ["10.44.0.8"], virtualIpObservedAtMs: time,
  });
  s.directory[2].virtualIp = "198.51.100.8";
  const invalid = memberAdapter.projectEasyTierMembers(s, scope, "connected", time, time);
  assert.equal(invalid.members.some(member => member.binding.authenticatedUserId === "remote-user" && member.virtualIp), false);
});
await test("directory timestamps expire independently; each remote account keeps all devices", async () => {
  const s = enrolledSample();
  s.directory = [{serverUserId: "remote", virtualIp: "10.44.0.8"}, {serverUserId: "remote", virtualIp: "10.44.0.9"}];
  s.directoryObservedAtUnixMs = time;
  const remote = memberAdapter.projectEasyTierMembers(s, scope, "connected", time, time).members.find(m => m.binding.authenticatedUserId === "remote");
  assert.deepEqual([...remote.virtualIps], ["10.44.0.8", "10.44.0.9"]); assert.equal(remote.enrollment.state, "assigned"); assert.equal(remote.path, undefined);
  for (const at of [undefined, time + 1, time - 10001]) {
    s.directoryObservedAtUnixMs = at;
    assert.equal(memberAdapter.projectEasyTierMembers(s, scope, "connected", time, time).members.some(m => m.binding.authenticatedUserId === "remote"), false);
  }
  s.directoryObservedAtUnixMs = time;
  s.directory[1].virtualIp = s.directory[0].virtualIp;
  assert.equal(memberAdapter.projectEasyTierMembers(s, scope, "connected", time, time).members.some(m => m.binding.authenticatedUserId === "remote"), false);
});

await test("prepared DNS names bind to authenticated device IPs and local row stays on this device", async () => {
  const s = enrolledSample(), zone = `c-${"a".repeat(32)}.lan.voice.ruikang.wang.`;
  const name = digit => `d-${digit.repeat(32)}.${zone}`;
  s.directoryObservedAtUnixMs = time;
  s.directory = [{serverUserId:"local-user",virtualIp:"10.44.0.2"},{serverUserId:"local-user",virtualIp:"10.44.0.3"},
    {serverUserId:"remote",virtualIp:"10.44.0.8"},{serverUserId:"remote",virtualIp:"10.44.0.9"}];
  s.dnsReady = true;
  s.dnsAddresses = ["10.44.0.2","10.44.0.3","10.44.0.8","10.44.0.9"].map((virtualIp,index)=>({dnsName:name(String(index+1)),virtualIp,expiresAtUnixMs:time+5000}));
  const snap = snapshot(s), local = snap.members.find(m=>m.binding.authenticatedUserId==="local-user"), remote = snap.members.find(m=>m.binding.authenticatedUserId==="remote");
  assert.equal(snap.dnsReady,true);assert.deepEqual(plain(local.dnsAddresses),[s.dnsAddresses[0]]);
  assert.deepEqual(plain(remote.dnsAddresses),s.dnsAddresses.slice(2));assert.equal(remote.enrollment.state,"assigned");assert.equal(remote.path,undefined);
  s.dnsReady=false;const disabled=snapshot(s);assert.ok(disabled.members.every(member=>!member.dnsAddresses));
  delete s.dnsReady;delete s.dnsAddresses;assert.deepEqual(plain(snapshot(s).members.find(m=>m.binding.authenticatedUserId==="remote").virtualIps),["10.44.0.8","10.44.0.9"]);
});
await test("DNS projection rejects stale unknown duplicated foreign-zone or unassigned names", async () => {
  for(const change of [s=>s.directoryObservedAtUnixMs=time-10001,s=>s.dnsAddresses[0].expiresAtUnixMs=time,
    s=>s.dnsAddresses[0].expiresAtUnixMs=time+10001,s=>s.dnsAddresses[0].dnsName="claimed.example",
    s=>s.dnsAddresses[0].virtualIp="10.44.0.99",s=>s.dnsAddresses.push({...s.dnsAddresses[0]}),
    s=>s.dnsAddresses.push({dnsName:`d-${"e".repeat(32)}.c-${"f".repeat(32)}.lan.voice.ruikang.wang.`,virtualIp:"10.44.0.8",expiresAtUnixMs:time+5000})]) {
    const s=enrolledSample();s.directoryObservedAtUnixMs=time;s.directory=[{serverUserId:"local-user",virtualIp:"10.44.0.2"},{serverUserId:"remote",virtualIp:"10.44.0.8"}];
    s.dnsReady=true;s.dnsAddresses=[{dnsName:`d-${"b".repeat(32)}.c-${"a".repeat(32)}.lan.voice.ruikang.wang.`,virtualIp:"10.44.0.2",expiresAtUnixMs:time+5000}];
    change(s);assert.ok(snapshot(s).members.every(member=>!member.dnsAddresses));
  }
});

function ports(overrides = {}) {
  const ids = new Set(); let starts = 0, stops = 0, runs = 0; const deleted = [], released = [], policies = [];
  let alive = true;
  const core = { isAlive: () => alive, terminateOwned: () => { stops++; alive = false; }, onExit: () => () => {},
    rpc: { runInstance: async plan => { runs++; ids.add(plan.instanceId); return { instanceId: plan.instanceId }; }, waitForRunning: async () => {}, reconcileMutation: async () => true, deleteInstance: async id => { deleted.push(id); ids.delete(id); }, listInstanceIds: async () => [...ids], collectInfo: async () => sample().info } };
  const target = dependencies["./easyTierTarget"].EASYTIER_WINDOWS_TARGET;
  const p = { activation: { approved: true, targetVerified: true, dynamicInstanceRpcVerified: true, broadcastFixVerified: true,
      targetVersion: target.version, targetCommit: target.commit, archiveSha256: target.archiveSha256 },
    provision: async (serverId, policy) => { policies.push(policy); return { serverId, instanceId: `instance-${serverId}`, networkName: `unique-${serverId}`, configRef: "opaque-native-reference", latencyFirst: false }; },
    releasePlan: async plan => { released.push(plan.serverId); }, startOwnedCore: async () => { starts++; return core; }, bindings: async () => [], now: () => time, ...overrides };
  return { p, core, ids, deleted, released, policies, counts: () => ({ starts, stops, runs }) };
}
const runtimeScope = (serverId, generation = 1) => ({ serverId, generation, signal: new AbortController().signal });
await test("native port remains gated unless exact target and dynamic RPC are accepted", async () => {
  const f = ports(); f.p.activation.approved = false;
  const runtime = new WindowsEasyTierRuntime(f.p);
  await assert.rejects(runtime.connect(runtimeScope("a"))); assert.equal(f.counts().starts, 0);
  f.p.activation.approved = true; f.p.activation.dynamicInstanceRpcVerified = false;
  assert.equal(runtime.activationReason(), "unsupported-target");
  await assert.rejects(runtime.connect(runtimeScope("a"))); assert.equal(f.counts().starts, 0);
});
await test("multiple communities share one owned core and delete only their instance", async () => {
  const f = ports(); const runtime = new WindowsEasyTierRuntime(f.p);
  const [a, b] = await Promise.all([runtime.connect(runtimeScope("a")), runtime.connect(runtimeScope("b"))]);
  assert.equal(f.counts().starts, 1); assert.equal(f.counts().runs, 2);
  await Promise.all([a.close(), a.close()]); assert.deepEqual(f.deleted, ["instance-a"]); assert.ok(f.ids.has("instance-b"));
  assert.equal(f.counts().stops, 0);
  assert.ok(f.policies.every(p => p.provider === "existing-owned" && p.providerRefs.length === 0));
  await b.close(); runtime.shutdownOwned(); runtime.shutdownOwned(); assert.equal(f.counts().stops, 1);
});
await test("network-name uniqueness is reserved before concurrent startup", async () => {
  const f = ports({ provision: async serverId => ({ serverId, instanceId: `instance-${serverId}`, networkName: "same-name", configRef: "opaque", latencyFirst: null }) });
  const runtime = new WindowsEasyTierRuntime(f.p);
  const results = await Promise.allSettled([runtime.connect(runtimeScope("a")), runtime.connect(runtimeScope("b"))]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(f.counts().runs, 1);
  await results.find(r => r.status === "fulfilled").value.close(); runtime.shutdownOwned();
});
await test("pre-existing unknown instance is never overwritten or deleted", async () => {
  const f = ports(); f.ids.add("instance-a");
  const runtime = new WindowsEasyTierRuntime(f.p); await assert.rejects(runtime.connect(runtimeScope("a")));
  assert.equal(f.counts().runs, 0); assert.deepEqual(f.deleted, []); assert.ok(f.ids.has("instance-a")); runtime.shutdownOwned();
});
await test("cancel after RPC start deletes only the attempted owned instance", async () => {
  const f = ports(), pending = defer(), cancel = new AbortController();
  f.core.rpc.runInstance = async plan => { f.ids.add(plan.instanceId); return pending.promise; };
  const runtime = new WindowsEasyTierRuntime(f.p);
  const connect = runtime.connect({ serverId: "a", generation: 1, signal: cancel.signal }); await drain();
  cancel.abort(); pending.resolve({ instanceId: "instance-a" }); await assert.rejects(connect);
  assert.deepEqual(f.deleted, ["instance-a"]); assert.deepEqual(f.released, ["a"]); runtime.shutdownOwned();
});
await test("unconfirmed delete retains ownership and retries cleanup before replacement", async () => {
  const f = ports(); let deletionFails = true;
  f.core.rpc.runInstance = async plan => { f.ids.add(plan.instanceId); throw new Error("private error"); };
  f.core.rpc.deleteInstance = async id => { if (deletionFails) throw new Error("private error"); f.deleted.push(id); f.ids.delete(id); };
  const runtime = new WindowsEasyTierRuntime(f.p);
  await assert.rejects(runtime.connect(runtimeScope("a")), e => e.reason === "cleanup-failed");
  assert.deepEqual(f.released, []);
  deletionFails = false;
  f.core.rpc.runInstance = async plan => { f.ids.add(plan.instanceId); return { instanceId: plan.instanceId }; };
  const a = await runtime.connect(runtimeScope("a", 2)); assert.deepEqual(f.deleted, ["instance-a"]);
  await a.close(); runtime.shutdownOwned();
});
await test("shutdown during asynchronous owned launch terminates its late handle", async () => {
  const f = ports(), pending = defer(); f.p.startOwnedCore = () => pending.promise;
  const runtime = new WindowsEasyTierRuntime(f.p); const connect = runtime.connect(runtimeScope("a")); await drain();
  runtime.shutdownOwned(); pending.resolve(f.core); await assert.rejects(connect); assert.equal(f.counts().stops, 1);
});
await test("IPC validates payload and trusts only the main renderer frame", async () => {
  const handlers = new Map(); const frame = {};
  const manager = new EasyTierCommunityManager(null);
  const unregister = registerEasyTierCommunityIpc({ handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) }, manager, event => event.senderFrame === frame);
  assert.throws(() => handlers.get("et-community-enabled")({ senderFrame: {} }, true), /untrusted/);
  assert.throws(() => handlers.get("et-community-connect")({ senderFrame: frame }, { serverId: "a", leaseId: "" }), /invalid/);
  assert.throws(() => handlers.get("et-community-enabled")({ senderFrame: frame }, "true"), /invalid/);
  const state = await handlers.get("et-community-connect")({ senderFrame: frame }, lease()); assert.equal(state.phase, "disabled");
  unregister(); assert.equal(handlers.size, 0);
});
await test("network preferences and relay IPC reject untrusted frames before any side effect", async () => {
  const handlers = new Map(), frame = {}, calls = [];
  const settings = {get: () => {calls.push('settings-get'); return {};}, set: value => {calls.push(value); return {};}};
  const relay = {getRelayState: value => {calls.push(value); return {};}, setRelayPreference: async value => {calls.push(value); return {};}};
  const unregister = registerEasyTierCommunityIpc({handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key)},
    new EasyTierCommunityManager(null), event => event.senderFrame === frame, undefined, undefined, false, undefined, undefined, settings, relay);
  for (const channel of ['et-community-network-preferences-get', 'et-community-network-preferences-set', 'et-community-relay-get', 'et-community-relay-set']) {
    assert.throws(() => handlers.get(channel)({senderFrame: {}}, 'community-a'), /untrusted/);
  }
  assert.equal(calls.length, 0);
  assert.throws(() => handlers.get('et-community-relay-get')({senderFrame: frame}, ''), /unavailable/);
  await handlers.get('et-community-relay-get')({senderFrame: frame}, 'community-a');
  assert.deepEqual(calls, ['community-a']);
  unregister(); assert.equal(handlers.size, 0);
});

function snapshot(s = enrolledSample(), phase = "connected") { return memberAdapter.projectEasyTierMembers(s, scope, phase, time, time); }
function memberReading(snap) { return plain(memberContract.readMemberLanStatus({ serverScope: "community-a", authenticatedUserId: "user-a", observerAuthenticatedUserId: "local-user", snapshot: snap ?? undefined, nowMs: time })); }
await test("adapter directly satisfies UI v1 contract with separate observer and target", async () => {
  const snap = snapshot(); const reading = memberReading(snap);
  assert.equal(reading.enrollment, "joined"); assert.equal(reading.path, "direct"); assert.equal(reading.rttMs, 24);
  assert.equal(snap.members[0].binding.authenticatedUserId, "user-a");
  assert.equal(snap.observer.authenticatedUserId, "local-user");
  assert.ok(!JSON.stringify(snap).includes("private"));
});
await test("RPC latency without independent measurement timestamp remains unknown", async () => {
  const s = enrolledSample(); delete s.rtt;
  assert.equal(memberReading(snapshot(s)).path, "direct");
  assert.equal(memberReading(snapshot(s)).rttMs, null);
});
await test("member binding and RTT each expire independently of a fresh route read", async () => {
  const s = enrolledSample(); s.rtt[0].observedAtUnixMs -= 1; s.rtt[0].observedAtMs -= 10001;
  assert.equal(memberReading(snapshot(s)).path, "direct"); assert.equal(memberReading(snapshot(s)).rttMs, null);
  s.bindings[0].observedAtUnixMs = time + 1;
  assert.equal(memberReading(snapshot(s)).enrollment, "unknown");
});
await test("unverified device and observer cannot publish a claimed user route", async () => {
  const s = enrolledSample(); s.bindings[0].deviceId = "";
  assert.equal(memberReading(snapshot(s)).enrollment, "unknown");
  s.bindings[1].authenticated = false; assert.equal(snapshot(s), null);
});
await test("relay role is unknown until independently verified next-hop role exists", async () => {
  const s = enrolledSample(); s.info.routes[0].next_hop_peer_id = 9;
  s.selectedRoutes[0].nextHopPeerId = 9;
  s.info.peers.push({ peer_id: 9, default_conn_id: connId, conns: [conn(9)], directly_connected_conns: [connId] });
  assert.equal(memberReading(snapshot(s)).path, "unknown");
  s.relayRoles = [{ peerId: 9, kind: "server", observedAtUnixMs: time }];
  assert.equal(memberReading(snapshot(s)).path, "server-relay");
  s.relayRoles[0].kind = "member"; assert.equal(memberReading(snapshot(s)).path, "member-relay");
});
await test("membership, clock and observer account mismatches reject a direct claim", async () => {
  const s = enrolledSample(); s.bindings[0].enrollment = "not-joined";
  assert.equal(memberReading(snapshot(s)).path, "unknown");
  const snap = snapshot();
  const otherObserver = memberContract.readMemberLanStatus({ serverScope: "community-a", authenticatedUserId: "user-a", observerAuthenticatedUserId: "wrong-account", snapshot: snap, nowMs: time });
  assert.equal(otherObserver.path, "unknown");
  time += 10001; assert.equal(memberReading(snap).enrollment, "stale"); time -= 10001;
});
await test("wrong candidate version commit or archive digest cannot activate", async () => {
  for (const field of ["targetVersion", "targetCommit", "archiveSha256"]) {
    const f = ports(); f.p.activation[field] = "wrong-target";
    const runtime = new WindowsEasyTierRuntime(f.p); assert.equal(runtime.activationReason(), "unsupported-target");
    await assert.rejects(runtime.connect(runtimeScope("a"))); assert.equal(f.counts().starts, 0);
  }
});
await test("indeterminate mutation cannot be cleaned by a premature absent list", async () => {
  const f = ports(); delete f.core.rpc.reconcileMutation;
  f.core.rpc.runInstance = async () => { throw new Error("transport-lost"); };
  const runtime = new WindowsEasyTierRuntime(f.p);
  await assert.rejects(runtime.connect(runtimeScope("a")), error => error.reason === "cleanup-failed");
  assert.deepEqual(f.deleted, []); assert.deepEqual(f.released, []);
  runtime.shutdownOwned();
});
await test("instance ACK alone does not report connected before running readiness", async () => {
  const f = ports(), ready = defer(); f.core.rpc.waitForRunning = () => ready.promise;
  const runtime = new WindowsEasyTierRuntime(f.p); let connected = false;
  const start = runtime.connect(runtimeScope("a")).then(value => { connected = true; return value; });
  await drain(); assert.equal(connected, false);
  ready.resolve(); const a = await start; assert.equal(connected, true); await a.close(); runtime.shutdownOwned();
});
await test("route candidate without final forwarding evidence stays unknown", async () => {
  const s = sample(); delete s.selectedRoutes;
  assert.equal(projection(s).peers[0].route, "unknown");
  s.selectedRoutes = [{ fromPeerId: 1, toPeerId: 7, nextHopPeerId: 9, observedAtMs: time, observedAtUnixMs: time }];
  assert.equal(projection(s).peers[0].route, "unknown");
});

console.log(`${checks} community EasyTier pure checks passed; no runtime or network activated`);
