/* eslint-env node */
// Pure source/CLR contracts. Never invokes the production --firewall command.
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
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`)(require, module, module.exports);
const firewall = module.exports;
const appPath = "C:\\唠蒯云\\唠蒯云.exe";
const corePath = "C:\\唠蒯云\\laokuai-chat-data\\community-lan\\runtime\\2.7.0-laokuai\\cache\\easytier-core.exe";
const ledgerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "laokuai-firewall-contract-"));
const ledgerFile = path.join(ledgerRoot, "firewall-rules.json");
try {
  assert.equal(firewall.normalizeLaokuaiFirewallPath("c:/唠蒯云//唠蒯云.exe"), appPath);
  for (const invalid of ["relative.exe", "\\\\server\\app.exe", "C:\\bad\napp.exe", 'C:\\"bad.exe']) assert.equal(firewall.normalizeLaokuaiFirewallPath(invalid), null);
  assert.equal(firewall.laokuaiFirewallRuleName("app", appPath), firewall.laokuaiFirewallRuleName("app", "c:/唠蒯云/唠蒯云.exe"));
  assert.notEqual(firewall.laokuaiFirewallRuleName("app", appPath), firewall.laokuaiFirewallRuleName("easytier", appPath));
  const calls = [], fake = new Map();
  let adds = 0, removes = 0;
  const owned = (current, rule) => current.owner === rule.ownershipId && current.program.toLowerCase() === rule.program.toLowerCase()
    && current.action === "allow" && current.direction === "in" && current.profile === "all" && current.enabled;
  const invoke = async (_helper, request) => {
    assert.equal(request.schemaVersion, 2);
    // Ownership must be durable before any mutation starts.
    const ledger = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
    for (const rule of request.ensure) assert.ok(ledger.rules.some(saved => saved.name === rule.name && saved.ownershipId === rule.ownershipId));
    calls.push(request);
    const result = { schemaVersion: 2, installed: [], removed: [], failures: [] };
    for (const rule of request.ensure) {
      const current = fake.get(rule.name);
      if (current && !owned(current, rule)) { result.failures.push({ operation: "ensure", name: rule.name, code: "ownership-mismatch" }); continue; }
      if (!current) { fake.set(rule.name, { owner: rule.ownershipId, program: rule.program, action: "allow", direction: "in", profile: "all", enabled: true }); adds++; }
      result.installed.push(rule.name);
    }
    for (const rule of request.remove) {
      if (request.operation === "reconcile" && !request.ensure.some(next => next.kind === rule.kind && result.installed.includes(next.name))) {
        result.failures.push({ operation: "remove", name: rule.name, code: "replacement-unavailable" }); continue;
      }
      const current = fake.get(rule.name);
      if (current && !owned(current, rule)) { result.failures.push({ operation: "remove", name: rule.name, code: "ownership-mismatch" }); continue; }
      if (current) { fake.delete(rule.name); removes++; }
      result.removed.push(rule.name);
    }
    return result;
  };
  const options = { platform: "win32", product: true, appExecutable: appPath, easyTierExecutable: corePath,
    helperExecutable: "C:\\唠蒯云\\community-lan-helper\\laokuai-community-broker.exe", ledgerFile, fileExists: () => true, invoke };
  const first = await firewall.prepareLaokuaiFirewallRules(options);
  assert.equal(first.status, "prepared"); assert.equal(first.installed.length, 2); assert.equal(adds, 2);
  const firstOwners = first.installed.map(rule => rule.ownershipId);
  const repeat = await firewall.prepareLaokuaiFirewallRules(options);
  assert.deepEqual(repeat.installed.map(rule => rule.ownershipId), firstOwners);
  assert.equal(adds, 2); assert.equal(removes, 0);
  await firewall.prepareLaokuaiFirewallRules({ ...options, easyTierExecutable: null });
  assert.equal(calls.at(-1).remove.length, 0); assert.equal(fake.size, 2);
  const movedPath = "D:\\Games\\唠蒯云\\唠蒯云.exe";
  const moved = await firewall.prepareLaokuaiFirewallRules({ ...options, appExecutable: movedPath, easyTierExecutable: null });
  assert.equal(moved.status, "prepared"); assert.equal(removes, 1); assert.equal(fake.size, 2);
  const savedLedger = fs.readFileSync(ledgerFile, "utf8");
  // A path alone provides no ownership authority. Missing ledger leaves all rules untouched.
  fs.unlinkSync(ledgerFile);
  const count = calls.length;
  assert.equal((await firewall.cleanupLaokuaiFirewallRules(options)).status, "prepared");
  assert.equal(calls.length, count); assert.equal(fake.size, 2);
  // Corrupt ledger must not be overwritten or trigger any native request.
  fs.writeFileSync(ledgerFile, "{broken");
  assert.equal((await firewall.prepareLaokuaiFirewallRules(options)).status, "failed");
  assert.equal((await firewall.cleanupLaokuaiFirewallRules(options)).status, "failed");
  assert.equal(calls.length, count); assert.equal(fs.readFileSync(ledgerFile, "utf8"), "{broken");
  fs.writeFileSync(ledgerFile, savedLedger);
  const appRule = JSON.parse(savedLedger).rules.find(rule => rule.kind === "app");
  fake.get(appRule.name).action = "block";
  const cleanup = await firewall.cleanupLaokuaiFirewallRules(options);
  assert.equal(cleanup.status, "partial"); assert.equal(fake.size, 1); assert.equal(fake.get(appRule.name).action, "block");
  assert.equal(JSON.parse(fs.readFileSync(ledgerFile, "utf8")).rules.length, 1);
  // A failed replacement must keep the prior rule and durable removal candidate.
  const failedReplacement = await firewall.prepareLaokuaiFirewallRules({ ...options, appExecutable: appPath,
    easyTierExecutable: null, invoke: async (_helper, request) => ({ schemaVersion: 2, installed: [], removed: [],
      failures: request.ensure.map(rule => ({ operation: "ensure", name: rule.name, code: "com-add-failed" })) }) });
  assert.equal(failedReplacement.status, "failed");
  assert.ok(JSON.parse(fs.readFileSync(ledgerFile, "utf8")).rules.some(rule => rule.name === appRule.name));
  let writeFailCalls = 0;
  const writeFail = await firewall.prepareLaokuaiFirewallRules({ ...options,
    writeLedgerFile: () => { throw new Error("disk unavailable"); }, invoke: () => { writeFailCalls++; } });
  assert.equal(writeFail.status, "failed"); assert.equal(writeFailCalls, 0);
  assert.equal((await firewall.prepareLaokuaiFirewallRules({ ...options, product: false, invoke: () => { throw new Error("bypass violated"); } })).status, "bypassed");
  // Check the real native ownership/mutation functions against CLR objects.
  if (process.platform === "win32") {
    const helper = fileURLToPath(new URL("../build/community-lan-helper/laokuai-community-broker.exe", import.meta.url));
    const output = execFileSync(helper, ["--firewall-self-test"], { encoding: "utf8", windowsHide: true, timeout: 8000 });
    assert.match(output, /PASS firewall CLR fixture/);
  }
  const main = fs.readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8");
  assert.ok(main.includes('label: "清理本应用网络规则并退出"'));
  assert.ok(main.includes("firewallStopping = true"));
  assert.ok(main.includes("if (!(await prepareLaokuaiFirewall()))"));
  assert.ok(main.includes("if (LAOKUAI_FIREWALL_CLEANUP_REQUESTED)"));
  assert.ok(!source.includes("execFileSync"));
  const workStart = main.indexOf("let firewallWork:");
  const workEnd = main.indexOf("if (IS_LAOKUAI && !EXPLICIT_OFFLINE_TEST)", workStart);
  assert.ok(workStart > 0 && workEnd > workStart);
  const wiring = ts.transpileModule(main.slice(workStart, workEnd), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let bootstrapCalls = 0;
  const offline = vm.createContext({ LAOKUAI_FIREWALL_ENABLED: false,
    prepareLaokuaiFirewallRules: () => { bootstrapCalls++; throw new Error("offline touched backend"); } });
  vm.runInContext(wiring, offline);
  assert.equal(await offline.prepareLaokuaiFirewall(corePath), true); assert.equal(bootstrapCalls, 0);
  let firstResolve, prompts = 0;
  const queued = vm.createContext({ LAOKUAI_FIREWALL_ENABLED: true, LAOKUAI_FIREWALL_CLEANUP_REQUESTED: false,
    laokuaiFirewallOptions: () => options, startupLog: () => {}, dialog: { showErrorBox: () => prompts++ },
    prepareLaokuaiFirewallRules: async () => { bootstrapCalls++; return new Promise(resolve => { firstResolve = resolve; }); } });
  vm.runInContext(wiring, queued);
  const appPrepare = queued.prepareLaokuaiFirewall(), corePrepare = queued.prepareLaokuaiFirewall(corePath);
  await Promise.resolve(); assert.equal(bootstrapCalls, 1, "preparation is serialized");
  vm.runInContext("firewallStopping = true", queued);
  firstResolve({ status: "prepared", installed: [{}], removed: [], failures: [] });
  assert.equal(await appPrepare, true); assert.equal(await corePrepare, false);
  assert.equal(bootstrapCalls, 1, "quit cancels queued firewall mutations"); assert.equal(prompts, 0);
  const failed = vm.createContext({ LAOKUAI_FIREWALL_ENABLED: true, LAOKUAI_FIREWALL_CLEANUP_REQUESTED: false,
    laokuaiFirewallOptions: () => options, startupLog: () => {}, dialog: { showErrorBox: () => prompts++ },
    prepareLaokuaiFirewallRules: async () => ({ status: "failed", installed: [], removed: [], failures: [{}] }) });
  vm.runInContext(wiring, failed);
  assert.equal(await failed.prepareLaokuaiFirewall(corePath), false);
  assert.equal(await failed.prepareLaokuaiFirewall(corePath), false);
  assert.equal(prompts, 1, "failure is explicit without repeated error boxes");
  // Exercise the actual production adapter with fake assets/process ports.
  const productionSource = fs.readFileSync(new URL("../electron/easyTierWindowsProduction.ts", import.meta.url), "utf8");
  const productionCode = ts.transpileModule(productionSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const productionModule = { exports: {} };
  let nativeStarts = 0, networkingReady = false;
  const preparedPaths = [];
  vm.runInThisContext(`(function(require,module,exports){${productionCode}\n})`)(name => {
    if (name.startsWith("node:")) return require(name);
    if (name === "./easyTierExistingConfiguration") return { readEasyTierExistingConfiguration: () => ({}) };
    if (name === "./easyTierWindowsAssets") return { EasyTierWindowsAssets: class { async prepareProductBundled() { return path.win32.dirname(corePath); } } };
    if (name === "./easyTierWindowsProcesses") return { hasEasyTierWindowsPermission: async () => true,
      EasyTierWindowsProcesses: class { start() { nativeStarts++; return {}; } } };
    if (name === "./windowsEasyTierCliRuntime") return { WindowsEasyTierCliRuntime: class { constructor(ports) { this.ports = ports; } } };
    throw new Error(`unexpected production import ${name}`);
  }, productionModule, productionModule.exports);
  const production = productionModule.exports.createWindowsEasyTierProduction(() => ledgerRoot, () => ledgerRoot,
    undefined, undefined, async executable => { preparedPaths.push(executable); return networkingReady; });
  assert.equal(await production.preparePermission(), false);
  assert.equal((await production.prepareRuntime()).ready, false);
  await assert.rejects(production.runtime.ports.start(path.win32.dirname(corePath), {}, new AbortController().signal), /firewall-preparation-failed/);
  assert.equal(nativeStarts, 0); assert.ok(preparedPaths.every(value => value === corePath));
  networkingReady = true;
  assert.equal(await production.preparePermission(), true);
  await production.runtime.ports.start(path.win32.dirname(corePath), {}, new AbortController().signal);
  assert.equal(nativeStarts, 1);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(production.runtime.ports.start(path.win32.dirname(corePath), {}, aborted.signal), /canceled/);
  assert.equal(nativeStarts, 1);
  console.log("PASS Windows firewall contracts: durable ownership, idempotent two-rule prepare, app-only preservation, moved paths, missing/corrupt ledger, collision retention, failed replacement, pre-write failure, native CLR fixture; host firewall untouched");
} finally { fs.rmSync(ledgerRoot, { recursive: true, force: true }); }
