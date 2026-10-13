/* eslint-env node */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("./windowsAdminStartupGate.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const moduleBox = { exports: {} };
vm.runInNewContext(compiled, {
  module: moduleBox,
  exports: moduleBox.exports,
  require(name) {
    return require(name);
  },
  process,
  Buffer,
  console,
}, { filename: "windowsAdminStartupGate.compiled.cjs" });
const {
  enforceLaokuaiWindowsAdminStartup,
  isExplicitLaokuaiOfflineLaunch,
  verifyLaokuaiBrokerBundle,
  laokuaiAdminRestartRequest,
} = moduleBox.exports;

const restartOptions = {
  packaged: true, executable: "C:\\绿色 目录\\唠蒯云.exe", argv: [], parentPid: 1234,
  promptRestart: () => false,
};

function bundleFixture() {
  const directory = mkdtempSync(join(tmpdir(), "laokuai-admin-gate-"));
  const binary = join(directory, "laokuai-community-broker.exe");
  const receipt = join(directory, "broker-build.json");
  const bytes = Buffer.alloc(2048, 0x42);
  writeFileSync(binary, bytes);
  writeFileSync(receipt, JSON.stringify({
    schemaVersion: 1,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }));
  return { binary, receipt };
}

test("only explicit offline UI/preview arguments bypass the product gate", async () => {
  assert.equal(isExplicitLaokuaiOfflineLaunch([]), false);
  assert.equal(isExplicitLaokuaiOfflineLaunch(["--laokuai-ui-check-dir=C:\\temp\\laokuai-ui-check-a"]), true);
  assert.equal(isExplicitLaokuaiOfflineLaunch(["--laokuai-preview"]), true);
  assert.equal(isExplicitLaokuaiOfflineLaunch(["--laokuai-admin=false"]), false);
});

test("broker receipt and binary hash are checked before token inspection", async () => {
  const f = bundleFixture();
  assert.equal(verifyLaokuaiBrokerBundle(f.binary, f.receipt), true);
  writeFileSync(f.binary, "tampered-broker-payload");
  assert.equal(verifyLaokuaiBrokerBundle(f.binary, f.receipt), false);
});

test("ordinary Windows launch can decline restart and exits without launching another process", async () => {
  const f = bundleFixture();
  const calls = [];
  await assert.rejects(async () => enforceLaokuaiWindowsAdminStartup({
    ...restartOptions,
    platform: "win32", product: true, offlineTest: false,
    brokerExecutable: f.binary, brokerReceipt: f.receipt,
    showError: (...value) => calls.push(["error", ...value]),
    exit: code => { calls.push(["exit", code]); throw new Error("fixture-exit"); },
    promptRestart: () => { calls.push(["prompt"]); return false; },
    execute: (_file, args) => { assert.equal(args[0], "--check"); return "ordinary"; },
  }), /fixture-exit/);
  assert.deepEqual(calls, [
    ["prompt"],
    ["exit", 0],
  ]);
});

test("elevated Windows launch passes the broker token check without starting a second process", async () => {
  const f = bundleFixture();
  const calls = [];
  const result = await enforceLaokuaiWindowsAdminStartup({
    ...restartOptions,
    platform: "win32", product: true, offlineTest: false,
    brokerExecutable: f.binary, brokerReceipt: f.receipt,
    showError: (...value) => calls.push(["error", ...value]),
    exit: code => { calls.push(["exit", code]); throw new Error("unexpected-exit"); },
    execute: (file, args, options) => {
      calls.push(["check", file, args, options]);
      return "approved";
    },
  });
  assert.equal(result, "approved");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "check");
  assert.deepEqual(Array.from(calls[0][2]), ["--check"]);
});

test("hash/check failure exits before any profile or app side effect", async () => {
  const f = bundleFixture();
  const calls = [];
  writeFileSync(f.receipt, JSON.stringify({ schemaVersion: 1, bytes: 1, sha256: "0".repeat(64) }));
  await assert.rejects(async () => enforceLaokuaiWindowsAdminStartup({
    ...restartOptions,
    platform: "win32", product: true, offlineTest: false,
    brokerExecutable: f.binary, brokerReceipt: f.receipt,
    showError: (...value) => calls.push(["error", ...value]),
    exit: code => { calls.push(["exit", code]); throw new Error("fixture-exit"); },
    execute: () => { throw new Error("token check must not run"); },
  }), /fixture-exit/);
  assert.deepEqual(calls, [
    ["error", "唠蒯云无法启动", "无法验证管理员权限，请重新解压完整绿色包后再试。"],
    ["exit", 1],
  ]);
});

test("Linux, upstream and explicit offline product checks are unchanged", async () => {
  const f = bundleFixture();
  const execute = () => { throw new Error("must not run"); };
  for (const options of [
    { platform: "linux", product: true, offlineTest: false },
    { platform: "win32", product: false, offlineTest: false },
    { platform: "win32", product: true, offlineTest: true },
  ]) {
    assert.equal(await enforceLaokuaiWindowsAdminStartup({
      ...restartOptions,
      ...options, brokerExecutable: f.binary, brokerReceipt: f.receipt,
      showError: () => { throw new Error("must not show"); },
      exit: () => { throw new Error("must not exit"); }, execute,
    }), "bypassed");
  }
});

async function restartFixture(output, overrides = {}) {
  const f = bundleFixture();
  const calls = [];
  await assert.rejects(async () => enforceLaokuaiWindowsAdminStartup({
    ...restartOptions, platform: "win32", product: true, offlineTest: false,
    brokerExecutable: f.binary, brokerReceipt: f.receipt,
    promptRestart: () => { calls.push(["prompt"]); return true; },
    showError: (...value) => calls.push(["error", ...value]),
    exit: code => { calls.push(["exit", code]); throw new Error("fixture-exit"); },
    execute: (file, args, options) => {
      calls.push(["execute", file, Array.from(args), options]);
      if (args[0] === "--check") return "ordinary";
      if (output instanceof Error) throw output;
      return output;
    },
    ...overrides,
  }), /fixture-exit/);
  return calls;
}

test("only a user's affirmative choice restarts the same package via its verified broker", async () => {
  const argv = ["--user-data-dir", "D:\\中文 & $ 数据\\", "--cleanup-network-rules", "--inspect", "cmd.exe"];
  const calls = await restartFixture("started", { argv });
  assert.deepEqual(calls.map(call => call[0]), ["execute", "prompt", "execute", "exit"]);
  assert.deepEqual(calls[2][2], ["--restart-app", "1234"]);
  assert.equal(calls[2][3].shell, false);
  assert.equal(calls[2][3].windowsHide, true);
  assert.deepEqual(JSON.parse(calls[2][3].input), { userDataDirectory: "D:\\中文 & $ 数据\\", cleanupNetworkRules: true });
  assert.deepEqual(calls[3], ["exit", 0]);
});

test("UAC cancellation is clear, exits once and never retries", async () => {
  const calls = await restartFixture("cancelled");
  assert.equal(calls.filter(call => call[0] === "prompt").length, 1);
  assert.equal(calls.filter(call => call[0] === "execute").length, 2);
  assert.equal(calls[3][1], "已取消管理员启动");
  assert.deepEqual(calls.at(-1), ["exit", 0]);
});

test("a concurrent administrator restart does not launch or retry another UAC request", async () => {
  const calls = await restartFixture("busy");
  assert.equal(calls[3][1], "管理员启动正在进行");
  assert.deepEqual(calls.at(-1), ["exit", 0]);
  assert.equal(calls.filter(call => call[0] === "execute").length, 2);
});

test("failed or unknown restart receipts fail closed without retries", async () => {
  for (const output of [new Error("failed"), "untrusted-receipt", ""]) {
    const calls = await restartFixture(output);
    assert.equal(calls.filter(call => call[0] === "prompt").length, 1);
    assert.equal(calls[3][1], "唠蒯云无法重新启动");
    assert.deepEqual(calls.at(-1), ["exit", 1]);
  }
});

test("the restarted marker prevents repeated prompts when elevation still fails", async () => {
  const calls = await restartFixture("started", { argv: ["--laokuai-admin-restarted"] });
  assert.deepEqual(calls.map(call => call[0]), ["execute", "error", "exit"]);
  assert.match(calls[1][2], /不会再次请求提权/);
});

test("developer and temporary single-file portable launches cannot restart the wrong executable", async () => {
  for (const overrides of [{ packaged: false }, { executable: "relative.exe" }, { portableDirectory: "D:\\永久包" }]) {
    const calls = await restartFixture("started", overrides);
    assert.deepEqual(calls.map(call => call[0]), ["execute", "error", "exit"]);
  }
  assert.deepEqual((await restartFixture("started", { portableDirectory: "c:\\绿色 目录" })).at(-1), ["exit", 0]);
});

test("profile arguments cannot turn into injected elevated arguments", async () => {
  for (const argv of [["--user-data-dir=relative"], ["--user-data-dir=C:\\x\" --inspect"],
    ["--user-data-dir=C:\\x", "--user-data-dir=D:\\y"], ["--user-data-dir"], ["--user-data-dir=C:\\x\n"]]) {
    assert.throws(() => laokuaiAdminRestartRequest(argv), /invalid-admin-restart-profile/);
    const calls = await restartFixture("started", { argv });
    assert.equal(calls.filter(call => call[0] === "execute").length, 1);
  }
});

test("main offers two explicit choices with exit as the default and does not own a lock at restart", async () => {
  const main = readFileSync(new URL("./bootstrap.ts", import.meta.url), "utf8");
  assert.match(main, /buttons: \["以管理员身份重新启动", "退出"\]/);
  assert.match(main, /defaultId: 1,\s*cancelId: 1/);
  assert.ok(main.indexOf("promptRestart:") < main.indexOf('await import("./main")'));
  assert.doesNotMatch(main, /requestSingleInstanceLock/);
  const helper = readFileSync(new URL("../native/community-lan-broker/Program.cs", import.meta.url), "utf8");
  const restart = helper.slice(helper.indexOf("static int RestartApp("), helper.indexOf("static void AppRestartSelfTest("));
  assert.match(restart, /ParentProcessId/);
  assert.match(restart, /parent\.MainModule\.FileName/);
  assert.match(restart, /mutex\.WaitOne\(0\)/);
  assert.match(restart, /UseShellExecute = true, Verb = "runas"/);
  assert.doesNotMatch(restart, /powershell|cmd\.exe|Kill\(/i);
});

test("main wires the gate before profile, diagnostics, store and window startup", async () => {
  const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
  const bootstrap = readFileSync(new URL("./bootstrap.ts", import.meta.url), "utf8");
  const gate = bootstrap.indexOf("enforceLaokuaiWindowsAdminStartup({");
  assert.ok(gate >= 0, "entry no longer invokes the startup gate");
  assert.match(bootstrap, /if \(typeof startup === "string"\)\s*\{\s*await import\("\.\/main"\)/);
  assert.doesNotMatch(bootstrap, /await enforceLaokuaiWindowsAdminStartup/);
  for (const sideEffect of [
    "isolateI18nTestData();",
    "new LocalDiagnosticWriter(",
    "app.getPath(\"userData\")",
    "app.requestSingleInstanceLock()",
    "function createMainWindow(",
  ]) {
    assert.ok(main.includes(sideEffect) && !bootstrap.includes(sideEffect), `${sideEffect} must remain in the gated runtime module`);
  }
  assert.match(main, /isExplicitLaokuaiOfflineLaunch\(process\.argv\)/);
  assert.doesNotMatch(bootstrap.slice(0, gate), /process\.env\.[A-Z_]+.*offline|ADMIN_BYPASS/i);
});

test("ordinary main entry waits for Electron readiness before the restart dialog and any profile work", async () => {
  const main = readFileSync(new URL("./bootstrap.ts", import.meta.url), "utf8");
  const block = ts.transpileModule(main.slice(main.indexOf("let startup:")), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace('await import("./main")', 'profileWork()');
  const f = bundleFixture();
  const calls = [];
  let ready = false;
  let releaseReady;
  const readiness = new Promise(resolve => { releaseReady = () => { ready = true; resolve(); }; });
  const entry = vm.runInNewContext(`(async () => { ${block} })()`, {
    IS_LAOKUAI: true, EXPLICIT_OFFLINE_TEST: false, join, __dirname: "C:\\app",
    app: { isPackaged: true, whenReady: () => readiness },
    process: { platform: "win32", resourcesPath: "C:\\app\\resources", execPath: "C:\\app\\唠蒯云.exe", argv: [], pid: 1234, env: {},
      exit: code => { calls.push(["exit", code]); throw new Error("fixture-exit"); } },
    dialog: {
      showMessageBoxSync: () => { calls.push(["prompt", ready]); if (!ready) throw new Error("dialog module can only be used after app is ready"); return 1; },
      showErrorBox: () => { throw new Error("unexpected-error-box"); },
    },
    enforceLaokuaiWindowsAdminStartup: options => {
      const pending = enforceLaokuaiWindowsAdminStartup({ ...options,
        brokerExecutable: f.binary, brokerReceipt: f.receipt,
        execute: () => { calls.push(["check"]); return "ordinary"; },
      });
      // A real process.exit terminates execution; the fixture exception models
      // that termination without feeding it to the entry's unexpected-error UI.
      return pending.catch(error => { if (error.message === "fixture-exit") return new Promise(() => {}); throw error; });
    },
    profileWork: () => { calls.push(["profile"]); },
  });
  await entry; // Must settle BEFORE ready, or Electron's ESM loader deadlocks.
  assert.deepEqual(calls, [["check"]], "ordinary startup must stop before the dialog/profile while Electron is not ready");
  releaseReady();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [["check"], ["prompt", true], ["exit", 0]]);
});

console.log("windows admin startup gate: ok");
