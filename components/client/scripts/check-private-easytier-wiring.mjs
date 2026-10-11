/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

import ts from "typescript";

const require = createRequire(import.meta.url);
const config = require("../electron-builder.laokuai.cjs");
const source = fs.readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8");
const argument = source.match(/new EasyTierCommunityManager\(([^,]+), state =>/)[1];
const runtime = {};
const select = (metadata, uiAcceptanceMode = false) => vm.runInNewContext(argument, {
  UI_ACCEPTANCE_MODE: uiAcceptanceMode,
  IS_I18N_TEST: metadata.grytI18nTest === true,
  IS_LAOKUAI: metadata.grytLaokuai === true,
  easyTierProduction: { runtime },
});
assert.equal(select(config.extraMetadata), runtime, "Actual private package metadata must inject production ports");
assert.equal(select({ grytI18nTest: true }), null, "Isolated i18n package must keep null runtime");
assert.equal(select({}), runtime, "Ordinary desktop must inject production ports");
assert.equal(select(config.extraMetadata, true), null, "UI acceptance mode must keep native runtime unavailable");
const exports = {};
const pins = ts.transpileModule(fs.readFileSync(new URL("../electron/easyTierWindowsAssets.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(pins, { exports, Object, require: () => ({}) });
const expectedNames = Object.keys(exports.EASYTIER_PRODUCT_FILES).sort();
assert.deepEqual(config.win.extraResources.map(entry => entry.to.split("/").at(-1)).sort(), [...expectedNames, "laokuai-build.json"].sort());
for (const entry of config.win.extraResources) {
  assert.equal(entry.from, "build/" + entry.to);
  assert.ok(entry.to.startsWith("community-lan/product/2.7.0-laokuai/"));
  assert.equal(entry.filter, undefined, "Copy exact pinned paths, with no glob expansion");
}
assert.equal(config.win.requestedExecutionLevel, "asInvoker");
assert.equal(config.publish, null);
// Exercise the actual hook/store with deterministic React and timer ports.
const hooks = {};
let observedState, clock = 1000, tick, cleaned = false;
const snapshot = { serverScope: "server-a", observedAtMs: 1000 };
const hookCode = ts.transpileModule(fs.readFileSync(new URL("../src/lib/communityLanState.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(hookCode, { exports: hooks, Map, Set, Date: { now: () => clock },
  setInterval: callback => { tick = callback; return 1; }, clearInterval: () => { cleaned = true; },
  require: key => { assert.equal(key, "react"); return {
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    useState: initial => [initial(), value => { observedState = value; }],
    useEffect: effect => { hooks.cleanup = effect(); },
  }; },
});
assert.equal(hooks.useEasyTierMemberSnapshot("server-a").snapshot, undefined);
assert.equal(tick, undefined, "No timer without telemetry");
hooks.publishCommunityLanState({ serverId: "server-a", generation: 2, lanSnapshot: snapshot });
hooks.publishCommunityLanState({ serverId: "server-a", generation: 1, lanSnapshot: null });
assert.equal(hooks.useEasyTierMemberSnapshot("server-a").snapshot, snapshot, "Older generation cannot replace evidence");
clock = 12001; tick();
assert.equal(observedState, clock, "Clock advances past TTL without new telemetry");
hooks.cleanup(); assert.equal(cleaned, true);
assert.equal(hooks.useEasyTierMemberSnapshot("server-b").snapshot, undefined, "No cross-community snapshot");
console.log("Private metadata/runtime, exact four-file product resources and permission/update isolation passed; no native execution");
