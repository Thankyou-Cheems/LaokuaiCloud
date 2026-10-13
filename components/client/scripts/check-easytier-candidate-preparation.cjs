/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {safeRelative, verifyFrozenSource, verifyProducerReceipt} = require("./prepare-easytier-candidate.cjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "laokuai-source-freeze-test-"));
try {
  const bytes = Buffer.from("fn fixture() {}\n"), blob = "a".repeat(40);
  const committed = {files: new Map([["lib.rs", {bytes, blob}]])};
  fs.writeFileSync(path.join(temp, "lib.rs"), bytes);
  let receipt = verifyFrozenSource(temp, committed); assert.equal(receipt.files.length, 1); assert.equal(receipt.normalizedLineEndingFiles, 0);
  fs.writeFileSync(path.join(temp, "lib.rs"), "fn fixture() {}\r\n");
  receipt = verifyFrozenSource(temp, committed); assert.equal(receipt.normalizedLineEndingFiles, 1); assert.notEqual(receipt.files[0].sha256, receipt.files[0].gitBlobSha256);
  fs.writeFileSync(path.join(temp, "lib.rs"), "fn drift() {}\n");assert.throws(() => verifyFrozenSource(temp, committed), /differs from committed blob/);
  fs.writeFileSync(path.join(temp, "lib.rs"), bytes); fs.writeFileSync(path.join(temp, "new-untracked.rs"), "untracked");
  assert.throws(() => verifyFrozenSource(temp, committed), /file set differs/);fs.unlinkSync(path.join(temp, "new-untracked.rs"));
  fs.unlinkSync(path.join(temp, "lib.rs"));assert.throws(() => verifyFrozenSource(temp, committed), /file set differs/);
  fs.writeFileSync(path.join(temp, "lib.rs"), Buffer.from([0,13,10]));
  assert.throws(() => verifyFrozenSource(temp, {files:new Map([["lib.rs",{bytes:Buffer.from([0,10]),blob}]])}), /Binary source differs/);
  for (const invalid of ["../private", "a/../private", "C:/private", "/private", "a\\private", "a//file", "./file"]) assert.throws(()=>safeRelative(invalid));
  assert.equal(safeRelative("source/lib.rs"), "source/lib.rs");
  const runtime={"easytier-core.exe":{bytes:1,sha256:"a".repeat(64)},"easytier-cli.exe":{bytes:2,sha256:"b".repeat(64)}};
  const source={sourceFileSetSha256:"c".repeat(64)},lock={sha256:"d".repeat(64),gitBlobSha256:"e".repeat(64)};
  const producer={schemaVersion:2,action:"Build",exitCode:0,coreExecuted:false,cliExecuted:false,toolchain:"1.95.0",target:"x86_64-pc-windows-msvc",
    features:["cli","wireguard","websocket","smoltcp","tun","socks5","kcp","quic","magic-dns","zstd","upnp","icmp-proxy","management","endpoint-discovery","extended-services","linux-netlink","tcp-hole-punch"],
    noDefaultFeatures:true,rustflags:"-C target-feature=+crt-static",releaseProfileUnchanged:true,sourceInventorySha256:source.sourceFileSetSha256,
    cargoLockRawSha256:lock.sha256,baselineCargoLockGitContentSha256:lock.gitBlobSha256,command:["--release","--locked","--offline"],artifacts:Object.entries(runtime).map(([name,value])=>({path:name,...value}))};
  assert.equal(verifyProducerReceipt(producer,{source,lock,runtime}),true);
  for(const change of [{action:"Check"},{exitCode:1},{coreExecuted:true},{noDefaultFeatures:false},{rustflags:"-C target-feature=-crt-static"},
    {sourceInventorySha256:"f".repeat(64)},{artifacts:[]},{features:[...producer.features,"faketcp"]}])assert.throws(()=>verifyProducerReceipt({...producer,...change},{source,lock,runtime}));
  console.log("Candidate preparation: exact source file-set/blob validation, recorded CRLF normalization, drift/new/missing/binary/path rejection passed; no native or Git mutation");
} finally {
  for (const name of ["lib.rs", "new-untracked.rs"]) if (fs.existsSync(path.join(temp, name))) fs.unlinkSync(path.join(temp, name));
  fs.rmdirSync(temp);
}
