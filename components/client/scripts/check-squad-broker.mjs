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
// A filtering helper proves that retired keys are still actually requested.
let watched = [], filteringChild;
const retiredBroker = new brokerModule.SquadInputBroker("fixture-helper", state => outputs.push(state), (_helper, args) => {
  watched = args.map(Number); filteringChild = new EventEmitter(); filteringChild.stdout = new EventEmitter();
  filteringChild.stdin = { write() {
    filteringChild.stdout.emit("data", Buffer.from(JSON.stringify({ ...scope, down: scope.down.filter(key=>watched.includes(key)) })+"\n"));
  }, end() {} }; filteringChild.kill=()=>{}; return filteringChild;
});
scope = {valid:true,path:game,down:[66]}; retiredBroker.configure(mode.SQUAD_DEFAULTS,[],true);
retiredBroker.configure({...mode.SQUAD_DEFAULTS,keys:[]},[],true);
assert.ok(watched.includes(66)); assert.equal(retiredBroker.read().suppressed,true);
scope.down=[]; time+=10; tick(); assert.equal(retiredBroker.read().status,"hangover");
time+=200; tick(); assert.equal(retiredBroker.read().status,"unconfigured"); assert.equal(tick,null);
let launchesBefore=launchCount;
retiredBroker.configure({...mode.SQUAD_DEFAULTS,keys:[]},[],false);
assert.equal(retiredBroker.read().status,"unconfigured"); assert.equal(launchCount,launchesBefore);
// Async metadata: configuration changes cannot reopen while an edge awaits reconciliation.
let delayedChild, delayedWatch=[];
const delayedBroker = new brokerModule.SquadInputBroker("fixture-helper", state=>outputs.push(state), (_helper,args)=>{
  delayedWatch=args.map(Number); delayedChild=new EventEmitter(); delayedChild.stdout=new EventEmitter();
  delayedChild.stdin={write(){},end(){}}; delayedChild.kill=()=>{};return delayedChild;
});
delayedBroker.configure(mode.SQUAD_DEFAULTS,[],true);
delayedChild.stdout.emit("data",Buffer.from(JSON.stringify({valid:true,path:game,down:[]})+"\n"));
delayedBroker.edge(66,true); delayedBroker.configure({...mode.SQUAD_DEFAULTS,enabled:false},[],true);
assert.equal(delayedBroker.read().suppressed,true); assert.ok(delayedWatch.includes(66));
delayedChild.stdout.emit("data",Buffer.from(JSON.stringify({valid:true,path:game,down:[66]})+"\n"));
assert.equal(delayedBroker.read().suppressed,true);
delayedBroker.unavailable("device-disconnected"); assert.equal(delayedBroker.read().suppressed,true);
delayedBroker.configure({...mode.SQUAD_DEFAULTS,enabled:false},[],true);
delayedChild.stdout.emit("data",Buffer.from(JSON.stringify({valid:true,path:game,down:[]})+"\n"));
assert.equal(delayedBroker.read().status,"hangover");time+=200;
delayedChild.stdout.emit("data",Buffer.from(JSON.stringify({valid:true,path:game,down:[]})+"\n"));
assert.equal(delayedBroker.read().status,"off");assert.equal(tick,null);
fs.writeFileSync(new URL("../squad-broker-evidence.json", import.meta.url), JSON.stringify({ fakeTransport: true, realSpawnForbidden: true, nativeInputObserved: false, retiredBindingAndDelayedMetadataScenarios: true }, null, 2));
console.log("Squad broker: fake transport short press, retired-key watch set, delayed metadata, empty lists, suspend/resume, conflict and teardown passed");
