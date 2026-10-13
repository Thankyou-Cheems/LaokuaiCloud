'use strict';
// Source-only update from the preserved screened kit to a pinned monorepo source snapshot.
// No build, Git mutation, native execution, dependency download or product asset update.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {parseLock,checkLock} = require('./verify-recipient-build-input.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function safe(root, relative) {
  assert.ok(typeof relative==='string' && relative && !relative.includes('\\') && !path.isAbsolute(relative) && !/^[a-z]:/i.test(relative));
  assert.ok(relative.split('/').every(part=>part && part!=='.' && part!=='..'));
  return path.join(root,relative);
}
function readRegular(file) {assert.ok(fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink());return fs.readFileSync(file);}
function matches(bytes, record) {return bytes.length===record.bytes&&sha(bytes)===record.sha256;}
function sourceNames(root,prefix='') {
  const names=[];
  for(const entry of fs.readdirSync(root,{withFileTypes:true})){
    const file=path.join(root,entry.name),name=prefix+entry.name;assert.ok(!fs.lstatSync(file).isSymbolicLink(),'Source symlink/reparse input rejected');
    if(entry.isDirectory())names.push(...sourceNames(file,name+'/'));else{assert.ok(entry.isFile());names.push(name);}
  }
  return names.sort();
}
function sourceBytes(file, record) {
  const bytes=readRegular(file);if(matches(bytes,record))return bytes;
  assert.ok(!bytes.includes(0),'Binary source drift');
  const canonical=Buffer.from(bytes.toString('latin1').replace(/\r\n/g,'\n'),'latin1');
  assert.ok(matches(canonical,record),'Pinned snapshot source mismatch: '+record.path);return canonical;
}
function verifyUpdated({restoredDirectory,manifestPath}) {
  const restored=fs.realpathSync(restoredDirectory),source=path.join(restored,'source'),manifestBytes=readRegular(manifestPath),manifest=JSON.parse(manifestBytes);
  const receipt=JSON.parse(readRegular(path.join(restored,'NATIVE-SOURCE-UPDATE.json')));
  assert.equal(receipt.schemaVersion,1);assert.equal(manifest.schemaVersion,1);assert.equal(receipt.manifestSha256,sha(manifestBytes));
  assert.equal(receipt.sourceCommit,manifest.sourceCommit);assert.equal(receipt.sourceTree,manifest.sourceTree);assert.equal(receipt.sourceFiles,manifest.files.length);
  assert.equal(receipt.sourceUpdated,true);assert.equal(receipt.compilerExecuted,false);assert.equal(receipt.nativeRuntimeAccepted,false);
  assert.deepEqual(sourceNames(source),manifest.files.map(record=>record.path).sort(),'Updated source file set drift');
  const original=readRegular(path.join(restored,'ORIGINAL-PRODUCER-Cargo.lock')),lock=readRegular(path.join(source,'Cargo.lock'));
  assert.equal(sha(original),receipt.producerLockSha256);assert.equal(sha(lock),receipt.relocatedLockSha256);
  assert.deepEqual(checkLock(parseLock(original.toString()),parseLock(lock.toString())),receipt.relocatedPackages);
  for(const record of manifest.files)if(record.path!=='Cargo.lock')assert.ok(matches(readRegular(safe(source,record.path)),record),'Updated source drift: '+record.path);
  for(const name of manifest.excluded)assert.ok(!fs.existsSync(safe(source,name)),'Excluded historical asset restored');
  assert.ok(!fs.existsSync(path.join(restored,'recipient-build-target')),'Preserve previous build targets; use a fresh updated restoration');
  return {sourceCommit:receipt.sourceCommit,sourceTree:receipt.sourceTree,sourceFiles:receipt.sourceFiles,sourceVerified:true,compilerExecuted:false,nativeRuntimeAccepted:false};
}
function update({restoredDirectory,snapshotDirectory,manifestPath}) {
  const restored=fs.realpathSync(restoredDirectory),snapshot=fs.realpathSync(snapshotDirectory),source=path.join(restored,'source');
  const manifestBytes=readRegular(manifestPath),manifest=JSON.parse(manifestBytes);
  assert.equal(manifest.schemaVersion,1);assert.match(manifest.sourceCommit,/^[a-f0-9]{40}$/);assert.match(manifest.sourceTree,/^[a-f0-9]{40}$/);
  assert.equal(manifest.unchangedDependencies,true);assert.ok(Array.isArray(manifest.files)&&manifest.files.length===manifest.sourceFiles);
  assert.ok(Array.isArray(manifest.removed)&&Array.isArray(manifest.excluded)&&manifest.excluded.length===15);
  const baselineBytes=readRegular(path.join(__dirname,'modern-recipient/screened-native-source.json')),baseline=JSON.parse(baselineBytes);
  assert.equal(manifest.baselineInventoryEncoding,'utf8-crlf-to-lf');
  assert.equal(sha(Buffer.from(baselineBytes.toString('latin1').replace(/\r\n/g,'\n'),'latin1')),manifest.baselineInventorySha256);assert.equal(baseline.sourceCommit,manifest.baselineSourceCommit);
  assert.equal(baseline.retainedSourceFiles,1262);assert.equal(baseline.excluded.length,15);
  assert.deepEqual(manifest.excluded,[...baseline.excluded.map(file=>file.path)]);
  const restoration=JSON.parse(readRegular(path.join(restored,'RECIPIENT-SOURCE-RESTORATION.json')));
  assert.equal(restoration.schema,1);assert.equal(restoration.sourceCommit,baseline.sourceCommit);assert.equal(restoration.sourceFiles,1262);
  assert.equal(restoration.exactTargetPackageSetMatched,true);assert.equal(restoration.lockedOfflineTargetPackages,504);
  assert.equal(restoration.compilerBuildOrNativeExecuted,false);
  assert.ok(!fs.existsSync(path.join(restored,'recipient-build-target')),'Preserve prior targets; restore the kit to a fresh directory');
  const output=path.join(restored,'NATIVE-SOURCE-UPDATE.json'),backup=path.join(restored,'source-update-backup');
  assert.ok(!fs.existsSync(output)&&!fs.existsSync(backup),'Preserve previous source-update evidence');
  assert.deepEqual(sourceNames(source),baseline.retained.map(record=>record.path).sort(),'Restored baseline file set drift');
  const originalLock=readRegular(path.join(restored,'ORIGINAL-PRODUCER-Cargo.lock')),lock=readRegular(path.join(source,'Cargo.lock'));
  assert.equal(sha(originalLock),'e3ee41507e7a8ef94470b70f4639140e67aadae646ada82dfd23b0beeb0e7fb2');
  assert.equal(sha(lock),restoration.relocatedLockSha256);const relocatedPackages=checkLock(parseLock(originalLock.toString()),parseLock(lock.toString()));
  for(const record of baseline.retained)if(record.path!=='Cargo.lock')assert.ok(matches(readRegular(safe(source,record.path)),record),'Restored baseline differs: '+record.path);
  for(const record of baseline.excluded)assert.ok(!fs.existsSync(safe(source,record.path)),'Excluded historical asset restored');
  const names=new Set(),inputs=new Map(),old=new Map(baseline.retained.map(file=>[file.path,file]));
  for(const record of manifest.files){
    safe(source,record.path);assert.ok(!names.has(record.path));names.add(record.path);assert.ok(!manifest.excluded.includes(record.path));
    assert.match(record.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(record.bytes)&&record.bytes>=0);
    assert.ok(!/\bpacket\.(?:dll|lib)$/i.test(record.path));
    const prior=old.get(record.path);assert.equal(record.baselineSha256,prior?.sha256??null);assert.equal(record.baselineBytes,prior?.bytes??null);
    inputs.set(record.path,sourceBytes(safe(snapshot,'components/easytier/source/'+record.path),record));
    if(!prior)assert.ok(!fs.existsSync(safe(source,record.path)),'New source path already exists');
  }
  assert.deepEqual(manifest.removed,baseline.retained.filter(record=>!names.has(record.path)));
  assert.equal(sha(inputs.get('Cargo.lock')),sha(originalLock),'Producer dependency lock changed');
  assert.deepEqual(manifest.changedPaths,manifest.files.filter(record=>record.sha256!==record.baselineSha256||record.bytes!==record.baselineBytes).map(record=>record.path));
  // The kit's six verified Git transports remain local; all version/checksum identities stay unchanged.
  const changed=manifest.changedPaths.filter(name=>name!=='Cargo.lock');fs.mkdirSync(backup);
  for(const name of changed){const destination=safe(source,name);if(fs.existsSync(destination)){const saved=safe(backup,name);fs.mkdirSync(path.dirname(saved),{recursive:true});fs.copyFileSync(destination,saved,fs.constants.COPYFILE_EXCL);}fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,inputs.get(name));}
  for(const record of manifest.removed){assert.notEqual(record.path,'Cargo.lock');const destination=safe(source,record.path),saved=safe(backup,record.path);fs.mkdirSync(path.dirname(saved),{recursive:true});fs.copyFileSync(destination,saved,fs.constants.COPYFILE_EXCL);fs.unlinkSync(destination);}
  for(const record of manifest.files)if(record.path!=='Cargo.lock')assert.ok(matches(readRegular(safe(source,record.path)),record),'Updated source verification failed: '+record.path);
  assert.deepEqual(sourceNames(source),manifest.files.map(record=>record.path).sort(),'Updated source file set verification failed');
  assert.equal(sha(readRegular(path.join(source,'Cargo.lock'))),restoration.relocatedLockSha256);
  const result={schemaVersion:1,sourceCommit:manifest.sourceCommit,sourceTree:manifest.sourceTree,sourceFiles:manifest.sourceFiles,manifestSha256:sha(manifestBytes),
    producerLockSha256:sha(originalLock),relocatedLockSha256:sha(lock),relocatedPackages,changedPaths:changed,removedPaths:manifest.removed.map(record=>record.path),
    excludedPrebuiltAssetsPreserved:true,sourceUpdated:true,compilerExecuted:false,nativeRuntimeAccepted:false};
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
}
if(require.main===module){const [restoredDirectory,snapshotDirectory,manifestPath]=process.argv.slice(2);assert.ok(restoredDirectory&&snapshotDirectory&&manifestPath,'Usage: node apply-native-source-update.cjs FRESH_RESTORED_KIT EXACT_MONOREPO_SNAPSHOT|--check SOURCE_UPDATE_MANIFEST');console.log(JSON.stringify(snapshotDirectory==='--check'?verifyUpdated({restoredDirectory,manifestPath}):update({restoredDirectory,snapshotDirectory,manifestPath})));}
module.exports={update,sourceBytes,verifyUpdated};
