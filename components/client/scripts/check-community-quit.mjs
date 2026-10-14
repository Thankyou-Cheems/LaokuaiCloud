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
const finalStart = main.lastIndexOf('  app.on(', main.indexOf('"will-quit"'));
const finalEnd = main.indexOf('\n  );', finalStart) + '\n  );'.length;
assert.ok(finalStart > end && finalEnd > finalStart);
assert.equal(main.slice(0, start).includes('app.on("will-quit"'), false, 'writer must not close before the real synchronous cleanup');
const code = ts.transpileModule(main.slice(start, end) + main.slice(finalStart, finalEnd), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));
async function scenario(failure, cleanup = false, dnsFailure = false, syncFailure = false, observerFailure = false, prefixFailure = '') {
  const calls = [], diagnostics = [], handlers = new Map(), native = deferred(), grant = deferred(), dns = deferred();
  let now = 0;
  const context = {
    LAOKUAI_PREVIEW: false, UI_ACCEPTANCE_MODE: false, IS_I18N_TEST: true, IS_LAOKUAI: true,
    easyTierQuitDrained: false, easyTierQuitDraining: false, isQuitting: false, easyTierPoll: 1,
    firewallStopping: false, firewallWork: Promise.resolve(true), cleanupFirewallOnQuit: cleanup,
    cleanupLaokuaiFirewallRules: async () => { calls.push("cleanup-firewall"); return { status: "prepared" }; },
    laokuaiFirewallOptions: () => ({}), dialog: { showErrorBox: () => calls.push("cleanup-dialog") },
    app: { on: (event, fn) => { handlers.set(event, fn); }, quit: () => calls.push("quit") },
    performance: { now: () => now },
    BrowserWindow: { getAllWindows: () => [
      { close: () => { assert.equal(context.isQuitting, true); calls.push("close-main"); now += 2; if (prefixFailure === 'window') throw Error('private-window-error'); } },
      { close: () => { calls.push("close-popout"); now++; } },
    ] },
    tray: { isDestroyed: () => false, destroy: () => { calls.push("remove-tray"); if (prefixFailure === 'tray') throw Error('private-tray-error'); } },
    closeMediaSandbox: () => { calls.push("close-media-sandbox"); now++; if (prefixFailure === 'ui') throw Error('private-ui-error'); },
    clearInterval: () => calls.push("stop-poll"),
    easyTierEnrollment: { shutdown: () => { calls.push("stop-enrollment"); if (prefixFailure === 'enrollment') throw Error('private-enrollment-error'); } },
    easyTierCommunities: { shutdownOwned: () => { calls.push("stop-owned"); if (prefixFailure === 'communities') throw Error('private-communities-error'); } },
    easyTierProduction: { drainOwned: () => { calls.push("drain-native"); return native.promise; } },
    easyTierGrants: { drainOwned: () => { calls.push("drain-grant"); return grant.promise; } },
    communityDns: { stop: () => { calls.push("drain-dns"); return dns.promise; } },
    flushUserStore: () => { calls.push("flush-user"); now += 3; if (syncFailure) throw Error('private-error'); },
    flushGlobalStore: () => { calls.push("flush-global"); now += 5; },
    squadBroker: { stop: () => { calls.push("stop-squad"); if (syncFailure) throw Error('private-error'); } },
    uiohookRunning: true, uiohookLib: {uIOhook: {stop: () => { calls.push("stop-hook"); now += 2; }}},
    localServer: { close: () => calls.push("close-server") },
    presenceSource: { stop: () => { calls.push("stop-presence"); return Promise.resolve(); } },
    cleanupOnQuit: () => calls.push("stop-embedded"),
    localDiagnostics: { record: event => { diagnostics.push(event); if (observerFailure) throw Error('observer-error'); },
      close: () => { calls.push("close-diagnostics"); if (observerFailure) throw Error('observer-error'); } },
    console: { warn: () => calls.push("cleanup-warning"), log: () => {} },
  };
  vm.runInNewContext(code, context);
  const handler = handlers.get('before-quit');
  const event = { preventDefault: () => calls.push("prevent-quit") };
  handler(event);
  assert.ok(calls.includes("close-main"), "main window must close before drains resolve");
  assert.ok(calls.includes("close-popout"), "popouts must close too");
  assert.ok(calls.includes("remove-tray"), "tray must disappear immediately");
  assert.ok(calls.includes("close-media-sandbox"), "upload media sandbox must close before background cleanup");
  assert.ok(calls.includes("stop-poll"), "no fresh polling during retirement");
  assert.ok(calls.includes("stop-enrollment") && calls.includes("stop-owned"), 'each shutdown starts despite another synchronous failure');
  assert.equal(context.tray, null);
  assert.equal(context.firewallStopping, true);
  assert.equal(calls.includes("quit"), false);
  assert.equal(diagnostics.find(e => e.quitStage === 'ui-retire' && e.action === 'finish').elapsedMs, 4);
  assert.equal(diagnostics.filter(e => e.quitStage === 'lifecycle' && e.action === 'start').length, 1);
  handler(event);
  assert.equal(calls.filter(c => c === "drain-native").length, 1, "repeat quit shares cleanup");
  now = 104;
  if (failure) native.reject(new Error("fixture cleanup failure")); else native.resolve();
  await flush();
  assert.equal(calls.includes("quit"), false, "even a failed drain cannot abandon the other drain");
  assert.equal(calls.includes("cleanup-firewall"), false, "rule cleanup waits for both drains");
  now = 204; grant.resolve(); await flush();
  assert.equal(calls.includes("quit"), false, "DNS ownership cleanup also finishes before process exit");
  now = 404;
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
  assert.equal(diagnostics.filter(e => e.quitStage === 'lifecycle' && e.action === 'finish').length, 0,
    'the drain is not the end of will-quit/store cleanup');
  handlers.get('will-quit')();
  assert.ok(calls.indexOf('flush-user') < calls.indexOf('flush-global'));
  assert.ok(calls.indexOf('stop-embedded') < calls.indexOf('close-diagnostics'));
  assert.ok(calls.includes('stop-hook'), 'a throwing optional subsystem must not skip later cleanup');
  assert.equal(calls.at(-1), 'close-diagnostics', 'writer closes after final lifecycle record and synchronous cleanup');
  const finish = stage => diagnostics.find(e => e.quitStage === stage && e.action === 'finish');
  assert.equal(finish('owned-core').elapsedMs, 100);
  assert.equal(finish('grant-revoke').elapsedMs, 200);
  assert.equal(finish('dns-stop').elapsedMs, 400);
  assert.equal(finish('user-store-flush').elapsedMs, 3);
  assert.equal(finish('global-store-flush').elapsedMs, 5);
  assert.equal(finish('lifecycle').elapsedMs, now);
  assert.equal(finish('lifecycle').code, failure || dnsFailure || syncFailure || prefixFailure ? 'cleanup-failed' : 'ok');
  assert.equal(JSON.stringify(diagnostics).includes('private-error'), false);
  assert.ok(diagnostics.filter(e => e.quitStage).every(e => e.elapsedMs >= 0 && e.elapsedMs <= 3_600_000));
}
await scenario(false);
await scenario(true);
await scenario(false, true);
await scenario(true, true);
await scenario(false, true, true);
await scenario(false, false, false, true);
await scenario(false, false, false, false, true);
await scenario(true,false,false,false,true);
for (const failure of ['ui','tray','window','enrollment','communities']) await scenario(false,false,false,false,false,failure);
// Execute the actual tray callbacks as well, independently of Electron/menu creation.
const trayClicks = [...main.matchAll(/click: \(\) => \{\s*(?:cleanupFirewallOnQuit = true;\s*)?recordQuitStage\("tray-click", "send"\);\s*isQuitting = true;\s*app\.quit\(\);\s*\}/g)];
assert.equal(trayClicks.length, 2, 'normal and explicit rule-cleanup tray exits both record a request');
for (const match of trayClicks) {
  const calls = [], context = {cleanupFirewallOnQuit:false,isQuitting:false,
    recordQuitStage: (...args) => calls.push(args), app:{quit:()=>calls.push('quit')}};
  const callback = vm.runInNewContext('(' + match[0].slice('click: '.length) + ')', context);
  callback(); assert.equal(context.isQuitting,true); assert.deepEqual(calls[0],['tray-click','send']); assert.equal(calls[1],'quit');
}
// The production recorder never sends invalid/overflow duration values to the schema.
const helperCode = ts.transpileModule(main.slice(start, main.indexOf('app.on("before-quit"', start)), {
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText;
for (const [now,started,expected] of [[4_000_000,0,3_600_000],[-20,0,0],[Infinity,0,0],[NaN,0,0]]) {
  const records=[], context={performance:{now:()=>now},localDiagnostics:{record:event=>records.push(event)}};
  vm.runInNewContext(helperCode + ';recordQuitStage("lifecycle","finish",' + started + ');',context);
  assert.equal(records[0].elapsedMs,expected);
}
console.log("PASS production quit lifecycle: immediate UI retirement, monotonic stage timing, all drains settle, failure-safe final cleanup, writer closes last, safe tray requests");
