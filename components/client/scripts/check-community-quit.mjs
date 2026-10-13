/* eslint-env node */
// Execute the production before-quit handler with controlled drains, no Electron/native.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import ts from "typescript";

const main = fs.readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8");
const start = main.indexOf('// Registered before updater hooks:');
const end = main.indexOf('let tray: Tray | null = null;', start);
assert.ok(start >= 0 && end > start);
const code = ts.transpileModule(main.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));
async function scenario(failure, cleanup = false, dnsFailure = false) {
  const calls = [], native = deferred(), grant = deferred(), dns = deferred();
  let handler;
  const context = {
    LAOKUAI_PREVIEW: false, UI_ACCEPTANCE_MODE: false, IS_I18N_TEST: true, IS_LAOKUAI: true,
    easyTierQuitDrained: false, easyTierQuitDraining: false, isQuitting: false, easyTierPoll: 1,
    firewallStopping: false, firewallWork: Promise.resolve(true), cleanupFirewallOnQuit: cleanup,
    cleanupLaokuaiFirewallRules: async () => { calls.push("cleanup-firewall"); return { status: "prepared" }; },
    laokuaiFirewallOptions: () => ({}), dialog: { showErrorBox: () => calls.push("cleanup-dialog") },
    app: { on: (_event, fn) => { handler = fn; }, quit: () => calls.push("quit") },
    BrowserWindow: { getAllWindows: () => [
      { close: () => { assert.equal(context.isQuitting, true); calls.push("close-main"); } },
      { close: () => calls.push("close-popout") },
    ] },
    tray: { isDestroyed: () => false, destroy: () => calls.push("remove-tray") },
    closeMediaSandbox: () => calls.push("close-media-sandbox"),
    clearInterval: () => calls.push("stop-poll"),
    easyTierEnrollment: { shutdown: () => calls.push("stop-enrollment") },
    easyTierCommunities: { shutdownOwned: () => calls.push("stop-owned") },
    easyTierProduction: { drainOwned: () => { calls.push("drain-native"); return native.promise; } },
    easyTierGrants: { drainOwned: () => { calls.push("drain-grant"); return grant.promise; } },
    communityDns: { stop: () => { calls.push("drain-dns"); return dns.promise; } },
    localDiagnostics: { record: () => {} }, console: { warn: () => calls.push("cleanup-warning") },
  };
  vm.runInNewContext(code, context);
  const event = { preventDefault: () => calls.push("prevent-quit") };
  handler(event);
  assert.ok(calls.includes("close-main"), "main window must close before drains resolve");
  assert.ok(calls.includes("close-popout"), "popouts must close too");
  assert.ok(calls.includes("remove-tray"), "tray must disappear immediately");
  assert.ok(calls.includes("close-media-sandbox"), "upload media sandbox must close before background cleanup");
  assert.ok(calls.includes("stop-poll"), "no fresh polling during retirement");
  assert.equal(context.tray, null);
  assert.equal(context.firewallStopping, true);
  assert.equal(calls.includes("quit"), false);
  handler(event);
  assert.equal(calls.filter(c => c === "drain-native").length, 1, "repeat quit shares cleanup");
  if (failure) native.reject(new Error("fixture cleanup failure")); else native.resolve();
  await flush();
  assert.equal(calls.includes("quit"), false, "even a failed drain cannot abandon the other drain");
  assert.equal(calls.includes("cleanup-firewall"), false, "rule cleanup waits for both drains");
  grant.resolve(); await flush();
  assert.equal(calls.includes("quit"), false, "DNS ownership cleanup also finishes before process exit");
  if (dnsFailure) dns.reject(new Error("fixture DNS cleanup failure")); else dns.resolve();
  await flush();
  assert.equal(calls.filter(c => c === "quit").length, 1);
  assert.equal(context.easyTierQuitDrained, true);
  assert.equal(calls.includes("cleanup-warning"), failure || dnsFailure);
  assert.equal(calls.includes("cleanup-firewall"), cleanup && !failure && !dnsFailure);
  if (cleanup && !failure && !dnsFailure) assert.ok(calls.indexOf("cleanup-firewall") < calls.indexOf("quit"));
  const before = calls.length;
  handler(event);
  assert.equal(calls.length, before, "completed quit is no longer intercepted");
}
await scenario(false);
await scenario(true);
await scenario(false, true);
await scenario(true, true);
await scenario(false, true, true);
console.log("PASS production quit handler: immediate window/sandbox/tray retirement, single cleanup, native/grant/DNS drains settle before exit");
