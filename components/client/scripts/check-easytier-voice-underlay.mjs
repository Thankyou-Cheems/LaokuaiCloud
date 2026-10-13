/* Pure selected-pair/owned-cache checks. No PC, ET process, driver, IPC or network. */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/easyTierVoiceUnderlay.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} });
assert.deepEqual(compiled.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), []);
const exports = {};
vm.runInNewContext(compiled.outputText, { exports, Date, Number, String, Array, Object, Set, Map });
const { createEasyTierVoiceUnderlayResolver } = exports;
const now = Date.now();
const direct = () => ({ source: "owned-cli-route-list", serverId: "community", generation: 3,
  instanceId: "00000000-0000-4000-8000-000000000003", acquisitionStartedAtUnixMs: now,
  acquiredAtUnixMs: now, maxAgeMs: 5000, running: true, localPeerId: 1, virtualIp: "10.8.0.1", latencyFirst: false,
  routes: [{ peerId: 7, virtualIp: "10.8.0.7", nextHopPeerId: 7, latencyFirstNextHopPeerId: 7, cost: 2, latencyFirstCost: 2 }],
  peers: [{ peerId: 7, defaultConnectionId: "conn-7", connections: [{ connectionId: "conn-7", closed: false, tunnelType: "udp", reportedDirect: true }] }],
  memberBinding: "unavailable", rttMs: null, missingEvidence: ["authenticated-user-peer-binding", "selected-forwarding-decision", "rtt-measurement-time", "trusted-next-hop-role", "full-physical-path"] });
const reading = details => ({ serverId: "community", generation: 3, details, reason: "available", memberBindings: [], physicalPath: "unknown", rttMs: null });
const pair = (local, remote, classification = "non-turn-candidate") => ({ source: "rtc-selected-candidate-pair", observedAtMs: 100,
  classification, reason: classification === "turn-relay" ? "turn-relay" : "selected-pair", pairId: "pair", underlay: null,
  local: { candidateId: "local", candidateType: "host", address: local, port: 1, protocol: "udp" },
  remote: { candidateId: "remote", candidateType: "host", address: remote, port: 2, protocol: "udp" } });
const resolvePath = (details, value) => createEasyTierVoiceUnderlayResolver(reading(details)).resolve(value);
const classify = (details, value) => resolvePath(details, value).classification;
let checks = 0;
const test = (name, fn) => { fn(); checks++; console.log(`PASS ${name}`); };

test("exact current ET VIP and one-hop selected route are ET direct", () => {
  const details = direct();
  const value = pair("10.8.0.1", "10.8.0.7"); value.observedAtMs = 5000;
  details.acquiredAtUnixMs = Date.now() - 4900;
  const result = resolvePath(details, value);
  assert.equal(result.classification, "easytier-direct");
  assert.ok(result.observedAtMs >= 0 && result.observedAtMs <= 200);
  const rendererRestartPath = pair("10.8.0.1", "10.8.0.7"); rendererRestartPath.observedAtMs = 1000;
  assert.equal(resolvePath(details, rendererRestartPath).classification, "unknown");
});
test("known ET VIP with a multi-hop selected route is ET relay", () => {
  const details = direct(); details.routes[0].nextHopPeerId = 9; details.routes[0].cost = 3;
  details.peers.push({ peerId: 9, defaultConnectionId: "conn-9", connections: [{ connectionId: "conn-9", closed: false, tunnelType: "udp", reportedDirect: true }] });
  assert.equal(classify(details, pair("10.8.0.1", "10.8.0.7")), "easytier-relay");
});
test("known VIP without latency policy or live selected direct connection stays unknown", () => {
  const noPolicy = direct(); noPolicy.latencyFirst = null;
  assert.equal(classify(noPolicy, pair("10.8.0.1", "10.8.0.7")), "unknown");
  const noConnection = direct(); noConnection.peers[0].connections[0].closed = null;
  assert.equal(classify(noConnection, pair("10.8.0.1", "10.8.0.7")), "unknown");
  const noRoute = direct(); noRoute.routes = [];
  assert.equal(classify(noRoute, pair("10.8.0.1", "10.8.0.7")), "unknown");
});
test("private endpoints without current ET cache are fail-closed and public pairs are not blocked", () => {
  assert.equal(classify(null, pair("192.168.1.2", "192.168.1.3")), "unknown");
  assert.equal(classify(null, pair("8.8.8.8", "1.1.1.1")), "not-easytier");
  const hostToSrflx = pair("192.168.1.2", "8.8.8.8"); hostToSrflx.remote.candidateType = "srflx";
  assert.equal(classify(direct(), hostToSrflx), "not-easytier");
  for (const special of ["0.0.0.0", "127.0.0.1", "10.203.217.99", "192.0.2.1", "224.0.0.1", "240.0.0.1"]) {
    assert.equal(classify(direct(), pair(special, "8.8.8.8")), "unknown");
  }
});
test("a pair outside the current ET VIP set is ordinary non-ET", () => {
  const publicPair = pair("8.8.8.8", "1.1.1.1"); publicPair.observedAtMs = 5000;
  const publicResult = resolvePath(direct(), publicPair);
  assert.equal(publicResult.classification, "not-easytier");
  assert.equal(publicResult.observedAtMs, publicPair.observedAtMs);
  assert.equal(classify(direct(), pair("192.168.1.2", "192.168.1.3")), "unknown");
});
test("TURN and missing candidate evidence never become ET proof", () => {
  assert.equal(classify(direct(), pair("10.8.0.1", "10.8.0.7", "turn-relay")), "not-easytier");
  const missing = pair("10.8.0.1", "10.8.0.7"); missing.remote.address = null;
  assert.equal(classify(direct(), missing), "unknown");
  assert.equal(classify(direct(), null), "unknown");
  assert.equal(classify(direct(), pair("10.8.0.1", "not-an-ip")), "unknown");
});
test("valid global IPv6 is non-ET while malformed or private IPv6 stays unknown", () => {
  assert.equal(classify(direct(), pair("2001:4860:4860::8888", "2606:4700:4700::1111")), "not-easytier");
  assert.equal(classify(direct(), pair("2001:db8::1", "2606:4700:4700::1111")), "unknown");
  assert.equal(classify(direct(), pair("fd00::1", "fd00::2")), "unknown");
  assert.equal(classify(direct(), pair("::ffff:10.0.0.1", "::ffff:10.0.0.2")), "unknown");
  assert.equal(classify(direct(), pair("2001:::1", "2001:db8::2")), "unknown");
});
test("missing or unsupported ICE protocol stays unknown", () => {
  const missing = pair("8.8.8.8", "1.1.1.1"); missing.local.protocol = null;
  assert.equal(classify(direct(), missing), "unknown");
  const unsupported = pair("8.8.8.8", "1.1.1.1"); unsupported.remote.protocol = "quic";
  assert.equal(classify(direct(), unsupported), "unknown");
});
test("unknown ET tunnel protocol cannot be called direct", () => {
  const details = direct(); details.peers[0].connections[0].tunnelType = "unknown";
  assert.equal(classify(details, pair("10.8.0.1", "10.8.0.7")), "unknown");
});
test("expired owned cache cannot approve an ET path", () => {
  const details = direct(); details.acquiredAtUnixMs = now - 6001;
  const result = resolvePath(details, pair("10.8.0.1", "10.8.0.7"));
  assert.equal(result.classification, "unknown");
});
console.log(`${checks} EasyTier voice underlay checks passed.`);
