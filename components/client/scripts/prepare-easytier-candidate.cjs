/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
// Source/PE bytes only. Creates a fresh candidate stage; never starts native files.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { inspectPeImports } = require("./inspect-pe-imports.cjs");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const SOURCE_PREFIX = "components/easytier/source/";
const FEATURES = ["cli", "wireguard", "websocket", "smoltcp", "tun", "socks5", "kcp", "quic", "magic-dns", "zstd", "upnp", "icmp-proxy", "management", "endpoint-discovery", "extended-services", "linux-netlink", "tcp-hole-punch"];
const COMPANIONS = {
  "WinDivert64.sys": {bytes: 94144, sha256: "8da085332782708d8767bcace5327a6ec7283c17cfb85e40b03cd2323a90ddc2"},
  "wintun.dll": {bytes: 427552, sha256: "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce"},
};

function safeRelative(value) {
  assert.ok(typeof value === "string" && value.length && !value.includes("\\") && !value.includes("\0") && !path.isAbsolute(value));
  assert.ok(value.split("/").every(part => part && part !== "." && part !== ".."), "Unsafe source path");
  return value;
}
function walk(directory, prefix = "") {
  const result = [];
  for (const item of fs.readdirSync(directory, {withFileTypes: true})) {
    const relative = safeRelative(prefix + item.name), file = path.join(directory, item.name);
    assert.ok(!fs.lstatSync(file).isSymbolicLink(), "Candidate symlink/reparse input rejected");
    if (item.isDirectory()) result.push(...walk(file, relative + "/"));
    else { assert.ok(item.isFile(), "Candidate input must be a regular file"); result.push(relative); }
  }
  return result.sort();
}
function git(repo, args, options = {}) {
  return execFileSync("git", args, {cwd: repo, windowsHide: true, maxBuffer: 128 * 1024 * 1024, ...options});
}
function exactCommit(repo, commit) {
  assert.match(commit, /^[a-f0-9]{40}$/, "Supply a full immutable source commit");
  assert.equal(git(repo, ["rev-parse", "--verify", commit + "^{commit}"], {encoding: "utf8"}).trim(), commit);
  return commit;
}
function committedSource(repo, commit) {
  exactCommit(repo, commit);
  const entries = git(repo, ["ls-tree", "-r", "-z", "--full-tree", commit, "--", SOURCE_PREFIX]).toString("utf8").split("\0").filter(Boolean).map(value => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(value);
    assert.ok(match && match[3].startsWith(SOURCE_PREFIX), "Native source must contain regular Git blobs only");
    return {path: safeRelative(match[3].slice(SOURCE_PREFIX.length)), blob: match[2]};
  });
  assert.ok(entries.length, "Native subtree is absent from source commit");
  const objects = git(repo, ["cat-file", "--batch"], {input: entries.map(entry => entry.blob + "\n").join("")});
  const files = new Map(); let at = 0;
  for (const entry of entries) {
    const end = objects.indexOf(10, at); assert.ok(end >= at);
    const header = objects.toString("ascii", at, end).split(" ");
    assert.equal(header[0], entry.blob); assert.equal(header[1], "blob");
    const size = Number(header[2]); assert.ok(Number.isSafeInteger(size) && size >= 0 && end + 1 + size < objects.length);
    const bytes = objects.subarray(end + 1, end + 1 + size); assert.equal(objects[end + 1 + size], 10);
    files.set(entry.path, {bytes, blob: entry.blob}); at = end + 2 + size;
  }
  assert.equal(at, objects.length);
  const sourceTree = git(repo, ["rev-parse", commit + ":components/easytier/source"], {encoding: "utf8"}).trim();
  assert.match(sourceTree, /^[a-f0-9]{40}$/);
  return {files, sourceTree};
}
function verifyFrozenSource(directory, committed) {
  const names = walk(directory);
  assert.deepEqual(names, [...committed.files.keys()].sort(), "Frozen source file set differs from the commit (including new/untracked files)");
  const inventory = names.map(relative => {
    const bytes = fs.readFileSync(path.join(directory, relative)), expected = committed.files.get(relative);
    let lineEndingNormalization = "none";
    if (!bytes.equals(expected.bytes)) {
      // Windows checkout CRLF is permitted only when replacing CRLF with LF
      // produces the exact committed bytes, with no binary or other drift.
      assert.ok(!bytes.includes(0), "Binary source differs from committed blob: " + relative);
      const normalized = Buffer.from(bytes.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
      assert.ok(normalized.equals(expected.bytes), "Frozen source differs from committed blob: " + relative);
      lineEndingNormalization = "crlf-to-lf";
    }
    return {path: relative, bytes: bytes.length, sha256: sha(bytes), gitBlob: expected.blob,
      gitBlobBytes: expected.bytes.length, gitBlobSha256: sha(expected.bytes), lineEndingNormalization};
  });
  const canonical = inventory.map(file => `${file.path}\t${file.bytes}\t${file.sha256}\n`).join("");
  return {files: inventory, sourceFileSetSha256: sha(Buffer.from(canonical)),
    normalizedLineEndingFiles: inventory.filter(file => file.lineEndingNormalization !== "none").length};
}
function describeFile(file) {
  assert.ok(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink());
  const bytes = fs.readFileSync(file); return {bytes: bytes.length, sha256: sha(bytes)};
}
function verifyProducerReceipt(producer, {source, lock, runtime}) {
  assert.equal(producer.schemaVersion, 2); assert.equal(producer.action, "Build"); assert.equal(producer.exitCode, 0);
  assert.equal(producer.coreExecuted, false); assert.equal(producer.cliExecuted, false);
  assert.equal(producer.toolchain, "1.95.0"); assert.equal(producer.target, "x86_64-pc-windows-msvc");
  assert.deepEqual(producer.features, FEATURES); assert.equal(producer.noDefaultFeatures, true);
  assert.equal(producer.rustflags, "-C target-feature=+crt-static"); assert.equal(producer.releaseProfileUnchanged, true);
  assert.equal(producer.sourceInventorySha256, source.sourceFileSetSha256);
  assert.equal(producer.cargoLockRawSha256, lock.sha256); assert.equal(producer.baselineCargoLockGitContentSha256, lock.gitBlobSha256);
  assert.ok(Array.isArray(producer.command) && producer.command.includes("--release") && producer.command.includes("--locked") && producer.command.includes("--offline"));
  assert.ok(Array.isArray(producer.artifacts) && producer.artifacts.length === 2);
  assert.deepEqual(producer.artifacts.map(file => file.path).sort(), ["easytier-cli.exe", "easytier-core.exe"]);
  for (const file of producer.artifacts) assert.deepEqual({bytes: file.bytes, sha256: file.sha256}, runtime[file.path], "Producer artifact bytes differ");
  return true;
}
function sourceUpdateManifest(repo, sourceCommit, committed) {
  const baselinePath = path.join(repo, "release/source-materials/modern-recipient/screened-native-source.json");
  const baselineBytes = fs.readFileSync(baselinePath), baseline = JSON.parse(baselineBytes);
  assert.equal(baseline.schema, 1); assert.equal(baseline.retainedSourceFiles, 1262); assert.equal(baseline.excluded.length, 15);
  const old = new Map(baseline.retained.map(file => [safeRelative(file.path), file]));
  const excluded = new Set(baseline.excluded.map(file => safeRelative(file.path)));
  const files = [...committed.files].filter(([name]) => !excluded.has(name)).map(([name, file]) => {
    assert.ok(!/\bpacket\.(?:dll|lib)$/i.test(name), "Historical Packet distribution rejected");
    const before = old.get(name);
    return {path: name, bytes: file.bytes.length, sha256: sha(file.bytes), gitBlob: file.blob,
      baselineBytes: before?.bytes ?? null, baselineSha256: before?.sha256 ?? null};
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const currentNames = new Set(files.map(file => file.path));
  const removed = baseline.retained.filter(file => !currentNames.has(file.path));
  const assets = JSON.parse(fs.readFileSync(path.join(repo, "release/source-materials/public-assets.json")));
  const sourceArchive = assets.files.find(file => file.file === "EasyTier-Corresponding-Source.zip"); assert.ok(sourceArchive);
  return {schemaVersion: 1, sourceCommit, sourceTree: committed.sourceTree, sourceTreeScope: "components/easytier/source subtree in monorepo commit",
    baselineSourceCommit: baseline.sourceCommit, baselineInventorySha256: sha(Buffer.from(baselineBytes.toString("latin1").replace(/\r\n/g, "\n"), "latin1")),
    baselineInventoryEncoding: "utf8-crlf-to-lf", baselineSourceArchive: sourceArchive,
    files, removed, excluded: baseline.excluded.map(file => file.path),
    changedPaths: files.filter(file => file.bytes !== file.baselineBytes || file.sha256 !== file.baselineSha256).map(file => file.path),
    sourceFiles: files.length, unchangedDependencies: true, compilerExecuted: false, nativeRuntimeAccepted: false};
}
function prepareSourceUpdate({repo, sourceCommit, frozenSource}) {
  repo = fs.realpathSync(repo); frozenSource = fs.realpathSync(frozenSource);
  const committed = committedSource(repo, sourceCommit), verified = verifyFrozenSource(frozenSource, committed);
  const manifest = sourceUpdateManifest(repo, sourceCommit, committed);
  const directory = path.join(repo, "release/source-materials/member-network-20261013"), file = path.join(directory, "source-update-manifest.json");
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  if (fs.existsSync(file)) assert.ok(fs.readFileSync(file).equals(bytes), "Preserve a previous source update manifest; never replace its commit silently");
  else { fs.mkdirSync(directory, {recursive: true}); fs.writeFileSync(file, bytes, {flag: "wx"}); }
  return {sourceCommit, sourceTree: committed.sourceTree, frozenSourceFiles: verified.files.length, sourceFileSetSha256: verified.sourceFileSetSha256,
    normalizedLineEndingFiles: verified.normalizedLineEndingFiles, preferredSourceFiles: manifest.sourceFiles, changedPaths: manifest.changedPaths.length,
    manifestSha256: sha(bytes), coreExecuted: false, cliExecuted: false};
}
function preparePatchSet({repo, sourceCommit, baselineCommit, frozenSource}) {
  repo = fs.realpathSync(repo);
  const committed = committedSource(repo, sourceCommit); verifyFrozenSource(fs.realpathSync(frozenSource), committed); exactCommit(repo, baselineCommit);
  const directory = path.join(repo, "components/easytier/patches"), originalName = "laokuai-modern-static-cumulative-code.patch", deltaName = "laokuai-member-network-20261013.patch", indexName = "laokuai-member-network-20261013.patch-set.json";
  const original = fs.readFileSync(path.join(directory, originalName));
  assert.equal(sha(original), "490ffd127cc7c6a9d0d622ff161fe2086536e59be8b8281cf87e2f00e314aed5");
  const delta = git(repo, ["diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--relative=components/easytier/source", baselineCommit, sourceCommit, "--", SOURCE_PREFIX]);
  assert.ok(delta.length > 0 && !original.includes(Buffer.from("GIT binary patch")) && !delta.includes(Buffer.from("GIT binary patch")), "Only code/text patches may enter this public set");
  assert.ok(!delta.includes(Buffer.from("Packet.dll")) && !delta.includes(Buffer.from("Packet.lib")), "Historical Packet binary paths excluded");
  const index = {schemaVersion: 1, kind: "ordered-code-patch-set-index", upstreamCommit: "8b7f1f0196edb5b580829ed5f135050fb5853478",
    baselineNativeSourceCommit: "089b6182c603c8ab60044b673effe0cf614cc28a", baselineMonorepoCommit: baselineCommit,
    sourceCommit, sourceTree: committed.sourceTree, sourceTreeScope: "components/easytier/source subtree in monorepo commit",
    patches: [{order: 1, path: originalName, bytes: original.length, sha256: sha(original)}, {order: 2, path: deltaName, bytes: delta.length, sha256: sha(delta)}],
    application: "Apply patch 1 then patch 2 as separate operations; this index hash is not a single git-apply patch hash",
    preferredSourceUpdateManifest: "release/source-materials/member-network-20261013/source-update-manifest.json",
    prebuiltBinaryAssetsIncluded: false, compilerExecuted: false, nativeRuntimeAccepted: false};
  const bytes = Buffer.from(JSON.stringify(index, null, 2) + "\n");
  for (const [name, contents] of [[deltaName, delta], [indexName, bytes]]) {
    const file = path.join(directory, name);
    if (fs.existsSync(file)) assert.ok(fs.readFileSync(file).equals(contents), "Preserve prior ordered patch-set evidence");
    else fs.writeFileSync(file, contents, {flag: "wx"});
  }
  return {sourceCommit, sourceTree: committed.sourceTree, patchSetKind: index.kind, patchSetPath: "patches/" + indexName,
    patchSetSha256: sha(bytes), deltaSha256: sha(delta), deltaBytes: delta.length, nativeRuntimeAccepted: false};
}
function prepareCandidate({repo, sourceCommit, baselineCommit, frozenSource, candidateOutput, producerReceipt, stageDirectory}) {
  repo = fs.realpathSync(repo); frozenSource = fs.realpathSync(frozenSource); candidateOutput = fs.realpathSync(candidateOutput);
  stageDirectory = path.resolve(stageDirectory); assert.ok(!fs.existsSync(stageDirectory), "Preserve previous candidate stage; choose a new directory");
  const localRoot = path.join(repo, ".local") + path.sep;
  assert.ok(stageDirectory.startsWith(localRoot), "Candidate stage must stay inside this workspace .local/");
  const committed = committedSource(repo, sourceCommit), source = verifyFrozenSource(frozenSource, committed);
  exactCommit(repo, baselineCommit);
  const previous = committedSource(repo, baselineCommit);
  const baselineLicense = previous.files.get("LICENSE"), currentLicense = committed.files.get("LICENSE");
  assert.ok(baselineLicense && currentLicense && baselineLicense.bytes.equals(currentLicense.bytes), "Original EasyTier license changed");
  const lock = source.files.find(file => file.path === "Cargo.lock"); assert.ok(lock);
  assert.equal(lock.gitBlobSha256, "e3ee41507e7a8ef94470b70f4639140e67aadae646ada82dfd23b0beeb0e7fb2", "Locked dependency graph changed; this candidate recipe is for the unchanged graph");
  const producerBytes = fs.readFileSync(producerReceipt), producer = JSON.parse(producerBytes);
  assert.equal(producer.schemaVersion, 2, "Producer receipt must use schemaVersion 2");
  assert.equal(producer.coreExecuted, false); assert.equal(producer.cliExecuted, false);
  const runtime = {}, imports = [];
  for (const name of ["easytier-core.exe", "easytier-cli.exe"]) {
    const file = path.join(candidateOutput, name), description = describeFile(file), evidence = inspectPeImports(fs.readFileSync(file));
    assert.ok(description.bytes > 0 && description.bytes <= 32 * 1024 * 1024);
    assert.equal(evidence.noCaptureDllNormalOrDelayImports, true, "Capture DLL import rejected");
    runtime[name] = description; imports.push({name, ...evidence});
  }
  verifyProducerReceipt(producer, {source, lock, runtime});
  assert.equal(fs.realpathSync(producer.sourcePath), frozenSource, "Producer built a different source snapshot");
  assert.equal(fs.realpathSync(producer.outputPath), candidateOutput, "Producer output path differs");
  const originalRuntime = path.join(repo, "components/client/build/community-lan/product/2.7.0-laokuai");
  for (const [name, expected] of Object.entries(COMPANIONS)) { assert.deepEqual(describeFile(path.join(originalRuntime, name)), expected); runtime[name] = expected; }
  const patch = git(repo, ["diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--relative=components/easytier/source", baselineCommit, sourceCommit, "--", SOURCE_PREFIX]);
  assert.ok(patch.length > 0, "Native delta is empty");
  const receipt = {schemaVersion: 1, status: "source-and-static-candidate-verified", sourceCommit, sourceTree: committed.sourceTree,
    sourceTreeScope: "components/easytier/source subtree in monorepo commit", baselineCommit, baselineSourceTree: previous.sourceTree,
    sourceFileSetSha256: source.sourceFileSetSha256, sourceFiles: source.files.length, normalizedLineEndingFiles: source.normalizedLineEndingFiles,
    cargoLockRawSha256: lock.sha256, cargoLockGitBlobSha256: lock.gitBlobSha256,
    nativeDeltaSha256: sha(patch), producerReceiptSha256: sha(producerBytes), runtimeFiles: runtime, independentImports: imports,
    producerReceiptMetadataVerified: true, producerReceiptReviewed: false, productionPayloadChanged: false, coreExecuted: false, cliExecuted: false,
    nativeRuntimeAccepted: false, packagingEligible: false};
  // All validation precedes creating the new stage. Old runtime/receipts remain byte-identical.
  fs.mkdirSync(stageDirectory); fs.mkdirSync(path.join(stageDirectory, "runtime"));
  for (const name of Object.keys(runtime)) fs.copyFileSync(path.join(name.endsWith(".exe") ? candidateOutput : originalRuntime, name), path.join(stageDirectory, "runtime", name), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(stageDirectory, "native-delta.patch"), patch, {flag: "wx"});
  fs.writeFileSync(path.join(stageDirectory, "producer-receipt.original.json"), producerBytes, {flag: "wx"});
  fs.writeFileSync(path.join(stageDirectory, "frozen-source-verification.json"), JSON.stringify({...receipt, files: source.files}, null, 2) + "\n", {flag: "wx"});
  fs.writeFileSync(path.join(stageDirectory, "candidate-evidence.json"), JSON.stringify(receipt, null, 2) + "\n", {flag: "wx"});
  fs.writeFileSync(path.join(stageDirectory, "source-update-manifest.json"), JSON.stringify(sourceUpdateManifest(repo, sourceCommit, committed), null, 2) + "\n", {flag: "wx"});
  for (const [name, expected] of Object.entries(runtime)) assert.deepEqual(describeFile(path.join(stageDirectory, "runtime", name)), expected);
  return receipt;
}
if (require.main === module) {
  const argument = name => {const at = process.argv.indexOf("--" + name); assert.ok(at >= 2 && process.argv[at + 1], "Missing --" + name); return process.argv[at + 1];};
  if (process.argv.includes("--patch-set-only")) console.log(JSON.stringify(preparePatchSet({repo: argument("repo"), sourceCommit: argument("source-commit"), baselineCommit: argument("baseline-commit"), frozenSource: argument("frozen-source")})));
  else if (process.argv.includes("--source-update-only")) console.log(JSON.stringify(prepareSourceUpdate({repo: argument("repo"), sourceCommit: argument("source-commit"), frozenSource: argument("frozen-source")})));
  else {
    const receipt = prepareCandidate({repo: argument("repo"), sourceCommit: argument("source-commit"), baselineCommit: argument("baseline-commit"),
      frozenSource: argument("frozen-source"), candidateOutput: argument("candidate-output"), producerReceipt: argument("producer-receipt"), stageDirectory: argument("stage-directory")});
    console.log(JSON.stringify({status: receipt.status, sourceCommit: receipt.sourceCommit, sourceTree: receipt.sourceTree, sourceFiles: receipt.sourceFiles,
      sourceFileSetSha256: receipt.sourceFileSetSha256, nativeRuntimeAccepted: false, productionPayloadChanged: false}));
  }
}
module.exports = {safeRelative, walk, verifyFrozenSource, verifyProducerReceipt, committedSource, sourceUpdateManifest, prepareSourceUpdate, preparePatchSet, prepareCandidate};
