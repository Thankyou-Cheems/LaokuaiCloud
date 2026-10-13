// Offline regression for the telemetry clock handoff. No ET, SDK, DOM,
// sockets, native helper or network is involved.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = path => {
  const source = fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const result = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } });
  const exports = {};
  vm.runInNewContext(result.outputText, { exports, Map, Set, Date });
  return exports;
};

const reader = compile("src/lib/memberLanStatus.ts");
const hooks = {};
let clock = 1000;
let stateSlot = 0;
let stateInitialized = false;
let effectDependencies;
let effectCleanup;
let nextTimerId = 1;
const timers = new Map();
const react = {
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  useState: initial => {
    if (!stateInitialized) {
      stateSlot = typeof initial === "function" ? initial() : initial;
      stateInitialized = true;
    }
    return [stateSlot, value => {
      stateSlot = typeof value === "function" ? value(stateSlot) : value;
    }];
  },
  useEffect: (effect, dependencies) => {
    const changed = !effectDependencies || dependencies.some((value, index) => value !== effectDependencies[index]);
    if (!changed) return;
    effectCleanup?.();
    effectDependencies = dependencies;
    effectCleanup = effect();
  },
};
const hookSource = fs.readFileSync(new URL("../src/lib/communityLanState.ts", import.meta.url), "utf8");
const hookCode = ts.transpileModule(hookSource, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
vm.runInNewContext(hookCode, {
  exports: hooks, Map, Set,
  Date: { now: () => clock },
  setInterval: callback => {
    const id = nextTimerId++;
    timers.set(id, callback);
    return id;
  },
  clearInterval: id => timers.delete(id),
  require: name => { assert.equal(name, "react"); return react; },
});

const makeSnapshot = observedAtMs => {
  const binding = (user, peer) => ({ authenticatedUserId: user, peerId: peer,
    confidence: "verified", source: "authenticated-community", observedAtMs });
  return {
    schemaVersion: 1, serverScope: "server-a", communityId: "community-a",
    source: "authenticated-community", observedAtMs,
    observer: binding("local", "peer-local"),
    members: [
      { binding: binding("local", "peer-local"), enrollment: { state: "joined", source: "authenticated-community", observedAtMs } },
      { binding: binding("remote", "peer-remote"), enrollment: { state: "joined", source: "authenticated-community", observedAtMs } },
    ],
  };
};
const read = (snapshot, nowMs) => reader.readMemberLanStatus({ serverScope: "server-a", authenticatedUserId: "remote",
  observerAuthenticatedUserId: "local", snapshot, nowMs });
const publish = (generation, snapshot) => hooks.publishCommunityLanState({ serverId: "server-a", generation,
  phase: "connected", reason: null, virtualIp: "10.203.217.3", lanSnapshot: snapshot });
const render = () => hooks.useEasyTierMemberSnapshot("server-a");

assert.equal(render().snapshot, undefined);

clock = 1_001;
const firstSnapshot = makeSnapshot(clock);
publish(1, firstSnapshot);
const firstRender = render();
assert.equal(firstRender.nowMs, clock, "the first render reads the current local clock");
assert.equal(read(firstSnapshot, firstRender.nowMs).enrollment, "joined", "fresh telemetry is joined immediately");
assert.equal(timers.size, 1, "one timer starts when a snapshot becomes available");

clock = 2_000;
const futureSnapshot = makeSnapshot(clock + 1);
publish(2, futureSnapshot);
const futureRender = render();
assert.equal(read(futureSnapshot, futureRender.nowMs).enrollment, "unknown", "future telemetry remains rejected");
clock = 2_001;
assert.equal(read(futureSnapshot, render().nowMs).enrollment, "joined", "future telemetry joins once local time catches up");

clock = 3_000;
const continuousSnapshot = makeSnapshot(clock);
publish(3, continuousSnapshot);
assert.equal(read(continuousSnapshot, render().nowMs).enrollment, "joined", "a continuous fresh sample remains joined");
assert.equal(timers.size, 1, "continuous samples do not recreate the expiry timer");
assert.equal(nextTimerId, 2, "continuous samples preserve the original timer");

clock = 13_001;
for (const timer of timers.values()) timer();
const expiredRender = render();
assert.equal(expiredRender.nowMs, clock, "the timer triggers a render without supplying its own timestamp");
assert.equal(read(continuousSnapshot, expiredRender.nowMs).enrollment, "stale", "stopped telemetry still expires");
effectCleanup?.();
assert.equal(timers.size, 0, "cleanup removes the expiry timer");
console.log("PASS fresh telemetry reads the local clock immediately, rejects future samples and expires stopped samples");
