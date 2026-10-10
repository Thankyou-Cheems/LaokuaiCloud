import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function compile(path, dependencies, extra = {}) {
  const code = ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; vm.runInNewContext(code, { exports, Buffer, process: { platform: "win32" }, require: key => {
    if (!(key in dependencies)) throw new Error(`Unmocked ${key}`); return dependencies[key];
  }, ...extra }); return exports;
}
const mode = compile(new URL("../src/lib/squadMode.ts", import.meta.url), {});
let time = 1000, tick, launchCount = 0, scope;
const outputs = [];
const brokerModule = compile(new URL("../electron/squadInputBroker.ts", import.meta.url), {
  child_process: { spawn: () => { throw new Error("Real helper forbidden"); } }, fs: { existsSync: () => true }, "../src/lib/squadMode": mode,
}, { Date: { now: () => time }, setInterval: callback => { tick = callback; return 1; }, clearInterval: () => { tick = null; } });
const game = "C:\\Fixture\\SquadGame\\Binaries\\Win64\\SquadGame-Win64-Shipping.exe";
scope = { valid: true, path: game, down: [] };
let child;
const launch = () => {
  launchCount++; child = new EventEmitter(); child.stdout = new EventEmitter();
  child.stdin = { write: command => { assert.equal(command, "sample\n"); child.stdout.emit("data", Buffer.from(JSON.stringify(scope) + "\n")); }, end() {} };
  child.kill = () => {}; return child;
};
const broker = new brokerModule.SquadInputBroker("fixture-helper", state => outputs.push(state), launch);
broker.configure(mode.SQUAD_DEFAULTS, [], true);
assert.equal(broker.read().status, "armed"); assert.equal(launchCount, 1);
broker.edge(66, true); assert.equal(broker.read().status, "suppressed");
time += 50; tick(); assert.equal(broker.read().status, "hangover");
time += 199; tick(); assert.equal(broker.read().suppressed, true);
time += 1; tick(); assert.equal(broker.read().status, "armed");
scope = { ...scope, down: [66,71] }; tick(); assert.equal(broker.read().heldCount, 2);
scope = { ...scope, down: [71] }; tick(); assert.equal(broker.read().heldCount, 1);
broker.unavailable("system-suspended"); assert.equal(broker.read().status, "unavailable"); assert.equal(broker.read().suppressed, true);
scope = { ...scope, down: [] }; broker.configure(mode.SQUAD_DEFAULTS, [], true);
assert.equal(broker.read().status, "hangover"); assert.equal(launchCount, 2);
time += 200; tick(); assert.equal(broker.read().status, "armed");
broker.configure(mode.SQUAD_DEFAULTS, ["Shift+KeyB"], true);
assert.equal(broker.read().reason, "hotkey-conflict"); assert.equal(broker.read().suppressed, true);
broker.configure({ ...mode.SQUAD_DEFAULTS, enabled: false }, ["KeyB"], false);
assert.equal(broker.read().status, "off"); assert.equal(broker.read().suppressed, false);
assert.equal(tick, null);
assert.ok(outputs.length >= 9);
fs.writeFileSync(new URL("../squad-broker-evidence.json", import.meta.url), JSON.stringify({ fakeTransport: true, realSpawnForbidden: true, nativeInputObserved: false, assertions: 18 }, null, 2));
console.log("Squad broker: fake transport short press, reconciliation, suspend/resume, conflict and teardown passed");
