/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { assertPrivatePayloadContract, assertNativeSourceOffer } = require("./check-easytier-patched-payload.cjs");
const provenance = JSON.parse(fs.readFileSync(new URL("../../easytier/provenance.json", import.meta.url), "utf8"));
assert.doesNotThrow(() => assertPrivatePayloadContract(provenance));
const pending = structuredClone(provenance); pending.payload.approved = false;
assert.throws(() => assertPrivatePayloadContract(pending), /official Windows binaries are reference only/);
const fixture = structuredClone(provenance);
fixture.payload = { kind: "private-patched-windows", approved: true, status: "reviewed-hash-verified" };
Object.assign(fixture.patchSet, { sourceCommit: "a".repeat(40), sourceTree: "b".repeat(40), cumulativeSha256: "c".repeat(64), codePatchSha256: "d".repeat(64), patches: [{ sha256: "d".repeat(64) }], review: { status: "accepted", reviewedCommit: "a".repeat(40), reviewedTree: "b".repeat(40) } });
Object.assign(fixture.privateBuild, { status: "verified", sourceCommit: "a".repeat(40), sourceTree: "b".repeat(40), patchSetSha256: "c".repeat(64), licensesAndNoticesVerified: true, runtimeManifestSchemaVersion: 2,normalAndDelayImportsVerified: true,featureProfileSha256: provenance.privateBuild.featureProfileSha256,buildReceiptSha256: "e".repeat(64), buildReceiptPath: "synthetic-never-read.json", packageSha256: "f".repeat(64), packagePath: "synthetic-never-read.zip", runtimeManifestSha256: "9".repeat(64), runtimeManifestPath: "synthetic-never-read-manifest.json", windowsRuntimeFiles: Object.fromEntries(["easytier-core.exe", "easytier-cli.exe", "WinDivert64.sys", "wintun.dll"].map(name => [name, { sha256: "1".repeat(64), bytes: 1 }])) });
assert.doesNotThrow(() => assertPrivatePayloadContract(fixture)); // Synthetic metadata, no file/runtime acceptance.
const stale = structuredClone(fixture); stale.privateBuild.sourceCommit = "2".repeat(40);
assert.throws(() => assertPrivatePayloadContract(stale));
const official = structuredClone(fixture); official.privateBuild.windowsRuntimeFiles["easytier-core.exe"].sha256 = provenance.officialWindowsReference.files["easytier-core.exe"];
assert.throws(() => assertPrivatePayloadContract(official));
const oldCli = structuredClone(fixture);oldCli.privateBuild.windowsRuntimeFiles["easytier-cli.exe"].sha256 = provenance.officialWindowsReference.files["easytier-cli.exe"];
assert.throws(() => assertPrivatePayloadContract(oldCli));
const packet = structuredClone(fixture);packet.privateBuild.windowsRuntimeFiles["Packet.dll"] = {sha256:"1".repeat(64),bytes:1};
assert.throws(() => assertPrivatePayloadContract(packet));
const sourceRepository = "https://github.com/Thankyou-Cheems/LaokuaiCloud", sourceCommit = "a".repeat(40);
const sourceArchive = sourceRepository + "/archive/" + sourceCommit + ".zip";
const offer = {schemaVersion:2,sourceCommit,sourceRepository,sourceArchive,nativeSourceUpdate:{schemaVersion:1,
  nativeSourceCommit:provenance.privateBuild.sourceCommit,nativeSourceTree:provenance.privateBuild.sourceTree,
  sourceTreeScope:"components/easytier/source subtree in monorepo commit",sourceSnapshot:sourceArchive,
  sourceFiles:1263,originalSourceAttachmentsRetained:true,files:["release/source-materials/member-network-20261013/source-update-manifest.json","release/source-materials/apply-native-source-update.cjs","release/source-materials/build-updated-recipient-native.ps1"].map(p=>({path:p,bytes:1,sha256:"a".repeat(64),url:sourceRepository+"/blob/"+sourceCommit+"/"+p}))}};
assert.doesNotThrow(()=>assertNativeSourceOffer(offer,provenance.privateBuild));
for(const change of [value=>{delete value.nativeSourceUpdate;},value=>{value.nativeSourceUpdate.nativeSourceCommit="b".repeat(40);},value=>{value.nativeSourceUpdate.nativeSourceTree="b".repeat(40);},value=>{value.nativeSourceUpdate.files.pop();},value=>{value.nativeSourceUpdate.files[0].url=sourceRepository+"/blob/main/recipe";}]) {
  const altered=structuredClone(offer);change(altered);assert.throws(()=>assertNativeSourceOffer(altered,provenance.privateBuild));
}
console.log("13 ET package-gate scenarios passed; current metadata and synthetic source offers only; no executable, helper, build or profile accessed");
