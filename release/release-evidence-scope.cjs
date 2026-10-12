const assert=require('node:assert/strict');

function verifyPackedInventory(packed,info,files){
  const counts=[info.packedFiles,info.installedPackedFiles].filter(x=>x!==undefined);
  assert.ok(counts.length>0&&counts.every(x=>Number.isSafeInteger(x)&&x>0&&x===files),'SDK packed inventory missing or inconsistent');
  assert.equal(packed?.version,info.version,'SDK packed version mismatch');
}

function verifyLifecycleScope(manifest,receipt,{git,sha,readFrozen}){
  const entry=manifest.validation.lifecycle3LocalIntegration;
  assert.equal(receipt.status,'LOCAL-SOURCE-INTEGRATED-PURE-CHECKS-PASS-WINDOWS-BUILD-PENDING');
  assert.equal(receipt.candidate.sourceCommit,entry.sourceCommit);
  assert.equal(manifest.components.voice.sourceCommit,entry.sourceCommit);
  git(['merge-base','--is-ancestor',receipt.baseline,entry.sourceCommit]);
  git(['merge-base','--is-ancestor',entry.sourceCommit,'HEAD']);
  assert.equal(git(['rev-parse',entry.sourceCommit+'^{tree}']),receipt.candidate.sourceTree,'Lifecycle source tree mismatch');
  for(const [name,pin] of Object.entries(receipt.candidate.componentTrees)){
    assert.equal(git(['rev-parse',entry.sourceCommit+':components/'+name]),pin.tree,'Lifecycle frozen component mismatch');
    assert.equal(manifest.components[name].tree,pin.tree,'Lifecycle current component mismatch');
  }
  assert.equal(receipt.sdkArchive.tgzSha256,manifest.components.voice.package.sha256,'Lifecycle archive receipt mismatch');
  assert.equal(receipt.sdkArchive.tgzSha1,manifest.components.voice.package.sha1,'Lifecycle archive SHA1 mismatch');
  assert.equal(receipt.sdkArchive.packedFiles,manifest.components.voice.package.packedFiles,'Lifecycle archive inventory mismatch');
  const frozen=JSON.parse(readFrozen(receipt.baseline,'release/manifest.json'));
  const old=manifest.components.voice.preservedReceivePath1;
  assert.ok(old,'Historical SDK descriptor required for lifecycle upgrade');
  for(const key of ['sourceCommit','tree'])assert.equal(old[key],frozen.components.voice[key],'Historical SDK snapshot mismatch');
  for(const key of ['path','version','sha256','sha1'])assert.equal(old.package[key],frozen.components.voice.package[key],'Historical SDK package snapshot mismatch');
  assert.equal(git(['rev-parse',receipt.baseline+':components/voice']),old.tree,'Historical SDK tree mismatch');
  assert.equal(sha(old.package.path),old.package.sha256,'Historical SDK archive changed');
  assert.equal(receipt.localValidation.passedSuites,8);
  assert.ok(receipt.localValidation.suites.every(x=>x.exitCode===0));
  assert.equal(receipt.boundaries.ready,false);
  assert.equal(receipt.boundaries.finalPackage,null);
  for(const key of ['productRun','nativeRun','realNetworkTrial','deployment','userConfigurationTouched'])assert.equal(receipt.boundaries[key],false,'Lifecycle source evidence promoted to execution');
  return {current:manifest.components.voice,historical:old,historicalBoundary:receipt.baseline,currentBoundary:entry.sourceCommit};
}

function bindSdkReceipt(sourceCommit,packageSha256,scope){
  for(const key of ['current','historical']){
    const descriptor=scope[key];
    if(descriptor&&sourceCommit===descriptor.sourceCommit&&packageSha256===descriptor.package.sha256)
      return {scope:key,sourceBoundary:key==='current'?scope.currentBoundary:scope.historicalBoundary,currentSdkAccepted:key==='current'};
  }
  throw Error('SDK receipt source/package scope mismatch');
}

function verifyRelinkEvidence(entry,receipt,sha){
  assert.equal(receipt.status,'PASS-modified-library-recipient-compile-and-link-only');
  assert.equal(receipt.ownerEvidence.immutableFilesVerified,81);
  assert.equal(receipt.ownerEvidence.allHashesMatched,true);
  assert.equal(receipt.helperRepair.exactOneExpressionReplacement,true);
  assert.equal(receipt.helperRepair.originalHelperSucceededUnchanged,false);
  assert.equal(entry.originalHelperSucceededUnchanged,false);
  assert.equal(receipt.helperRepair.fixedSha256,entry.correctedHelperSha256);
  assert.equal(sha(receipt.helperRepair.path),entry.correctedHelperSha256,'Corrected recipient helper changed');
  assert.equal(receipt.attempts.length,2);
  assert.equal(receipt.attempts[0].exitCode,1);
  assert.equal(receipt.attempts[1].exitCode,0);
  assert.equal(receipt.attempts[1].status,'PASS-fresh-target-offline-compile-and-link');
  assert.equal(receipt.attempts[1].producerCompiledCacheReused,false);
  assert.equal(entry.screenedCompilePassed,true);
  assert.equal(entry.modifiedLibraryRelinkPassed,true);
  assert.equal(entry.realRecipientTransfer,false);
  for(const key of ['nativeExecuted','appRebuilt','externalRecipientActuallyReceived','licenseFulfillmentAdjudicated','publicApproved','ready'])assert.equal(receipt.boundaries[key],false,'Relink evidence promoted to runtime/recipient/legal acceptance');
  assert.equal(receipt.boundaries.finalPackage,null);
  assert.equal(receipt.testOnlyLibraryProbe.productSourceEditImported,false);
  assert.equal(receipt.testOnlyLibraryProbe.binariesImportedIntoProduct,false);
}

module.exports={verifyPackedInventory,verifyLifecycleScope,bindSdkReceipt,verifyRelinkEvidence};
