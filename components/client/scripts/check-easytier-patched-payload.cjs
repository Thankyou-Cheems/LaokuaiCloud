/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function assertPrivatePayloadContract(provenance) {
  const fail = "EasyTier private patched payload is pending reviewed source/build hashes; official Windows binaries are reference only";
  const patch = provenance.patchSet, build = provenance.privateBuild;
  assert.ok(provenance.payload?.kind === "private-patched-windows" && provenance.payload.approved && provenance.payload.status === "reviewed-hash-verified", fail);
  assert.equal(patch.baseCommit, "8b7f1f0196edb5b580829ed5f135050fb5853478", fail);
  assert.ok(patch.review.status === "accepted" && /^[a-f0-9]{40}$/.test(patch.sourceCommit ?? "") && /^[a-f0-9]{40}$/.test(patch.sourceTree ?? ""), fail);
  assert.equal(patch.review.reviewedCommit, patch.sourceCommit, fail);
  assert.equal(patch.review.reviewedTree, patch.sourceTree, fail);
  assert.ok(patch.patches.length > 0 && patch.patches.every(p => /^[a-f0-9]{64}$/.test(p.sha256 ?? "")), fail);
  assert.equal(build.status, "verified", fail);
  assert.equal(build.sourceCommit, patch.sourceCommit, fail);
  assert.equal(build.sourceTree, patch.sourceTree, fail);
  assert.ok(/^[a-f0-9]{64}$/.test(patch.cumulativeSha256 ?? ""), fail);
  assert.equal(build.patchSetSha256, patch.cumulativeSha256, fail);
  assert.ok(/^[a-f0-9]{64}$/.test(patch.codePatchSha256 ?? ""), fail);
  assert.ok(build.licensesAndNoticesVerified, fail);
  const files = build.windowsRuntimeFiles;
  assert.deepEqual(Object.keys(files).sort(), ["easytier-core.exe", "easytier-cli.exe", "WinDivert64.sys", "wintun.dll"].sort(), fail);
  assert.equal(build.runtimeManifestSchemaVersion, 2, fail);
  assert.equal(build.normalAndDelayImportsVerified, true, fail);
  assert.equal(build.featureProfileSha256, "8904d6aff6c819a6d3bc03700467c7878199a68c57c9771905b7c90ec8c805d7", fail);
  for (const value of Object.values(files)) assert.ok(/^[a-f0-9]{64}$/.test(value.sha256 ?? "") && Number.isSafeInteger(value.bytes) && value.bytes > 0, fail);
  assert.notEqual(files["easytier-core.exe"].sha256, provenance.officialWindowsReference.files["easytier-core.exe"], fail);
  assert.notEqual(files["easytier-cli.exe"].sha256, provenance.officialWindowsReference.files["easytier-cli.exe"], fail);
  for (const key of ["buildReceipt", "package", "runtimeManifest"]) assert.ok(/^[a-f0-9]{64}$/.test(build[key + "Sha256"] ?? "") && typeof build[key + "Path"] === "string", fail);
}

function assertPatchedEasyTierPayload(root, config) {
  const provenance = JSON.parse(fs.readFileSync(path.resolve(root, "../easytier/provenance.json"), "utf8"));
  assertPrivatePayloadContract(provenance);
  const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
  const readOwned = relative => {
    assert.ok(typeof relative === "string" && !path.isAbsolute(relative));
    const absolute = path.resolve(root, relative);
    assert.ok(absolute.startsWith(path.resolve(root) + path.sep), "ET payload evidence must stay within this client tree");
    return fs.readFileSync(absolute);
  };
  for (const key of ["buildReceipt", "package", "runtimeManifest"]) assert.equal(digest(readOwned(provenance.privateBuild[key + "Path"])), provenance.privateBuild[key + "Sha256"]);
  const resources = config.win.extraResources;
  const runtimeResources = resources.filter(entry => entry.to.split("/").at(-1) !== "laokuai-build.json");
  const manifests = resources.filter(entry => entry.to.split("/").at(-1) === "laokuai-build.json");
  assert.equal(manifests.length, 1);
  assert.equal(manifests[0].from, provenance.privateBuild.runtimeManifestPath);
  const manifest = JSON.parse(readOwned(manifests[0].from));
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.version, "2.7.0-laokuai");
  assert.equal(manifest.upstreamCommit, provenance.upstream.commit);
  assert.equal(manifest.sourcePatchSha256, provenance.patchSet.codePatchSha256);
  assert.equal(manifest.hostPolicy, "externally-managed");
  assert.equal(manifest.ownedStopProtocol, 1);
  assert.equal(manifest.coreSha256, provenance.privateBuild.windowsRuntimeFiles["easytier-core.exe"].sha256);
  assert.equal(manifest.cliSha256, provenance.privateBuild.windowsRuntimeFiles["easytier-cli.exe"].sha256);
  assert.equal(manifest.sourceCommit, provenance.privateBuild.sourceCommit);
  assert.equal(manifest.sourceTree, provenance.privateBuild.sourceTree);
  assert.equal(manifest.cargoLockSha256, provenance.sourceImport.cargoLockSha256);
  assert.equal(manifest.buildProfileSha256, provenance.privateBuild.featureProfileSha256);
  assert.equal(manifest.normalAndDelayImportsVerified, true);
  assert.deepEqual(Object.keys(manifest.files).sort(), Object.keys(provenance.privateBuild.windowsRuntimeFiles).sort());
  for(const [name,expected] of Object.entries(provenance.privateBuild.windowsRuntimeFiles)) {
    assert.equal(manifest.files[name].sha256, expected.sha256); assert.equal(manifest.files[name].bytes, expected.bytes);
  }
  assert.equal(runtimeResources.length, Object.keys(provenance.privateBuild.windowsRuntimeFiles).length);
  for (const entry of runtimeResources) {
    assert.ok(!entry.filter, "ET patched resources must use exact file paths");
    const name = entry.to.split("/").at(-1), expected = provenance.privateBuild.windowsRuntimeFiles[name];
    assert.ok(expected, "Unexpected ET runtime file");
    const bytes = readOwned(entry.from);
    assert.equal(bytes.length, expected.bytes, name);
    assert.equal(digest(bytes), expected.sha256, name);
  }
}
module.exports = { assertPrivatePayloadContract, assertPatchedEasyTierPayload };
