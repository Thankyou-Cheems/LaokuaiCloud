/* eslint-env node */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
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
} = moduleBox.exports;

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

test("only explicit offline UI/preview arguments bypass the product gate", () => {
  assert.equal(isExplicitLaokuaiOfflineLaunch([]), false);
  assert.equal(isExplicitLaokuaiOfflineLaunch(["--laokuai-ui-check-dir=C:\\temp\\laokuai-ui-check-a"]), true);
  assert.equal(isExplicitLaokuaiOfflineLaunch(["--laokuai-preview"]), true);
  assert.equal(isExplicitLaokuaiOfflineLaunch(["--laokuai-admin=false"]), false);
});

test("broker receipt and binary hash are checked before token inspection", () => {
  const f = bundleFixture();
  assert.equal(verifyLaokuaiBrokerBundle(f.binary, f.receipt), true);
  writeFileSync(f.binary, "tampered-broker-payload");
  assert.equal(verifyLaokuaiBrokerBundle(f.binary, f.receipt), false);
});

test("ordinary Windows launch shows only the administrator instruction and exits", () => {
  const f = bundleFixture();
  const calls = [];
  assert.throws(() => enforceLaokuaiWindowsAdminStartup({
    platform: "win32", product: true, offlineTest: false,
    brokerExecutable: f.binary, brokerReceipt: f.receipt,
    showError: (...value) => calls.push(["error", ...value]),
    exit: code => { calls.push(["exit", code]); throw new Error("fixture-exit"); },
    execute: () => "ordinary",
  }), /fixture-exit/);
  assert.deepEqual(calls, [
    ["error", "唠蒯云无法启动", "请右键以管理员身份运行"],
    ["exit", 1],
  ]);
});

test("elevated Windows launch passes the broker token check without starting a second process", () => {
  const f = bundleFixture();
  const calls = [];
  const result = enforceLaokuaiWindowsAdminStartup({
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

test("hash/check failure exits before any profile or app side effect", () => {
  const f = bundleFixture();
  const calls = [];
  writeFileSync(f.receipt, JSON.stringify({ schemaVersion: 1, bytes: 1, sha256: "0".repeat(64) }));
  assert.throws(() => enforceLaokuaiWindowsAdminStartup({
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

test("Linux, upstream and explicit offline product checks are unchanged", () => {
  const f = bundleFixture();
  const execute = () => { throw new Error("must not run"); };
  for (const options of [
    { platform: "linux", product: true, offlineTest: false },
    { platform: "win32", product: false, offlineTest: false },
    { platform: "win32", product: true, offlineTest: true },
  ]) {
    assert.equal(enforceLaokuaiWindowsAdminStartup({
      ...options, brokerExecutable: f.binary, brokerReceipt: f.receipt,
      showError: () => { throw new Error("must not show"); },
      exit: () => { throw new Error("must not exit"); }, execute,
    }), "bypassed");
  }
});

test("main wires the gate before profile, diagnostics, store and window startup", () => {
  const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
  const gate = main.indexOf("enforceLaokuaiWindowsAdminStartup({");
  assert.ok(gate >= 0, "main no longer invokes the startup gate");
  for (const sideEffect of [
    "isolateI18nTestData();",
    "new LocalDiagnosticWriter(",
    "app.getPath(\"userData\")",
    "app.requestSingleInstanceLock()",
    "function createMainWindow(",
  ]) {
    assert.ok(gate < main.indexOf(sideEffect), `${sideEffect} must remain after the admin gate`);
  }
  assert.match(main, /isExplicitLaokuaiOfflineLaunch\(process\.argv\)/);
  assert.doesNotMatch(main.slice(0, gate), /process\.env\.[A-Z_]+.*offline|ADMIN_BYPASS/i);
});

console.log("windows admin startup gate: ok");
