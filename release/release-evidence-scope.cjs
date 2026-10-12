const assert=require('node:assert/strict');

function verifyPackedInventory(packed,info,files){
  const counts=[info.packedFiles,info.installedPackedFiles].filter(x=>x!==undefined);
  assert.ok(counts.length>0&&counts.every(x=>Number.isSafeInteger(x)&&x>0&&x===files),'SDK packed inventory missing or inconsistent');
  assert.equal(packed?.version,info.version,'SDK packed version mismatch');
}


function verifyCurrentComponentSource(manifest,receipt,{git,sha,readFrozen,readReceipt}){
  const entry=manifest.validation.currentComponentSource;
  assert.ok(entry&&receipt,'Current component source receipt required');
  assert.equal(sha(entry.receipt),entry.receiptSha256,'Current source receipt changed');
  assert.equal(receipt.status,'PASS-CURRENT-SOURCE-AND-POPUP-RENDER-PACKAGE-PENDING');
  assert.equal(receipt.sourceCommit,entry.sourceCommit);
  assert.equal(git(['rev-parse',entry.sourceCommit+'^{tree}']),receipt.sourceTree,'Current source tree mismatch');
  const baseline=manifest.validation.lifecycle3LocalIntegration.sourceCommit;
  assert.equal(receipt.lifecycleBaseline,baseline);
  git(['merge-base','--is-ancestor',baseline,entry.sourceCommit]);git(['merge-base','--is-ancestor',entry.sourceCommit,'HEAD']);
  const changes=git(['diff','--name-only',baseline,entry.sourceCommit,'--','components']).split('\n').filter(Boolean).sort();
  assert.deepEqual(receipt.changes.map(x=>x.path).sort(),changes,'Superseding source delta mismatch');
  assert.equal(new Set(changes).size,changes.length);
  for(const x of receipt.changes){
    assert.ok(x.path.startsWith('components/client/')||['components/server/Dockerfile','components/server/src/sfu/hybridProtocol.test.ts'].includes(x.path),'Unreviewed component change');
    assert.equal(git(['rev-parse',entry.sourceCommit+':'+x.path]),x.gitBlob,'Superseding Git blob mismatch');
    assert.equal(require('node:crypto').createHash('sha256').update(readFrozen(entry.sourceCommit,x.path)).digest('hex'),x.sha256,'Superseding source byte mismatch');
  }
  const effectiveTrees=require('./reviewed-source-overlays.cjs').verifyReviewedSourceOverlays(manifest,receipt,{git,sha,readFrozen,readReceipt});
  for(const [name,c]of Object.entries(manifest.components)){
    assert.equal(git(['rev-parse',entry.sourceCommit+':'+c.path]),receipt.componentTrees[name],'Current frozen component tree mismatch');
    assert.equal(c.tree,effectiveTrees[name],'Current manifest component tree mismatch');
    assert.equal(git(['rev-parse','HEAD:'+c.path]),c.tree,'Current HEAD component mismatch');
  }
  const popupBase=manifest.validation.hybridDeploymentPreparation.sourceCommit;
  assert.equal(receipt.popupBaseline,popupBase);git(['merge-base','--is-ancestor',popupBase,entry.sourceCommit]);
  const popupFiles=['components/client/src/components/CommunityLanStatusControl.tsx','components/client/scripts/fixtures/community-lan-popup.tsx','components/client/scripts/check-community-popup-layout.cjs','components/client/scripts/build-community-popup-fixture.cjs'].sort();
  assert.deepEqual(git(['diff','--name-only',popupBase,entry.sourceCommit,'--','components']).split('\n').filter(Boolean).sort(),popupFiles,'Popup change exceeded reviewed source scope');
  assert.equal(receipt.localTypes.appErrors,0);assert.equal(receipt.localTypes.nodeErrors,0);assert.equal(receipt.localLint.errors,0);assert.equal(receipt.localLint.warnings,0);
  const ui=receipt.popupRender;assert.equal(ui.checks.length,13);assert.ok(ui.checks.every(x=>x.passed));assert.equal(ui.baseChecksPassed,9);assert.equal(ui.extraChecksPassed,4);
  for(const c of ui.checks){
    assert.ok(c.documentWidth<=c.viewport.width,'Rendered document overflow');
    assert.ok(c.footer.bottom<=c.viewport.height+1&&c.control.bottom<=c.footer.y,'Rendered footer/control overlap');
    assert.ok(c.controlPosition!=='fixed'&&c.controlPosition!=='absolute'&&c.button.width<=40,'Rendered compact control changed');
    if(c.popup)assert.ok(c.popup.x>=0&&c.popup.y>=0&&c.popup.right<=c.viewport.width+1&&c.popup.bottom<=c.viewport.height+1,'Rendered popup overflow');
    if(c.keyboard)assert.ok(c.keyboard.menuFocus&&c.focusRestored===true,'Rendered keyboard/focus regression');
  }
  assert.equal(ui.exitCode,0);assert.equal(ui.residualCount,0);assert.equal(ui.ownedEndpointCount,0);assert.equal(ui.foregroundCount,0);assert.ok(ui.endpointSamples>0);assert.equal(ui.allEndpointQueriesSucceeded,true);assert.equal(ui.monitorStopReason,null);assert.equal(ui.showOrFocusEvents,0);
  for(const [file,hash]of Object.entries(ui.sourceInputHashes))assert.equal(require('node:crypto').createHash('sha256').update(readFrozen(entry.sourceCommit,'components/client/'+file)).digest('hex'),hash,'Rendered input/source mismatch');
  for(const flag of ['newPackageBuilt','actualWholeAppAccepted','realAccountAccepted','realMediaAccepted','nativeAccepted','deployed','ready'])assert.equal(receipt.boundaries[flag],false,'Source/render evidence promoted to runtime/release');
  assert.equal(receipt.boundaries.finalPackage,null);
  return {...receipt,componentTrees:effectiveTrees};
}

function verifyLifecycleScope(manifest,receipt,{git,sha,readFrozen,currentSourceReceipt,readReceipt}){
  const currentScope=manifest.validation.currentComponentSource?verifyCurrentComponentSource(manifest,currentSourceReceipt,{git,sha,readFrozen,readReceipt}):null;
  const entry=manifest.validation.lifecycle3LocalIntegration;
  assert.equal(receipt.status,'LOCAL-SOURCE-INTEGRATED-PURE-CHECKS-PASS-WINDOWS-BUILD-PENDING');
  assert.equal(receipt.candidate.sourceCommit,entry.sourceCommit);
  assert.equal(manifest.components.voice.sourceCommit,entry.sourceCommit);
  git(['merge-base','--is-ancestor',receipt.baseline,entry.sourceCommit]);
  git(['merge-base','--is-ancestor',entry.sourceCommit,'HEAD']);
  assert.equal(git(['rev-parse',entry.sourceCommit+'^{tree}']),receipt.candidate.sourceTree,'Lifecycle source tree mismatch');
  for(const [name,pin] of Object.entries(receipt.candidate.componentTrees)){
    assert.equal(git(['rev-parse',entry.sourceCommit+':components/'+name]),pin.tree,'Lifecycle frozen component mismatch');
    if(currentScope&&['client','server','sfu'].includes(name)){assert.equal(manifest.components[name].tree,currentScope.componentTrees[name],'Lifecycle superseding component mismatch');}
    else assert.equal(manifest.components[name].tree,pin.tree,'Lifecycle current component mismatch');
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
  const legacy=JSON.parse(readFrozen(entry.sourceCommit,'release/manifest.json')).repository;
  git(['merge-base','--is-ancestor',legacy.codeCommit,entry.sourceCommit]);
  assert.equal(git(['rev-parse',legacy.codeCommit+'^{tree}']),legacy.codeTree,'Frozen legacy comparison tree mismatch');
  return {current:manifest.components.voice,historical:old,historicalBoundary:receipt.baseline,currentBoundary:entry.sourceCommit,legacyComparisonBoundary:legacy.codeCommit};
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

module.exports={verifyPackedInventory,verifyCurrentComponentSource,verifyLifecycleScope,bindSdkReceipt,verifyRelinkEvidence};
