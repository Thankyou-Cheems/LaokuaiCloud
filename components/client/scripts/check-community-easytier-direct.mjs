/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const file = new URL("../electron/easyTierWindowsProduction.ts", import.meta.url);
const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const calls = [];
let allowed = true;
let assetFailure = false;
class DirectProcesses {
  constructor(port, broker) {
    assert.equal(port, 0);
    assert.equal(broker, undefined, "production must not construct the elevation broker");
    calls.push("processes:construct");
  }
  start(directory) { calls.push(`processes:start:${directory}`); return Promise.resolve({}); }
  shutdownOwned() { calls.push("processes:shutdown"); }
  drainOwned() { calls.push("processes:drain"); return Promise.resolve(); }
  cleanupReports() { return []; }
}
class StaticAssets {
  prepareProductBundled() {
    calls.push("assets");
    return assetFailure ? Promise.reject(new Error("runtime-required")) : Promise.resolve("C:\\product");
  }
}
class CapturingRuntime {
  constructor(ports) { this.ports = ports; calls.push("runtime:construct"); }
}
const deps = {
  "node:fs/promises": { mkdir: async () => {}, writeFile: async () => {} },
  "node:path": path,
  "./easyTierExistingConfiguration": { readEasyTierExistingConfiguration: async () => { throw Error("unused"); } },
  "./easyTierWindowsAssets": { EasyTierWindowsAssets: StaticAssets },
  "./easyTierWindowsProcesses": {
    EasyTierWindowsProcesses: DirectProcesses,
    hasEasyTierWindowsPermission: async executable => {
      calls.push(`permission:${executable}`);
      return allowed;
    },
  },
  "./windowsEasyTierCliRuntime": { WindowsEasyTierCliRuntime: CapturingRuntime },
};
const exports = {};
vm.runInNewContext(source, {
  exports,
  process: { platform: "win32", arch: "x64", env: {} },
  require: name => { assert.ok(name in deps, `unexpected production import ${name}`); return deps[name]; },
}, { filename: file.pathname });

const root = () => "C:\\profile";
const product = () => "C:\\resources\\community-lan\\product\\2.7.0-laokuai";
const helper = () => "C:\\resources\\community-lan-helper";
const adapter = exports.createWindowsEasyTierProduction(root, product, undefined, helper);
assert.deepEqual(calls, ["processes:construct", "runtime:construct"]);
assert.equal(adapter.preparationReady(), false);
assert.equal(await adapter.preparePermission(), true);
assert.equal(adapter.preparationReady(), true);
assert.deepEqual(calls.slice(2), [
  "permission:C:\\resources\\community-lan-helper\\laokuai-community-broker.exe",
  "assets",
]);

// A prepared enrollment remains prepared across ordinary renderer reconciles;
// explicit release is the lifecycle boundary that invalidates it.
assert.equal(adapter.preparationReady(), true);
adapter.releasePreparation();
assert.equal(adapter.preparationReady(), false);

allowed = false;
const beforeDenied = calls.length;
assert.equal(await adapter.preparePermission(), false);
assert.equal(adapter.preparationReady(), false);
assert.deepEqual(calls.slice(beforeDenied), [
  "permission:C:\\resources\\community-lan-helper\\laokuai-community-broker.exe",
]);

// A broken/missing packaged asset is a lifecycle error, not a permanent user
// refusal. Enrollment can therefore schedule its bounded recovery path.
allowed = true;
assetFailure = true;
await assert.rejects(adapter.preparePermission(), error => error.message === "runtime-required");
assert.equal(adapter.preparationReady(), false);
assetFailure = false;

// Runtime startup uses the direct child port and never asks for a broker.
assert.equal(await adapter.runtime.ports.permission(), true);
await adapter.runtime.ports.start("C:\\product", { configFile: "C:\\profile\\configs\\owned.toml" }, new AbortController().signal);
assert.ok(calls.includes("processes:start:C:\\product"));
await adapter.drainOwned();
assert.ok(calls.includes("processes:drain"));
console.log(JSON.stringify({ passed: true, directChild: true, elevationBrokerConstructed: false, drainVerified: true }));
