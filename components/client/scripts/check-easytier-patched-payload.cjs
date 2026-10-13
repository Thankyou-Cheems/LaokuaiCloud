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
  assert.equal(build.featureProfileSha256, "5dbf82a73189da2e3f251d3ff16b80d79ec38e0d84fa7a3785e03f578b873f68", fail);
  for (const value of Object.values(files)) assert.ok(/^[a-f0-9]{64}$/.test(value.sha256 ?? "") && Number.isSafeInteger(value.bytes) && value.bytes > 0, fail);
  assert.notEqual(files["easytier-core.exe"].sha256, provenance.officialWindowsReference.files["easytier-core.exe"], fail);
  assert.notEqual(files["easytier-cli.exe"].sha256, provenance.officialWindowsReference.files["easytier-cli.exe"], fail);
  for (const key of ["buildReceipt", "package", "runtimeManifest"]) assert.ok(/^[a-f0-9]{64}$/.test(build[key + "Sha256"] ?? "") && typeof build[key + "Path"] === "string", fail);
}

function assertNativeSourceOffer(offer, build) {
  if (build.sourceCommit === "089b6182c603c8ab60044b673effe0cf614cc28a") return;
  const update = offer.nativeSourceUpdate;
  assert.equal(offer.schemaVersion, 2, "New native payload needs the supplemental source offer");
  assert.equal(update?.schemaVersion, 1);
  assert.equal(update.nativeSourceCommit, build.sourceCommit);
  assert.equal(update.nativeSourceTree, build.sourceTree);
  assert.equal(update.sourceTreeScope, "components/easytier/source subtree in monorepo commit");
  assert.equal(update.sourceSnapshot, offer.sourceArchive);
  assert.equal(update.sourceFiles, 1263);
  assert.equal(update.originalSourceAttachmentsRetained, true);
  const required = ["release/source-materials/member-network-20261013/source-update-manifest.json", "release/source-materials/apply-native-source-update.cjs", "release/source-materials/build-updated-recipient-native.ps1"];
  assert.deepEqual(update.files.map(file => file.path).sort(), required.sort());
  for (const file of update.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0);
    assert.equal(file.url, offer.sourceRepository + "/blob/" + offer.sourceCommit + "/" + file.path);
  }
}

function assertPatchedEasyTierPayload(root, config) {
  const provenance = JSON.parse(fs.readFileSync(path.resolve(root, "../easytier/provenance.json"), "utf8"));
  assertPrivatePayloadContract(provenance);
  const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
  if (provenance.payload.approvalScope === "user-authorized-friend-beta-with-corresponding-source") {
    const offer = JSON.parse(fs.readFileSync(path.join(root, "build/legal/SOURCE-OFFER.json"), "utf8"));
    assert.equal(offer.version, JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).version);
    assert.match(offer.sourceCommit, /^[a-f0-9]{40}$/);
    assert.equal(offer.publicReleaseApproved, false);
    assertNativeSourceOffer(offer, provenance.privateBuild);
    if (offer.schemaVersion === 2) {
      const repository = "https://github.com/Thankyou-Cheems/LaokuaiCloud";
      assert.equal(offer.publicSourceApproved,true);
      assert.equal(offer.sourceRepository,repository);
      assert.equal(offer.sourceArchive,repository+"/archive/"+offer.sourceCommit+".zip");
      assert.equal(offer.sourcesMustAccompanyBinary,false);
      const sourceAssets=JSON.parse(fs.readFileSync(path.resolve(root,"../../release/source-materials/public-assets.json"),"utf8"));
      assert.deepEqual(offer.files,sourceAssets.files.map(f=>({...f,url:repository+"/releases/download/"+sourceAssets.tag+"/"+f.file})));
      assert.deepEqual(offer.upstreamSources,sourceAssets.upstreamSources);
    } else {
      assert.deepEqual(offer.files.map(f=>f.file).sort(), ["Client-Voice-Server-SFU-Corresponding-Source.zip", "EasyTier-Corresponding-Source.zip", "EasyTier-Build-Tools.zip", "EasyTier-Build-Tools-Fix.zip", "UI-Preferred-Source.zip", "RNNoise-Preferred-Source.zip"].sort());
    }
    for (const file of offer.files) {
      const bytes=fs.readFileSync(path.join(root,"build/recipient-source",file.file));
      assert.equal(bytes.length,file.bytes);assert.equal(digest(bytes),file.sha256);
    }
  }
  const indexBytes = fs.readFileSync(path.resolve(root, "../easytier/" + provenance.patchSet.indexPath));
  assert.equal(digest(indexBytes), provenance.patchSet.cumulativeSha256);
  const index = JSON.parse(indexBytes);
  assert.equal(index.kind, "ordered-code-patch-set-index");
  assert.equal(index.sourceCommit, provenance.privateBuild.sourceCommit);
  assert.equal(index.sourceTree, provenance.privateBuild.sourceTree);
  assert.deepEqual(index.patches.map(patch => patch.order), [1, 2]);
  for (const patch of index.patches) {
    assert.match(patch.path, /^laokuai-[a-z0-9-]+\.patch$/);
    const bytes = fs.readFileSync(path.resolve(root, "../easytier/patches", patch.path));
    assert.equal(bytes.length, patch.bytes); assert.equal(digest(bytes), patch.sha256);
  }
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
  assert.equal(manifest.sourcePatchKind, "ordered-code-patch-set-index");
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
module.exports = { assertPrivatePayloadContract, assertPatchedEasyTierPayload, assertNativeSourceOffer };
