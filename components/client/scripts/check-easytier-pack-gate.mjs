/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { assertPrivatePayloadContract } = require("./check-easytier-patched-payload.cjs");
const provenance = JSON.parse(fs.readFileSync(new URL("../../easytier/provenance.json", import.meta.url), "utf8"));
assert.throws(() => assertPrivatePayloadContract(provenance), /official Windows binaries are reference only/);
const fixture = structuredClone(provenance);
fixture.payload = { kind: "private-patched-windows", approved: true, status: "reviewed-hash-verified" };
Object.assign(fixture.patchSet, { sourceCommit: "a".repeat(40), sourceTree: "b".repeat(40), cumulativeSha256: "c".repeat(64), codePatchSha256: "d".repeat(64), patches: [{ sha256: "d".repeat(64) }], review: { status: "accepted", reviewedCommit: "a".repeat(40), reviewedTree: "b".repeat(40) } });
Object.assign(fixture.privateBuild, { status: "verified", sourceCommit: "a".repeat(40), sourceTree: "b".repeat(40), patchSetSha256: "c".repeat(64), licensesAndNoticesVerified: true, buildReceiptSha256: "e".repeat(64), buildReceiptPath: "synthetic-never-read.json", packageSha256: "f".repeat(64), packagePath: "synthetic-never-read.zip", runtimeManifestSha256: "9".repeat(64), runtimeManifestPath: "synthetic-never-read-manifest.json", windowsRuntimeFiles: Object.fromEntries(Object.keys(provenance.officialWindowsReference.files).map(name => [name, { sha256: "1".repeat(64), bytes: 1 }])) });
assert.doesNotThrow(() => assertPrivatePayloadContract(fixture)); // Synthetic metadata, no file/runtime acceptance.
const stale = structuredClone(fixture); stale.privateBuild.sourceCommit = "2".repeat(40);
assert.throws(() => assertPrivatePayloadContract(stale));
const official = structuredClone(fixture); official.privateBuild.windowsRuntimeFiles["easytier-core.exe"].sha256 = provenance.officialWindowsReference.files["easytier-core.exe"];
assert.throws(() => assertPrivatePayloadContract(official));
const config = require("../electron-builder.laokuai.cjs");
const original = config.beforeBuild;
let buildEntered = false;
config.beforeBuild = async () => { buildEntered = true; throw Error("No build in pure checks"); };
try { await assert.rejects(config.beforePack(), /official Windows binaries are reference only/); }
finally { config.beforeBuild = original; }
assert.equal(buildEntered, false, "Pending patched payload blocks packaging before any build/native preparation");
console.log("5 ET package-gate scenarios passed; synthetic metadata only; no executable, helper, build or profile accessed");
