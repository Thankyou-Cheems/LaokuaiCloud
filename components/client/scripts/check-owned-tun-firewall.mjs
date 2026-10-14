/* eslint-env node */
// Source + fake CLR checks only. Never activates Windows firewall COM or a TUN.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import ts from "typescript";

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL("../electron/windowsFirewallRules.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
const module = {exports: {}};
vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`)(require, module, module.exports);
const api = module.exports;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "laokuai-tun-firewall-"));
const ledgerFile = path.join(root, "owned-tun-firewall.json");
const evidence = {guid: "11111111-1111-1111-1111-111111111111", luid: "1234", ifIndex: 17,
  localAddress: "10.126.0.3", remoteSubnet: "10.126.0.0/24"};
const nativeRules = new Map(), calls = [];
let failResolve = false, failEnsure = false, adds = 0, removes = 0;
const exact = (native, rule) => native.ownershipId === rule.ownershipId && native.interfaceAlias === rule.interfaceAlias
  && native.guid === rule.guid && native.luid === rule.luid && native.ifIndex === rule.ifIndex
  && native.localAddress === rule.localAddress && native.remoteSubnet === rule.remoteSubnet;
const invoke = async (_helper, request) => {
  calls.push(request);
  const result = {schemaVersion: 1, installed: [], removed: [], failures: []};
  if (request.operation === "resolve") {
    if (failResolve) throw new Error("owned interface absent");
    return {...result, scope: {...request.evidence, interfaceAlias: "唠蒯云 TUN"}};
  }
  const ledger = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
  for (const rule of request.rules) {
    assert.ok(ledger.rules.some(saved => saved.name === rule.name && saved.ownershipId === rule.ownershipId), "durable ownership before mutation");
    const current = nativeRules.get(rule.name), operation = request.operation;
    if ((current && !exact(current, rule)) || (operation === "ensure" && failEnsure)) {
      result.failures.push({operation, name: rule.name, code: "ownership-mismatch"}); continue;
    }
    if (operation === "ensure") {
      if (!current) {nativeRules.set(rule.name, {...rule}); adds++;}
      result.installed.push(rule.name);
    } else {
      if (current) {nativeRules.delete(rule.name); removes++;}
      result.removed.push(rule.name);
    }
  }
  return result;
};
const options = {platform: "win32", product: true, helperExecutable: "C:\\唠蒯云\\helper.exe", ledgerFile, invoke};
try {
  assert.equal(api.validLaokuaiOwnedTunFirewallEvidence(evidence), true);
  for (const changes of [
    {guid: "00000000-0000-0000-0000-000000000000"}, {guid: "EasyTier"}, {luid: "0"}, {luid: "18446744073709551616"},
    {ifIndex: 0}, {ifIndex: 0xffffffff}, {localAddress: "10.126.0.03"}, {localAddress: "127.0.0.1"}, {localAddress: "8.8.8.8"},
    {remoteSubnet: "0.0.0.0/0"}, {remoteSubnet: "10.126.0.1/24"}, {remoteSubnet: "10.126.1.0/24"},
    {remoteSubnet: "10.0.0.0/7"}, {remoteSubnet: "192.168.0.0/15"}, {remoteSubnet: "*"},
  ]) {
    const before = calls.length;
    assert.equal((await api.prepareLaokuaiOwnedTunFirewallRules(options, {...evidence, ...changes})).status, "failed");
    assert.equal(calls.length, before, "invalid scope cannot invoke helper");
  }
  const first = await api.prepareLaokuaiOwnedTunFirewallRules(options, evidence);
  assert.equal(first.status, "prepared"); assert.equal(first.installed.length, 1); assert.equal(adds, 1);
  assert.match(first.installed[0].name, /^LaokuaiCloud\.OwnedTun\.Icmp\.v1\.[0-9a-f]{24}$/);
  const repeated = await api.prepareLaokuaiOwnedTunFirewallRules(options, evidence);
  assert.deepEqual(repeated.installed, first.installed); assert.equal(adds, 1);
  const otherEvidence = {...evidence, guid: "22222222-2222-2222-2222-222222222222", luid: "2345", ifIndex: 18,
    localAddress: "10.127.0.3", remoteSubnet: "10.127.0.0/24"};
  const other = await api.prepareLaokuaiOwnedTunFirewallRules(options, otherEvidence);
  assert.equal(other.status, "prepared"); assert.equal(nativeRules.size, 2);
  await api.releaseLaokuaiOwnedTunFirewallRules(options, [{...first.installed[0], ownershipId: "d".repeat(32)}]);
  assert.equal(nativeRules.size, 2, "foreign handle cannot select ledger authority");
  failResolve = true;
  assert.equal((await api.prepareLaokuaiOwnedTunFirewallRules(options, evidence)).status, "failed");
  assert.equal(nativeRules.size, 2);
  await api.releaseLaokuaiOwnedTunFirewallRules(options, first.installed);
  assert.equal(nativeRules.size, 1); assert.equal(removes, 1);
  assert.equal(JSON.parse(fs.readFileSync(ledgerFile, "utf8")).rules.length, 1);
  failResolve = false; failEnsure = true;
  const failed = await api.prepareLaokuaiOwnedTunFirewallRules(options, evidence);
  assert.equal(failed.status, "failed"); assert.equal(failed.installed.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(ledgerFile, "utf8")).rules.length, 2, "failed mutation retains cleanup authority");
  failEnsure = false;
  await api.prepareLaokuaiOwnedTunFirewallRules(options, evidence);
  nativeRules.get(other.installed[0].name).interfaceAlias = null;
  const partial = await api.cleanupLaokuaiOwnedTunFirewallRules(options);
  assert.equal(partial.status, "partial"); assert.equal(nativeRules.size, 1);
  assert.equal(JSON.parse(fs.readFileSync(ledgerFile, "utf8")).rules.length, 1, "null interface cannot authorize global-shaped removal");
  const saved = fs.readFileSync(ledgerFile, "utf8"), count = calls.length;
  fs.unlinkSync(ledgerFile);
  assert.equal((await api.cleanupLaokuaiOwnedTunFirewallRules(options)).status, "prepared");
  assert.equal(calls.length, count); assert.equal(nativeRules.size, 1);
  fs.writeFileSync(ledgerFile, "{broken");
  assert.equal((await api.prepareLaokuaiOwnedTunFirewallRules(options, evidence)).status, "failed");
  assert.equal((await api.cleanupLaokuaiOwnedTunFirewallRules(options)).status, "failed");
  assert.equal(calls.length, count); assert.equal(fs.readFileSync(ledgerFile, "utf8"), "{broken");
  fs.writeFileSync(ledgerFile, saved);
  let mutationCalls = 0;
  const writeFailed = await api.prepareLaokuaiOwnedTunFirewallRules({...options,
    writeLedgerFile: () => {throw new Error("disk failure");}, invoke: async (_helper, request) => {
      if (request.operation !== "resolve") mutationCalls++;
      return {schemaVersion: 1, scope: {...evidence, interfaceAlias: "唠蒯云 TUN"}, installed: [], removed: [], failures: []};
    }}, evidence);
  assert.equal(writeFailed.status, "failed"); assert.equal(mutationCalls, 0);
  assert.equal((await api.prepareLaokuaiOwnedTunFirewallRules({...options, product: false}, evidence)).status, "bypassed");
  const mismatch = await api.prepareLaokuaiOwnedTunFirewallRules({...options, invoke: async () => ({schemaVersion: 1,
    scope: {...evidence, localAddress: "10.126.0.5", interfaceAlias: "唠蒯云 TUN"}, installed: [], removed: [], failures: []})}, evidence);
  assert.equal(mismatch.status, "failed");
  const deferredResolve = await api.prepareLaokuaiOwnedTunFirewallRules({...options, invoke: async () => ({schemaVersion: 1,
    installed: [], removed: [], failures: [{operation: "ensure", name: "owned-tun-firewall", code: "tun-not-ready"}]})}, evidence);
  assert.equal(deferredResolve.failures[0].code, "tun-not-ready", "transient native resolution code reaches the wrapper");
  const deferredEnsure = await api.prepareLaokuaiOwnedTunFirewallRules({...options, invoke: async (_helper, request) => request.operation === "resolve"
    ? {schemaVersion: 1, scope: {...evidence, interfaceAlias: "唠蒯云 TUN"}, installed: [], removed: [], failures: []}
    : {schemaVersion: 1, installed: [], removed: [], failures: [{operation: "ensure", name: request.rules[0].name, code: "tun-not-ready"}]}}, evidence);
  assert.equal(deferredEnsure.failures[0].code, "tun-not-ready", "native second validation code reaches the wrapper");
  const identityFailure = await api.prepareLaokuaiOwnedTunFirewallRules({...options, invoke: async () => ({schemaVersion: 1,
    installed: [], removed: [], failures: [{operation: "ensure", name: "owned-tun-firewall", code: "tun-scope-unverified"}]})}, evidence);
  assert.equal(identityFailure.failures[0].code, "tun-scope-unverified", "identity mismatch is permanent");
  assert.equal((await api.prepareLaokuaiOwnedTunFirewallRules({...options, invoke: async () => ({schemaVersion: 1,
    installed: [], removed: [], failures: [null]})}, evidence)).status, "failed", "malformed response produces a bounded report");
  const invalidLedger = JSON.parse(saved); invalidLedger.rules[0].remoteSubnet = "0.0.0.0/0";
  fs.writeFileSync(ledgerFile, JSON.stringify(invalidLedger));
  const beforeInvalid = calls.length;
  assert.equal((await api.cleanupLaokuaiOwnedTunFirewallRules(options)).status, "failed"); assert.equal(calls.length, beforeInvalid);
  if (process.platform === "win32") {
    const helper = fileURLToPath(new URL("../build/community-lan-helper/laokuai-community-broker.exe", import.meta.url));
    const output = execFileSync(helper, ["--firewall-tun-self-test"], {encoding: "utf8", windowsHide: true, timeout: 8000});
    assert.match(output, /PASS scoped TUN firewall CLR fixture/);
    assert.ok(output.includes(first.installed[0].name), "native and TS deterministic scope names agree");
  }
  console.log("PASS scoped owned TUN firewall: exact evidence/subnet validation, durable ownership, idempotence, independent scopes, exact release, collisions and null interfaces, crash ledger, corrupt ledger and write failure; host firewall untouched");
} finally {fs.rmSync(root, {recursive: true, force: true});}
