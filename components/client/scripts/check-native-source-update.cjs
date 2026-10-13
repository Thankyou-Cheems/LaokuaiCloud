/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
// Actual old/new source bytes with a synthetic six-transport lock fixture; no Cargo/build/native.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {committedSource,sourceUpdateManifest}=require("./prepare-easytier-candidate.cjs");
const {update,verifyUpdated}=require("../../../release/source-materials/apply-native-source-update.cjs");
const sha=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const repo=path.resolve(__dirname,"../../.."),sourceCommit=process.argv[2],baselineCommit=process.argv[3];
assert.match(sourceCommit??"",/^[a-f0-9]{40}$/);assert.match(baselineCommit??"",/^[a-f0-9]{40}$/);
const current=committedSource(repo,sourceCommit),old=committedSource(repo,baselineCommit),manifest=sourceUpdateManifest(repo,sourceCommit,current);
const fixture=path.join(repo,".local","native-source-update-fixture-"+crypto.randomBytes(6).toString("hex")),restored=path.join(fixture,"restored"),snapshot=path.join(fixture,"snapshot");
fs.mkdirSync(path.join(restored,"source"),{recursive:true});fs.mkdirSync(snapshot);
const baseline=JSON.parse(fs.readFileSync(path.join(repo,"release/source-materials/modern-recipient/screened-native-source.json")));
for(const record of baseline.retained){const item=old.files.get(record.path);assert.ok(item);assert.equal(item.bytes.length,record.bytes);assert.equal(sha(item.bytes),record.sha256);const file=path.join(restored,"source",record.path);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,item.bytes);}
for(const [name,item] of current.files){const file=path.join(snapshot,"components/easytier/source",name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,item.bytes);}
const original=old.files.get("Cargo.lock").bytes,relocated=Buffer.from(original.toString().replace(/^source = "git\+[^"\n]+"\n/gm,""));
fs.writeFileSync(path.join(restored,"ORIGINAL-PRODUCER-Cargo.lock"),original);fs.writeFileSync(path.join(restored,"source/Cargo.lock"),relocated);
fs.writeFileSync(path.join(restored,"RECIPIENT-SOURCE-RESTORATION.json"),JSON.stringify({schema:1,sourceCommit:baseline.sourceCommit,sourceFiles:1262,exactTargetPackageSetMatched:true,lockedOfflineTargetPackages:504,compilerBuildOrNativeExecuted:false,relocatedLockSha256:sha(relocated),syntheticTransportFixture:true}));
const manifestPath=path.join(fixture,"source-update-manifest.json");fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+"\n");
const result=update({restoredDirectory:restored,snapshotDirectory:snapshot,manifestPath});
assert.equal(result.sourceFiles,manifest.sourceFiles);assert.equal(result.compilerExecuted,false);assert.equal(result.nativeRuntimeAccepted,false);
assert.equal(result.changedPaths.length,manifest.changedPaths.length);assert.equal(sha(fs.readFileSync(path.join(restored,"source/Cargo.lock"))),sha(relocated));
assert.equal(verifyUpdated({restoredDirectory:restored,manifestPath}).sourceVerified,true);
const extra=path.join(restored,"source","untracked-fixture.rs");fs.writeFileSync(extra,"untracked");assert.throws(()=>verifyUpdated({restoredDirectory:restored,manifestPath}),/file set drift/);fs.unlinkSync(extra);
assert.throws(()=>update({restoredDirectory:restored,snapshotDirectory:snapshot,manifestPath}),/Preserve previous source-update evidence|Restored baseline differs/);
const changed=manifest.changedPaths.find(name=>name!=="Cargo.lock"),file=path.join(restored,"source",changed),good=fs.readFileSync(file);fs.writeFileSync(file,Buffer.concat([good,Buffer.from("\ndrift\n")]));
assert.throws(()=>verifyUpdated({restoredDirectory:restored,manifestPath}),/Updated source drift/);fs.writeFileSync(file,good);
assert.equal(verifyUpdated({restoredDirectory:restored,manifestPath}).sourceVerified,true);
fs.writeFileSync(path.join(fixture,"fixture-result.json"),JSON.stringify({schemaVersion:1,sourceCommit,baselineCommit,sourceFiles:result.sourceFiles,changedPaths:result.changedPaths,
  actualPreferredSourceBytesVerified:true,registryRelocationWasSynthetic:true,cargoOrNativeExecuted:false},null,2)+"\n");
console.log(JSON.stringify({sourceFiles:result.sourceFiles,changedPaths:result.changedPaths.length,actualPreferredSourceBytesVerified:true,registryRelocationWasSynthetic:true,cargoOrNativeExecuted:false,previousEvidencePreserved:true}));
