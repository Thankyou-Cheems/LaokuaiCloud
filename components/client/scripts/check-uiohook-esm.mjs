/* eslint-env node */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const main = fs.readFileSync(path.join(root, "electron/main.ts"), "utf8");
const electron = path.join(root, "node_modules/electron/dist/electron.exe");
const anchor = process.argv[2] ? path.resolve(process.argv[2], "dist-electron/main.js") : path.join(root, "dist-electron/main.js");
const loader = stripTypeScriptTypes(main.slice(main.indexOf("let uiohookLib:"), main.indexOf("let domCodeToKeycode:")));
const outputs = [];
function run(fixed) {
  const code = `${fixed ? 'import { createRequire } from "node:module"; const require=createRequire(' + JSON.stringify(pathToFileURL(anchor).href) + ');' : ''}
    const logs=[]; const startupLog=line=>logs.push(line);
    ${loader}
    const lib=loadUiohook();
    console.log(JSON.stringify({fixed:${fixed},electron:process.versions.electron,node:process.versions.node,
      loaded:!!lib,keyB:lib?.UiohookKey.B,startType:typeof lib?.uIOhook.start,stopType:typeof lib?.uIOhook.stop,logs,
      hookStarted:false,keysCaptured:false,mediaOpened:false}));`;
  const child = spawnSync(electron, ["--input-type=module", "-e", code], {
    windowsHide: true, encoding: "utf8", timeout: 20_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, maxBuffer: 1024 * 1024,
  });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  const result = JSON.parse(child.stdout.trim()); outputs.push(result); return result;
}
const before = run(false);
assert.equal(before.loaded, false);
assert.ok(before.logs.includes("uiohook unavailable: require is not defined"));
const after = run(true);
assert.equal(after.electron, "40.6.1");
assert.equal(after.loaded, true, after.logs.join("\n"));
assert.equal(after.startType, "function"); assert.equal(after.stopType, "function"); assert.ok(after.keyB > 0);
assert.ok(main.includes("const require = createRequire(import.meta.url)"));
fs.writeFileSync(path.join(root, process.argv[2] ? "startup-uiohook-packaged.json" : "startup-uiohook-esm.json"), JSON.stringify(outputs, null, 2));
console.log("PASS: actual Electron 40.6.1 ESM before=undefined require; after=native addon loads; no hook started or keys/media captured");
