/* eslint-env node */
// Actual asset loader, in-memory filesystem ports; never executes a PE or driver.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import ts from "typescript";

const client = new URL("../", import.meta.url);
const bytes = fs.readFileSync(new URL("electron/easyTierWindowsAssets.ts", client), "utf8");
const compiled = ts.transpileModule(bytes, { reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
assert.deepEqual(compiled.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), []);
class OperationError extends Error { constructor(reason) { super(reason); this.reason = reason; } }
const memory = new Map(), writes = [];
const io = { stat: async file => { if (!memory.has(file)) throw Error("absent"); return { size: memory.get(file).length }; },
  readFile: async (file, encoding) => { if (!memory.has(file)) throw Error("absent"); const b = memory.get(file); return encoding ? b.toString(encoding) : b; },
  mkdir: async () => {}, writeFile: async (file, data) => { writes.push(file); memory.set(file, Buffer.from(data)); },
  rename: async (from, to) => { memory.set(to, memory.get(from)); memory.delete(from); } };
const deps = { "node:crypto": crypto, "node:fs/promises": io, "node:path": path,
  fflate: { unzipSync() { throw Error("Official archive fallback forbidden in product test"); } },
  "./easyTierCommunityManager": { EasyTierOperationError: OperationError }, "./easyTierTarget": { EASYTIER_WINDOWS_TARGET: {} } };
const exports = {};
vm.runInNewContext(compiled.outputText, { exports, Buffer, Uint8Array, require: key => { assert.ok(Object.hasOwn(deps, key), key); return deps[key]; } });
const a = exports, profile = JSON.parse(fs.readFileSync(new URL("scripts/easytier-windows-feature-profile.json", client)));
const manifest = { schemaVersion: 2, version: "2.7.0-laokuai", upstreamCommit: "8b7f1f0196edb5b580829ed5f135050fb5853478",
  hostPolicy: "externally-managed", ownedStopProtocol: 1, sourcePatchSha256: profile.sourcePatchSha256,
  sourceCommit: profile.sourceCommit, sourceTree: profile.sourceTree, cargoLockSha256: profile.cargoLockSha256,
  buildProfile: profile.name, buildProfileSha256: a.EASYTIER_LAOKUAI_PROFILE_SHA256,
  noDefaultFeatures: true, target: profile.target, toolchain: profile.toolchain, normalAndDelayImportsVerified: true,
  coreSha256: a.EASYTIER_PRODUCT_FILES["easytier-core.exe"].sha256,
  cliSha256: a.EASYTIER_PRODUCT_FILES["easytier-cli.exe"].sha256, files: structuredClone(a.EASYTIER_PRODUCT_FILES) };
const verified = a.verifiedEasyTierProductManifest(manifest);
assert.match(verified.cacheIdentity, /^[0-9a-f]{64}$/);
assert.notEqual(verified.cacheIdentity, manifest.coreSha256);
let rejected = 0;
for (const change of [{ schemaVersion: 1 }, { sourceCommit: "a".repeat(40) }, { sourceTree: "a".repeat(40) },
  { sourcePatchSha256: "a".repeat(64) }, { cargoLockSha256: "a".repeat(64) }, { buildProfileSha256: "a".repeat(64) },
  { coreSha256: a.EASYTIER_WINDOWS_FILES["easytier-core.exe"] }, { cliSha256: a.EASYTIER_WINDOWS_FILES["easytier-cli.exe"] },
  { cliSha256: "a".repeat(64) }, { noDefaultFeatures: false }, { normalAndDelayImportsVerified: false },
  { hostPolicy: "legacy" }, { ownedStopProtocol: 0 }]) {
  assert.throws(() => a.verifiedEasyTierProductManifest({ ...manifest, ...change }), e => e.reason === "runtime-required"); rejected++;
}
for (const change of [files => { files["Packet.dll"] = { sha256: "a".repeat(64), bytes: 1 }; },
  files => { delete files["easytier-cli.exe"]; }, files => { files["easytier-cli.exe"].bytes++; },
  files => { files["easytier-cli.exe"].sha256 = a.EASYTIER_WINDOWS_FILES["easytier-cli.exe"]; }]) {
  const altered = structuredClone(manifest); change(altered.files);
  assert.throws(() => a.verifiedEasyTierProductManifest(altered), e => e.reason === "runtime-required"); rejected++;
}
const bundle = path.resolve("synthetic-no-profile", "bundle"), cache = path.resolve("synthetic-no-profile", "cache");
await assert.rejects(new a.EasyTierWindowsAssets(() => cache, () => bundle).prepareProductBundled(), e => e.reason === "runtime-required");
assert.equal(writes.length, 0);
const inputIndex = process.argv.indexOf("--frozen-input");
if (inputIndex !== -1) {
  const input = path.resolve(process.argv[inputIndex + 1]);
  for (const name of Object.keys(a.EASYTIER_PRODUCT_FILES)) memory.set(path.join(bundle, name), fs.readFileSync(path.join(input, name)));
  memory.set(path.join(bundle, "laokuai-build.json"), Buffer.from(JSON.stringify(manifest)));
  const loader = new a.EasyTierWindowsAssets(() => cache, () => bundle);
  const first = loader.prepareProductBundled(); assert.equal(loader.prepareProductBundled(), first);
  const directory = await first; assert.equal(path.basename(directory), verified.cacheIdentity); assert.equal(writes.length, 4);
  const expectedCli = memory.get(path.join(bundle, "easytier-cli.exe"));
  assert.equal(a.easyTierSha256(memory.get(path.join(directory, "easytier-cli.exe"))), manifest.cliSha256);
  await loader.prepareProductBundled(); assert.equal(writes.length, 4);
  memory.set(path.join(bundle, "easytier-cli.exe"), Buffer.from("corrupt-bundled-CLI"));
  await assert.rejects(loader.prepareProductBundled(), e => e.reason === "runtime-required"); assert.equal(writes.length, 4);
  memory.set(path.join(bundle, "easytier-cli.exe"), expectedCli);
  memory.set(path.join(directory, "easytier-cli.exe"), Buffer.from("stale-cached-CLI"));
  await loader.prepareProductBundled(); assert.equal(writes.length, 5);
  assert.equal(a.easyTierSha256(memory.get(path.join(directory, "easytier-cli.exe"))), manifest.cliSha256);
  assert.ok(writes.every(p => !p.includes("Packet.dll") && !p.includes("wpcap.dll")));
  console.log("PASS exact four frozen binary bytes, single-flight cache, corrupt bundled CLI rejection and cached CLI repair; in-memory writes only");
}
console.log(`${rejected} invalid schema/source/profile/core/CLI/file-set cases rejected; missing manifest makes zero writes; no runtime/network execution`);
