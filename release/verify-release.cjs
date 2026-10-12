const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const m=JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.json'),'utf8'));
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const git=args=>{const r=spawnSync('git',args,{cwd:root,windowsHide:true,encoding:'utf8'});if(r.status)throw Error(r.stderr);return r.stdout.trim();};
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const evidence=require('./release-evidence-scope.cjs');
const readFrozen=(commit,file)=>{const r=spawnSync('git',['show',commit+':'+file],{cwd:root,windowsHide:true,maxBuffer:16*1024*1024});assert(r.status===0,'Frozen source unavailable: '+file);return r.stdout;};
git(['merge-base','--is-ancestor',m.repository.codeCommit,'HEAD']);
assert(git(['rev-parse',`${m.repository.codeCommit}^{tree}`])===m.repository.codeTree,'Recorded source tree mismatch');
for(const [name,component]of Object.entries(m.components))assert(git(['rev-parse',`HEAD:${component.path}`])===component.tree,`Component changed: ${name}`);
assert(!git(['diff','--name-only','HEAD','--','components']),'Uncommitted component changes');
assert(sha('components/client/yarn.lock')===m.components.client.dependencyLockSha256,'Dependency lock mismatch');
const packageInfo=m.components.voice.package;
assert(sha(packageInfo.path)===packageInfo.sha256,'SDK package mismatch');
const client=JSON.parse(fs.readFileSync(path.join(root,'components/client/package.json'),'utf8'));
assert(client.devDependencies['@gryt/voice']==='file:'+packageInfo.path.replace('components/client/',''),'Client SDK pin mismatch');
const tar=zlib.gunzipSync(fs.readFileSync(path.join(root,packageInfo.path)));let packed,files=0;
for(let pos=0;pos+512<=tar.length;){const header=tar.subarray(pos,pos+512);if(header.every(x=>x===0))break;const field=(start,length)=>header.toString('utf8',start,start+length).split('\0')[0];const size=parseInt(field(124,12).trim()||'0',8);assert(Number.isSafeInteger(size)&&size>=0&&pos+512+size<=tar.length,'Invalid SDK tar');const name=field(0,100),type=field(156,1);if(type==='0'||type===''){files++;if(name==='package/package.json')packed=JSON.parse(tar.toString('utf8',pos+512,pos+512+size));}pos+=512+Math.ceil(size/512)*512;}
evidence.verifyPackedInventory(packed,packageInfo,files);
let sdkScope={current:m.components.voice,currentBoundary:m.repository.codeCommit};
if(m.validation.lifecycle3LocalIntegration){
  const entry=m.validation.lifecycle3LocalIntegration;
  assert(sha(entry.receipt)===entry.receiptSha256,'Lifecycle integration receipt changed');
  sdkScope=evidence.verifyLifecycleScope(m,JSON.parse(fs.readFileSync(path.join(root,entry.receipt))),{git,sha,readFrozen,readReceipt:file=>JSON.parse(fs.readFileSync(path.join(root,file))),currentSourceReceipt:m.validation.currentComponentSource?JSON.parse(fs.readFileSync(path.join(root,m.validation.currentComponentSource.receipt))):undefined});
}
assert(m.easytier.tag==='v2.7.0'&&m.easytier.prerelease&&m.easytier.tagCommit==='8b7f1f0196edb5b580829ed5f135050fb5853478','ET source target mismatch');
assert(m.validation.clientPure.checks.every(x=>x.exit===0),'Recorded checks not green');
if(m.validation.nativePacketDependency){
  const dependency=m.validation.nativePacketDependency;
  assert(sha(dependency.report)===dependency.reportSha256,'Native static import evidence changed');
  const report=JSON.parse(fs.readFileSync(path.join(root,dependency.report),'utf8'));
  assert(report.coreSha256===dependency.coreSha256&&report.packetDllStaticImportConfirmed===true&&report.executed===false,'Native dependency evidence identity mismatch');
  if(m.ready)assert(dependency.resolutionVerified===true&&dependency.finalPackageBlocked===false,'Packet.dll distribution/deployment dependency unresolved');
}
if(m.validation.nativeNoNpcapIntegration){
  const candidate=m.validation.nativeNoNpcapIntegration;
  assert(sha(candidate.receipt)===candidate.receiptSha256,'No-Npcap integration receipt changed');
  const receipt=JSON.parse(fs.readFileSync(path.join(root,candidate.receipt),'utf8'));
  assert(receipt.nativeSourceCommit===(candidate.historicalNativeSourceCommit||m.components.easytier.privateSourceCommit)&&receipt.normalAndDelayImportsVerified===true&&receipt.runtimeManifestSchemaVersion===2,'No-Npcap source/proof/schema mismatch');
  for(const name of ['easytier-core.exe','easytier-cli.exe'])assert(receipt.files[name].sha256===(candidate.historicalRuntimeFiles||m.easytier.privateWindowsRuntimeFiles)[name].sha256,'No-Npcap exact binary mismatch');
  for(const file of receipt.trial.files)assert(git(['rev-parse',`${receipt.sourceCommit}:${file.path}`])===file.gitBlob,'Frozen trial source changed');
  assert(receipt.trial.executed===false&&receipt.activationApproved===false,'Static input falsely promoted to activation');
}
if(m.validation.uiConnectionDetailsDelivery){
  const delivery=m.validation.uiConnectionDetailsDelivery;
  assert(sha(delivery.receipt)===delivery.receiptSha256,'UI connection-details receipt changed');
}
if(m.validation.uiDensityDelivery){
  const delivery=m.validation.uiDensityDelivery;
  assert(sha(delivery.receipt)===delivery.receiptSha256,'UI density receipt changed');
  const receipt=JSON.parse(fs.readFileSync(path.join(root,delivery.receipt),'utf8'));
  assert(receipt.sourceCommit===delivery.sourceCommit&&receipt.productionFilesExact===5,'UI density source identity mismatch');
  for(const file of receipt.files)assert(git(['rev-parse',`${receipt.sourceCommit}:${file.path}`])===file.gitBlob,'UI density frozen source changed: '+file.path);
  assert(receipt.behavior.defaultSidebarWidth===320&&receipt.behavior.storedCustomWidthsPreserved===true,'UI default/custom-width contract changed');
}
for(const key of ['uiFinalAudioIcons','providerInstanceBindingFix'])if(m.validation[key]){
  const candidate=m.validation[key];
  assert(sha(candidate.receipt)===candidate.receiptSha256,'Integrated UI/Provider receipt changed: '+key);
  const receipt=JSON.parse(fs.readFileSync(path.join(root,candidate.receipt),'utf8'));
  git(['merge-base','--is-ancestor',receipt.sourceCommit,'HEAD']);
  if(receipt.files)for(const file of receipt.files)assert(git(['rev-parse',`${receipt.sourceCommit}:${file.path}`])===file.gitBlob,'Final UI frozen blob changed');
  if(key==='providerInstanceBindingFix'){evidence.bindSdkReceipt(receipt.sdkSourceCommit,receipt.sdkPackageSha256,sdkScope);assert(receipt.physicalDirectVerified===false,'Provider identity receipt scope mismatch');}
}
if(m.validation.sfuMicrophone48Candidate){
  const candidate=m.validation.sfuMicrophone48Candidate;
  assert(sha(candidate.receipt)===candidate.receiptSha256,'SFU48 candidate/failure receipt changed');
  const receipt=JSON.parse(fs.readFileSync(path.join(root,candidate.receipt),'utf8'));
  const frozen=m.components.sfu.preservedPreShutdown||m.components.sfu;
  assert(receipt.candidateSourceCommit===frozen.sourceCommit&&receipt.sfuTree===frozen.tree,'SFU48 exact historical source mismatch');
}
if(m.validation.receivePathIntegration){
  const candidate=m.validation.receivePathIntegration;
  assert(sha(candidate.receipt)===candidate.receiptSha256,'Receive-path integration receipt changed');
  const receipt=JSON.parse(fs.readFileSync(path.join(root,candidate.receipt),'utf8'));
  evidence.bindSdkReceipt(receipt.sdk.sourceCommit,receipt.sdk.packageSha256,sdkScope);
  assert(receipt.clockDomain==='performance.now'&&receipt.physicalDirectVerified===false&&receipt.sentToRemote===null,'Receive-path evidence boundary mismatch');
}
if(m.validation.etLocalObservation){
  const candidate=m.validation.etLocalObservation;
  assert(sha(candidate.receipt)===candidate.receiptSha256,'ET local-observation receipt changed');
  const inventory=JSON.parse(fs.readFileSync(path.join(root,'components/client/release/easytier-native-input-inventory.json'),'utf8'));
  for(const license of inventory.licenseTexts)assert(sha('components/client/release/'+license.file)===license.sha256,'ET license bytes mismatch');
}
if(m.validation.capacity.sfu48Sdk3Isolated){
  const candidate=m.validation.capacity.sfu48Sdk3Isolated;
  assert(sha(candidate.receipt)===candidate.receiptSha256,'Version-pinned SFU48 real acceptance receipt changed');
  const receipt=JSON.parse(fs.readFileSync(path.join(root,candidate.receipt),'utf8'));
  assert(receipt.sourcePin===candidate.sourcePin&&receipt.sfuTree===(m.components.sfu.preservedPreShutdown||m.components.sfu).tree,'SFU48 real acceptance historical source mismatch');
  assert(receipt.sdkSourceCommit===candidate.sdkSourceCommit&&receipt.notAccepted.currentReceivePath1Provider===true,'SDK3 media acceptance incorrectly promoted to current Provider');
}
if(m.validation.providerActualInstanceBinding){
  const actual=m.validation.providerActualInstanceBinding;
  assert(sha(actual.receipt)===actual.receiptSha256,'Actual Provider receipt changed');
  const receipt=JSON.parse(fs.readFileSync(path.join(root,actual.receipt),'utf8'));
  assert(receipt.testedFreeze===actual.testedFreeze,'Actual Provider tested freeze mismatch');
  const binding=evidence.bindSdkReceipt(receipt.sdkSourceCommit,receipt.sdkPackageSha256,sdkScope);
  if(binding.scope==='historical')assert(actual.currentBuildFreezeMediaSourceIdentical===false&&actual.historicalMediaIdenticalThroughFreeze===binding.sourceBoundary,'Historical Provider acceptance promoted to current source');
  assert(receipt.testedProductionProviderSeamAccepted===true&&receipt.currentFreezeMediaSourceByteIdentical===true&&receipt.completeAppE2E===false&&receipt.physicalDirectVerified===false,'Provider acceptance scope changed');
  assert(git(['diff','--name-only',receipt.testedFreeze,binding.sourceBoundary,'--','components/client/src','components/voice','components/server','components/sfu'])==='','Tested media source drifted within its pinned scope');
}
if(m.validation.nativeActualPreflight){
  const actual=m.validation.nativeActualPreflight;
  assert(sha(actual.receipt)===actual.receiptSha256,'Actual TUN preflight receipt changed');
  const receipt=JSON.parse(fs.readFileSync(path.join(root,actual.receipt),'utf8'));
  assert(receipt.currentHumanApprovalReceived===true&&receipt.approvalAppliesOnlyToConsumedSingleAttempt===true&&receipt.attempts===1&&receipt.retryPerformed===false,'TUN authorization/attempt scope drifted');
  assert(receipt.coreStarted===false&&receipt.tunCreated===false&&receipt.activationAccepted===false&&receipt.wholeRouteAndFirewallComparisonVerified===false,'Failed preflight promoted to activation');
}
if(m.validation.nativeLicenseReview){
  const legal=m.validation.nativeLicenseReview;
  assert(sha(legal.review)===legal.reviewSha256&&sha(legal.textBundle)===legal.textBundleSha256&&sha(legal.distributionReview)===legal.distributionReviewSha256,'Native license review bytes changed');
  require('./verify-native-licenses.cjs');
}
if(m.validation.uiIsolatedStartupSource){
  const entry=m.validation.uiIsolatedStartupSource;
  assert(sha(entry.receipt)===entry.receiptSha256,'UI source receipt changed');
  const receipt=JSON.parse(fs.readFileSync(path.join(root,entry.receipt),'utf8'));
  assert(receipt.sourceCommit===entry.sourceCommit&&receipt.validation.integrationPureAndTypeChecks===23&&receipt.validation.targetedEslint.startsWith('passed'),'UI reviewed source/check identity mismatch');
  for(const file of receipt.files)assert(sha(file.path)===file.sha256&&git(['rev-parse',`${receipt.sourceCommit}:${file.path}`])===file.gitBlob,'UI source/check bytes drifted');
  assert(receipt.applicationExecuted===false&&receipt.compiledPackageVerified===false&&receipt.actualDomOrScreenshot===false&&receipt.actualNoListenerOrFocusVerified===false&&receipt.old83ArtifactContainsMode===false,'UI source promoted to actual startup');
}
if(m.validation.uiHiddenBootstrapActual){
  const entry=m.validation.uiHiddenBootstrapActual;
  assert(sha(entry.receipt)===entry.receiptSha256,'Actual hidden bootstrap receipt changed');
  const receipt=JSON.parse(fs.readFileSync(path.join(root,entry.receipt),'utf8'));
  assert(receipt.testedFreeze==='5d309524116d2276d913af6f98a79436e9dbf3ed'&&receipt.status==='PASS-bootstrap-only'&&receipt.task6ReadOnlyVerification.files===201&&receipt.task6ReadOnlyVerification.allHashesMatched,'Actual UI source/evidence identity mismatch');
  assert(receipt.artifact.sha256==='d6a1ee4023fc33cf889798cb60b9a3dbe382a6a4a9af2e2b9f34168f223d4c83'&&receipt.appAsarSha256==='ed3ea18c2a6405a138386966ca41927a5ef1a8d5582afd6bdcedd6c6756682f0','Actual UI exact package identity changed');
  assert(receipt.actualRuns.length===2&&receipt.actualRuns.every(x=>x.exit===0&&x.residual.length===0&&!x.windowVisible&&!x.windowFocused)&&receipt.actualRuns[1].explicitEndpointAndForegroundQuerySuccess,'Actual UI bounded startup result changed');
  const bootstrapChanges=git(['diff','--name-only',receipt.testedFreeze,sdkScope.legacyComparisonBoundary||m.repository.codeCommit,'--','components/client/src','components/client/electron','components/voice','components/server','components/sfu']);
  assert(bootstrapChanges===''||(m.validation.modernNativeRuntime&&bootstrapChanges==='components/client/electron/easyTierWindowsAssets.ts'),'Measured UI/media source changed outside independently verified native asset pins');
  // Bootstrap acceptance stays with the exact old 5d package. The newer native
  // asset loader pins do not inherit complete-app bootstrap acceptance.
  // The next native source overlay is independently verified; the measured 5d
  // package still contains only the immutable dbaf native binaries.
  assert(receipt.notAccepted.communityMemberRows&&receipt.notAccepted.callMenuFocusOcclusion&&receipt.notAccepted.actualDeviceListening&&receipt.notAccepted.etTunCoexistenceCleanup&&receipt.ready===false&&receipt.finalPackage===null&&!receipt.publicDistributionApproved&&!receipt.task6ReadOnlyVerification.productExecuted,'Bootstrap promoted to full product/native/release acceptance');
}
if(m.validation.nativeLicenseFollowup){
  const entry=m.validation.nativeLicenseFollowup;
  assert(sha(entry.receipt)===entry.receiptSha256&&sha(entry.sourceMaterialsManifest)===entry.sourceMaterialsManifestSha256,'Native provenance follow-up changed');
  require('./verify-source-materials.cjs');
}
if(m.validation.componentUiActual){
  const entry=m.validation.componentUiActual;assert(sha(entry.receipt)===entry.receiptSha256,'Component UI receipt changed');
  const r=JSON.parse(fs.readFileSync(path.join(root,entry.receipt),'utf8'));for(const x of r.productionInputs)assert(sha(x.path)===x.sha256,'Measured production UI input drifted: '+x.path);
  assert(r.status==='PASS-component-fixture-only'&&r.actualAssertionsPassed===33&&r.captures===21&&r.testSeams.length===11&&r.task6ReadOnlyVerification.manifestFiles===178&&r.task6ReadOnlyVerification.allHashesMatched&&!r.task6ReadOnlyVerification.productExecuted&&!r.completeAppAccountMediaAccepted&&!r.realDeviceCallGameCapacityAccepted&&!r.physicalInputAccepted&&!r.ready&&r.finalPackage===null,'Component fixture acceptance promoted beyond measured scope');
}
if(m.validation.windowsServiceEncodingSource){
  const e=m.validation.windowsServiceEncodingSource;assert(sha(e.receipt)===e.receiptSha256&&sha(e.restorationReceipt)===e.restorationReceiptSha256,'Next Windows source/check receipt changed');
  git(['merge-base','--is-ancestor',e.sourceCommit,'HEAD']);assert(e.sourceCommit==='fb3ae901a02f763241ff8d78f1db0b89243fba24'&&e.changedFiles===1&&e.windowsActivePackages===504&&e.lockUnchanged&&!e.nativeBuilt&&!e.oldBinariesContainChange&&!e.linuxTreePassed,'Source removal falsely promoted to native/cross-platform acceptance');
  assert((e.historicalNativeSourceCommit||m.components.easytier.privateSourceCommit)===e.baselineNativeSourceCommit&&m.components.easytier.pendingSourceOverlay.integrationSourceCommit===e.sourceCommit,'Historical native source/package correspondence changed');
  assert(sha('components/easytier/source/easytier/Cargo.toml')===(m.components.easytier.modernStaticCrtOverlay?.sha256||m.components.easytier.pendingSourceOverlay.sha256),'Current native overlay differs');
  assert(sha(m.validation.nativeLicenseFollowup.crtUnitReceipt)===m.validation.nativeLicenseFollowup.crtUnitReceiptSha256,'CRT source scope receipt changed');
}
if(m.validation.nativeLatestApprovedAttempt){
  const entry=m.validation.nativeLatestApprovedAttempt;
  assert(sha(entry.receipt)===entry.receiptSha256,'Latest approved ET attempt receipt changed');
  const receipt=JSON.parse(fs.readFileSync(path.join(root,entry.receipt),'utf8'));
  assert(receipt.scopeSha256===entry.scopeSha256&&receipt.currentHumanApprovalReceived===true&&receipt.approvalConsumed===true&&receipt.authorizedAttempts===1&&receipt.networkRetries===0,'Latest ET attempt authorization drifted');
  assert(receipt.snapshots.length===2&&receipt.snapshots.every(s=>s.phaseCount===23&&s.failure===null)&&receipt.coreStartReached===false&&receipt.temporaryNicCreated===false&&receipt.nativeBeforeAfterPreservationAccepted===false&&receipt.task6Executed===false,'Failed latest preflight promoted to native acceptance');
  assert(receipt.actualComparison.actualPolicyModificationProven===false&&entry.actualDifferenceUnknown===true,'Unknown comparison mismatch reclassified as proven policy mutation');
}
if(m.validation.followupPackagingCompatibility){
  const candidate=m.validation.followupPackagingCompatibility;
  assert(sha(candidate.receipt)===candidate.receiptSha256,'Follow-up packaging receipt changed');
  const receipt=JSON.parse(fs.readFileSync(path.join(root,candidate.receipt),'utf8'));
  for(const file of receipt.files)assert(git(['rev-parse',`${receipt.sourceCommit}:${file.path}`])===file.gitBlob,'Follow-up packaging source changed');
  assert(receipt.buildFreezeUnchanged===true&&candidate.scopeExpanded===false&&candidate.productionDistributionGateUnchanged===true,'Packaging gate scope expanded');
}
if(m.validation.snapshotDiagnosticRepair){
  const actual=m.validation.snapshotDiagnosticRepair;
  assert(sha(actual.receipt)===actual.receiptSha256,'Snapshot repair receipt changed');
  const receipt=JSON.parse(fs.readFileSync(path.join(root,actual.receipt),'utf8'));
  const frozen=actual.frozenIntegrationCommit||'HEAD';
  for(const file of receipt.imports)assert(git(['rev-parse',`${frozen}:${file.path}`])===file.ownerGitBlob,'Historical snapshot repair frozen source changed');
  assert(receipt.task6PureChecks===30&&receipt.snapshotTimeoutMs===40000&&receipt.runningWatchdogMs===30000&&receipt.residualObservationMs===40000,'Snapshot repair budget/test scope changed');
  assert(receipt.consumedApprovalReused===false&&receipt.currentApprovalReceived===false&&receipt.task6OsSnapshotExecuted===false&&receipt.task6NativeExecuted===false&&receipt.nativeBeforeAfterPreservationAccepted===false,'Read-only repair promoted to native execution/acceptance');
  assert(sha(receipt.administratorBaselineReceipt)===receipt.administratorBaselineReceiptSha256,'Administrator baseline receipt changed');
  const baseline=JSON.parse(fs.readFileSync(path.join(root,receipt.administratorBaselineReceipt),'utf8'));
  assert(baseline.baselinePassed===true&&baseline.readerElapsedMs===20657&&baseline.completePhaseCount===23&&baseline.nativeOrTunExecuted===false&&baseline.authorizesNativeTrial===false,'Administrator baseline promoted to native authorization');
  assert(receipt.newScopeSha256===actual.scopeSha256&&actual.actualActivationAccepted===false,'Snapshot repair approval scope mismatch');
}
if(m.validation.etIndependentObserver){
  const entry=m.validation.etIndependentObserver;
  assert(sha(entry.receipt)===entry.receiptSha256,'Independent observer receipt changed');
  const receipt=JSON.parse(fs.readFileSync(path.join(root,entry.receipt),'utf8'));
  const frozen=entry.frozenIntegrationCommit||'HEAD';
  if(frozen!=='HEAD')git(['merge-base','--is-ancestor',frozen,'HEAD']);
  for(const file of receipt.imports){assert(git(['rev-parse',`${frozen}:${file.path}`])===file.ownerGitBlob,'Frozen independent observer source changed');if(frozen==='HEAD')assert(sha(file.path)===file.sha256,'Independent observer working source changed');}
  assert(receipt.ownerCommit==='3c9e73fd8c6039ce8561d84058d1d7f502c6247b'&&receipt.maximumStopRequestMs===65000&&receipt.maximumExitConfirmationRelativeToStartMs===71000&&receipt.phaseBudgetMs===219000&&receipt.sourcePins===15&&receipt.scopeSchema===4,'Independent observer scope/budget mismatch');
  assert(receipt.task6TrialSnapshotSemanticObserverChecks===49&&receipt.task6PlanningChecks===8&&receipt.task6MockedProductionChecks===23&&receipt.task6MockedProductionPassed,'Independent observer pure checks incomplete');
  assert(!receipt.currentHumanNativeApprovalReceived&&!receipt.task6OsSnapshotExecuted&&!receipt.task6NativeExecuted&&!receipt.nativeActivationAccepted&&!receipt.consumedApprovalsReused,'Independent observer source falsely grants activation');
}
if(m.validation.nativeActual65sAttempt){
  const entry=m.validation.nativeActual65sAttempt;
  assert(sha(entry.receipt)===entry.receiptSha256,'Actual65s receipt changed');
  const receipt=JSON.parse(fs.readFileSync(path.join(root,entry.receipt),'utf8'));
  assert(receipt.executedSourceCommit==='3c9e73fd8c6039ce8561d84058d1d7f502c6247b'&&receipt.scopeSha256===m.validation.etIndependentObserver.scopeSha256,'Actual65s source/scope mismatch');
  assert(receipt.normalUacExecutedOnce&&receipt.approvalConsumed&&!receipt.reactivationApproved&&!receipt.automaticRetry,'Actual65s consumed authorization reused');
  assert(receipt.verifiedNativeNicCreated&&receipt.ownedForbiddenSocketCount===1&&receipt.failure==='light-unexpected-socket'&&!receipt.osMatchedReadiness&&!receipt.fullDuringSnapshot,'Actual65s incomplete attempt promoted to live acceptance');
  assert(receipt.stop==='graceful-native-ACK-child-exit-zero-no-force'&&!receipt.forceApplied&&!receipt.residualNicOrRpc&&receipt.twoCleanPostLightSamplesConfirmed&&receipt.postFullConfirmedNoNicRpcResidual,'Actual65s owned cleanup evidence changed');
  assert(receipt.globalDiffsBeforeAfter===0&&receipt.newNetworkListRecords===1&&!receipt.newRecordDeleted,'Actual65s selected configuration facts changed');
  assert(!receipt.completeCoexistenceAccepted&&!receipt.nativeAcceptance&&!receipt.productionActivationApproved&&!receipt.task6NativeExecuted&&!receipt.task6OsNetworkSnapshotExecuted&&!receipt.rawEvidenceImported,'Actual65s false full/production acceptance');
}
if(m.validation.etSocketEvidenceSource){
  const e=m.validation.etSocketEvidenceSource;assert(sha(e.receipt)===e.receiptSha256,'Socket diagnostic receipt changed');
  const r=JSON.parse(fs.readFileSync(path.join(root,e.receipt),'utf8'));for(const x of r.imports)assert((e.frozenIntegrationCommit||sha(x.path)===x.sha256)&&git(['rev-parse',`${e.frozenIntegrationCommit||'HEAD'}:${x.path}`])===x.ownerGitBlob,'Frozen socket diagnostic source changed');
  assert(r.ownerCommit==='17f3dd1fd73b2efa4dc1042f18437799c35b20e5'&&r.scopeSchema===5&&r.sourcePins===17&&r.scopeSha256==='425b0131d0bf016a9ee5d4000b3fec492b5c637dcfe5d30dff1300386bce022c'&&r.task6PureChecks===101&&r.task6PlanningChecks===8&&r.task6Checks.every(x=>x.exit===0),'Current diagnostic source/test/scope mismatch');
  assert(!r.newScopeApproved&&r.previous2392ApprovalConsumed&&r.oldNativeBinariesUnchanged&&!r.historicalUnexpectedSocketCauseConfirmed&&!r.task6NativeExecuted&&!r.task6OsQueryExecuted&&!r.rawOwnerEndpointEvidenceImported,'Diagnostics promoted to new native approval or historical attribution');
}
if(m.internalCandidate){
  const candidate=m.internalCandidate;
  assert(sha(candidate.receipt)===candidate.receiptSha256,'Internal candidate receipt changed');
  const receipt=JSON.parse(fs.readFileSync(path.join(root,candidate.receipt),'utf8'));
  assert(receipt.sourceFreeze==='83dd572fad7837c9716153b9cc2e58535db1b875'&&receipt.codeCommit==='6cb8a9cf1f730454e43e19a0cb60a106684ee3e2','Internal artifact source drifted');
  git(['merge-base','--is-ancestor',receipt.sourceFreeze,'HEAD']);
  assert(receipt.artifact.sha256===candidate.artifact.sha256&&receipt.artifact.bytes===128601307&&receipt.appAsar.sha256===candidate.appAsarSha256,'Internal artifact identity mismatch');
  assert(receipt.task6ReadOnlyVerification.manifestFiles===188&&receipt.task6ReadOnlyVerification.allListedBytesAndHashesMatched===true,'Artifact immutable verification absent');
  assert(receipt.followupSourceExcluded.nativeLicenseTextBundlePresentInThisArtifact===false&&receipt.followupSourceExcluded.runnerRepairPresentInThisArtifact===false,'New source falsely attributed to old artifact');
  assert(receipt.applicationExecuted===false&&receipt.fullApplicationE2E===false&&receipt.publicDistributionApproved===false&&candidate.runtimeAccepted===false&&m.finalPackage===null&&m.ready===false,'Internal candidate promoted to release');
}
if(m.ready&&m.validation.noNpcapBuildCandidate){
  const candidate=m.validation.noNpcapBuildCandidate;
  assert(candidate.twoBinaryNormalAndDelayImportsVerified===true&&candidate.fourFileRuntimeManifestUpdated===true,'Final core/CLI no-Npcap imports and runtime schema not verified');
}
if(m.easytier.nativePortsImplemented){
  const entries=require('../components/client/scripts/community-easytier-resources.cjs');
  const names=entries.map(e=>e.to.split('/').at(-1)).sort();
  const resources=m.validation.noNpcapBuildCandidate?.fourFileRuntimeManifestUpdated ? m.easytier.privateWindowsRuntimeFiles : m.easytier.officialWindowsReferenceFiles||m.easytier.windowsRuntimeFiles;
  assert(JSON.stringify(names)===JSON.stringify([...Object.keys(resources),'laokuai-build.json'].sort()),'ET resource file set mismatch');
  assert(m.easytier.bundleResourceDirectory==='community-lan/product/2.7.0-laokuai','ET product resource directory mismatch');
  for(const e of entries)assert(e.from==='build/'+e.to&&e.to.startsWith(m.easytier.bundleResourceDirectory+'/'),'ET exact resource path mismatch');
  git(['merge-base','--is-ancestor',m.frozenPreviousHybrid.commit,'HEAD']);
}
if(m.easytier.provenancePath){
  assert(sha(m.easytier.provenancePath)===m.easytier.provenanceSha256,'ET patch/build provenance changed');
  const provenance=JSON.parse(fs.readFileSync(path.join(root,m.easytier.provenancePath),'utf8'));
  assert(provenance.upstream.commit===m.easytier.tagCommit&&provenance.patchSet.baseCommit===m.easytier.tagCommit,'ET downstream base drift');
  for(const patch of provenance.patchSet.patches)assert(sha('components/easytier/'+patch.path)===patch.sha256,'ET delivered patch changed');
  if(provenance.sourceImport){
    assert(sha('components/easytier/source/LICENSE')===provenance.sourceImport.licenseSha256,'ET native license mismatch');
    assert(sha('components/easytier/source/Cargo.lock')===provenance.sourceImport.cargoLockSha256,'ET Cargo lock mismatch');
    assert(git(['ls-files','--','components/easytier/source']).split('\n').length===provenance.sourceImport.importedFiles,'ET source inventory mismatch');
    assert(!fs.existsSync(path.join(root,'components/easytier/source/easytier-contrib/easytier-uptime/.env')),'ET contributor runtime environment imported');
  }
  if(m.ready)require('../components/client/scripts/check-easytier-patched-payload.cjs').assertPrivatePayloadContract(provenance);
}
if(m.components.landing){
  const landing=m.components.landing;
  assert(landing.path==='components/landing','Landing boundary mismatch');
  assert(sha(landing.path+'/delivery-manifest.json')===landing.deliveryManifestSha256,'Landing delivery identity changed');
  assert(sha(landing.path+'/deployment-record.json')===landing.deploymentRecordSha256,'Landing deployment record changed');
  const delivery=JSON.parse(fs.readFileSync(path.join(root,landing.path,'delivery-manifest.json'),'utf8'));
  assert(delivery.patch.sha256===landing.finalPatchSha256&&delivery.files.length===6,'Final landing delivery mismatch');
  for(const file of delivery.files){
    assert(file.path.startsWith(landing.path+'/')&&!file.path.includes('..'),'Landing file outside component');
    assert(fs.statSync(path.join(root,file.path)).size===file.bytes&&sha(file.path)===file.sha256,'Landing source bytes changed: '+file.path);
  }
  assert(sha(landing.path+'/index.html')===landing.htmlSha256,'Published landing HTML identity changed');
  const receipt=JSON.parse(fs.readFileSync(path.join(root,landing.path,'deployment-record.json'),'utf8'));
  assert(receipt.html.sha256===landing.htmlSha256&&receipt.task6.redeployed===false&&receipt.task6.liveNetworkProbes===0,'Landing receipt/source or task6 boundary mismatch');
}

if(m.validation.etExpectedUdpScope){
 const e=m.validation.etExpectedUdpScope,r=JSON.parse(fs.readFileSync(path.join(root,e.receipt)));assert(sha(e.receipt)===e.receiptSha256,'UDP scope receipt changed');
 for(const x of r.imports)assert(sha(x.path)===x.sha256&&git(['rev-parse','HEAD:'+x.path])===x.ownerGitBlob,'Wired UDP source changed');
 assert(r.scopeSchema===6&&r.sourcePins===19&&r.pureChecks===110&&r.tests.every(x=>x.exit===0)&&r.scopeSha256==='a071fe9bdca3c58e3ceb9477f4a19b596b5c4ef14ee5ac62e88503b7be736010','UDP scope identity changed');
 assert(!r.activationAuthorized&&!r.nativeExecuted&&!r.osQueriesExecuted&&r.previousTrialResultUnchanged&&r.payloadSourceCommit==='dbaf04531024f4201e73ec0bc5ba6a7a6d8d3b49'&&r.udpEgress==='not-measured','UDP source promoted to native/egress acceptance');
}
if(m.validation.modernStaticCrtSource){
 const e=m.validation.modernStaticCrtSource,r=JSON.parse(fs.readFileSync(path.join(root,e.receipt)));assert(sha(e.receipt)===e.receiptSha256,'Modern CRT receipt changed');
 assert(sha('components/easytier/source/easytier/Cargo.toml')===r.integratedCargoSha256&&sha('components/easytier/source/Cargo.lock')===r.cargoLockSha256&&r.features.length===17&&r.windowsNormalBuildPackages===504&&r.thunkFeatures.length===0&&r.serviceManagerFeatures.length===0&&r.crtStatic&&r.helperReturnsBeforeDownloadAndLinkSetup&&!r.nativeBuilt&&!r.newRuntimeDllRequirementsVerified,'Modern CRT source/build boundary changed');
}

if(m.validation.modernNativeRuntime){
 const e=m.validation.modernNativeRuntime,r=JSON.parse(fs.readFileSync(path.join(root,e.receipt)));assert(sha(e.receipt)===e.receiptSha256,'Modern runtime receipt changed');
 assert(r.ownerFilesHashed===98&&r.sourceCommit==='089b6182c603c8ab60044b673effe0cf614cc28a'&&r.standardPlatformInputs===17&&r.compatibilityLinkInputs===0&&r.independentPePdbVerification.every(x=>x.pePdbMatched&&x.compatibilityOrRemovedEncodingPnetInputs===0),'Modern producer/source/PE-PDB evidence mismatch');
 assert(r.files['easytier-core.exe'].sha256===m.easytier.privateCoreSha256&&r.files['easytier-cli.exe'].sha256===m.easytier.privateCliSha256&&!r.currentPayloadGate&&!r.currentLicenseGate&&!r.currentNativeApproval&&!r.runtimeAcceptance&&!r.nativeExecutedByTask6&&!r.osQueriesExecutedByTask6&&!r.rawOwnerLogsImported&&!r.publicApproved,'Modern runtime falsely accepted or mismatched');
 const bom=JSON.parse(fs.readFileSync(path.join(root,e.bom)));assert(bom.targetPackages===504&&bom.packages.length===504&&sha(bom.licenseBundle.path)===bom.licenseBundle.sha256&&!bom.publicDistributionApproved&&!bom.actualRecipientSourceDelivered,'Modern BOM/notice/source boundary changed');
 assert(m.validation.etFinalTrialSource.oldPayloadStillDbaf===true&&!m.validation.etFinalTrialSource.usableForCurrentModernPayload,'Old trial authorization reused for modern payload');
}
if(m.validation.modernRecipientSource){
 const e=m.validation.modernRecipientSource;
 for(const x of e.files)assert(sha(x.path)===x.sha256,'Screened recipient evidence changed: '+x.path);
 const dir=path.join(root,'release/source-materials/modern-recipient'),read=n=>JSON.parse(fs.readFileSync(path.join(dir,n)));
 const s=read('screened-native-source.json'),d=read('dependency-source.json'),r=read('restoration.json'),l=read('lock-and-feature-check.json');
 assert(s.retainedSourceFiles===1262&&s.excluded.length===15&&s.excluded.filter(x=>/(?:^|\/)Packet\.(dll|lib)$/i.test(x.path)).length===6,'Screened source scope changed');
 assert(d.registry.length===865&&d.git.length===7&&d.activeRegistryArchives===494&&d.supplementalWorkspaceResolutionArchives===371&&d.fullWorkspaceClosurePacketFilenameScan.packetDllOrLibMembers===0,'Recipient dependency closure changed');
 assert(r.exactTargetPackageSetMatched&&r.lockedOfflineTargetPackages===504&&!r.compilerBuildOrNativeExecuted&&!r.actualRecipientReceived&&!r.relinkAccepted&&!r.publicDistributionApproved,'Recipient source restoration promoted to build/relink/release');
 assert(l.lockPackages===1129&&l.allPackageVersionsAndRegistryChecksumsUnchanged&&l.gitPackageTransportChanges.length===6&&l.thunkFeatures.length===0&&l.serviceManagerFeatures.length===0&&!l.nativeBuiltOrExecuted&&!l.publicApproved,'Relocated lock/feature proof changed');
}
if(m.validation.internalFullApp842Actual){
 const e=m.validation.internalFullApp842Actual,r=JSON.parse(fs.readFileSync(path.join(root,e.receipt)));
 assert(sha(e.receipt)===e.receiptSha256&&r.testedFreeze==='84292bfef11d3cf45987d6fa963b86e52ddbbf7a'&&r.artifact.bytes===129121178&&r.artifact.sha256==='3cff0c00f1a8441e98af909424081d4b74be08e9aba44d745eaa80d0f0062619','Actual full-app candidate identity changed');
 assert(r.task6ReadOnlyVerification.files===298&&r.task6ReadOnlyVerification.allHashesMatched&&!r.task6ReadOnlyVerification.productExecuted&&!r.task6ReadOnlyVerification.osQueriesExecuted&&r.payloadExactFiles===141,'Actual candidate verification scope changed');
 assert(r.actualBootstrap.run1.startsWith('observations-only')&&r.actualBootstrap.run2==='PASS-hidden-offline-bootstrap'&&r.actualBootstrap.run2Exit===0&&r.actualBootstrap.run2Samples===9&&r.actualBootstrap.run2SampledOwnedEndpoints===0&&!r.actualBootstrap.run2Foreground&&!r.actualBootstrap.nativeCoreCLIOrDriversExecuted&&!r.actualBootstrap.NSISWrapperExecuted,'Bootstrap or preserved run1 failure reclassified');
 assert(!r.ready&&r.finalPackage===null&&!r.publicDistributionApproved&&!r.nativeActivationApproved&&m.internalFullAppCandidate.containsModernNative&&!m.internalFullAppCandidate.nativeRuntimeAccepted&&!m.internalFullAppCandidate.realCallAccepted,'Internal full app promoted to release or native acceptance');
 assert(git(['diff','--name-only',r.testedFreeze,sdkScope.historicalBoundary||'HEAD','--','components'])==='','Measured historical full-app product source changed within its scope');
}
if(m.validation.recipientBuildPreparation){
 const e=m.validation.recipientBuildPreparation,r=JSON.parse(fs.readFileSync(path.join(root,e.receipt)));
 assert(sha(e.receipt)===e.receiptSha256&&r.checks.checks===9&&r.checks.lockMutationCasesRejected===4&&r.checks.powershellParserPassed&&!r.checks.compilerNativeOrProductExecuted,'Recipient preparation proof changed');
 if(e.relinkReceipt){
   git(['merge-base','--is-ancestor',e.preparationSourceCommit,'HEAD']);
   for(const x of r.tools)assert(crypto.createHash('sha256').update(readFrozen(e.preparationSourceCommit,x.path)).digest('hex')===x.sha256,'Frozen recipient tool/plan changed');
   assert(sha(e.relinkReceipt)===e.relinkReceiptSha256,'Recipient relink receipt changed');
   evidence.verifyRelinkEvidence(e,JSON.parse(fs.readFileSync(path.join(root,e.relinkReceipt))),sha);
   assert(sha(e.plan)===e.currentPlanSha256,'Current recipient plan changed');
   for(const x of r.tools)if(x.path!==e.plan&&x.path!=='release/source-materials/build-screened-recipient-native.ps1')assert(sha(x.path)===x.sha256,'Unrepaired recipient tool changed');
 }else{for(const x of r.tools)assert(sha(x.path)===x.sha256,'Recipient tool/plan changed');assert(!e.screenedCompilePassed&&!e.modifiedLibraryRelinkPassed,'Recipient command preparation promoted without relink evidence');}
 assert(!r.modifiedProbeCompiled&&!r.actualRecipientTransferred&&!r.publicApproved,'Historical preparation falsely promoted to relink or transfer');
}

if(m.validation.lifecycle3InternalBuild){
 const e=m.validation.lifecycle3InternalBuild,r=JSON.parse(fs.readFileSync(path.join(root,e.receipt))),candidate=m.internalLifecycle3Candidate;
 assert(sha(e.receipt)===e.receiptSha256,'Lifecycle internal build receipt changed');
 git(['merge-base','--is-ancestor',r.sourceCommit,'HEAD']);
 assert(git(['rev-parse',r.sourceCommit+'^{tree}'])===r.sourceTree&&e.sourceFreeze===r.sourceCommit&&e.sourceTree===r.sourceTree,'Lifecycle build source identity mismatch');
 const buildBoundary=m.validation.currentComponentSource?m.validation.lifecycle3LocalIntegration.sourceCommit:'HEAD';
 assert(git(['diff','--name-only',r.sourceCommit,buildBoundary,'--','components'])==='','Lifecycle built product source changed within its frozen scope');
 if(m.validation.currentComponentSource)assert(e.currentProductAccepted===false&&candidate.includesCurrentUiBrandSource===false,'Historical artifact promoted to current source acceptance');
 assert(r.sdkSha256===packageInfo.sha256&&r.filesVerified===411&&r.allHashesMatched&&r.payloadFilesByteExact===141,'Lifecycle build/SDK evidence mismatch');
 assert(candidate.sourceFreeze===r.sourceCommit&&candidate.sourceTree===r.sourceTree&&candidate.sdkSha256===r.sdkSha256&&candidate.artifact.sha256===r.artifact.sha256&&candidate.artifact.bytes===r.artifact.bytes&&candidate.asarSha256===r.asarSha256,'Lifecycle artifact descriptor mismatch');
 for(const [name,file] of Object.entries(r.nativePayloadUnchanged))assert(file.sha256===m.easytier.privateWindowsRuntimeFiles[name].sha256,'Lifecycle native payload changed');
 assert(!r.actualProductRun&&!r.ready&&r.finalPackage===null&&!r.publicDistributionApproved&&!r.nativeActivationApproved&&!candidate.runtimeAccepted&&!candidate.realCallAccepted&&!candidate.publicDistributionApproved&&!candidate.nativeActivationApproved&&!e.actualAppRun&&!m.ready&&m.finalPackage===null,'Lifecycle static build promoted to actual product/release acceptance');
}

if(m.validation.lifecycle3ReleaseVerifier){
 const e=m.validation.lifecycle3ReleaseVerifier,r=JSON.parse(fs.readFileSync(path.join(root,e.receipt)));
 assert(sha(e.receipt)===e.receiptSha256&&r.checks.scope.allPassed&&r.checks.scope.checks===e.scopeCases&&r.checks.cli.allPassed&&r.checks.cli.checks===e.cliCases,'Lifecycle verifier regression receipt changed');
 assert(e.requireReadyExit===2&&!r.ready&&r.finalPackage===null&&!r.publicDistributionApproved&&!r.nativeActivationApproved&&!r.productSourceChanged&&!r.windowsRepackageRequired,'Verifier checks promoted to product/release acceptance');
}
if(m.validation.currentPopupVerifier){
 const e=m.validation.currentPopupVerifier,r=JSON.parse(fs.readFileSync(path.join(root,e.receipt)));
 assert(sha(e.receipt)===e.receiptSha256&&r.sourceCommit===m.validation.currentComponentSource.sourceCommit&&e.sourceCommit===r.sourceCommit,'Current verifier receipt/source mismatch');
 assert(r.scopeChecks.allPassed&&r.scopeChecks.checks===e.scopeCases&&r.scopeChecks.positive+r.scopeChecks.negative===r.scopeChecks.checks,'Current verifier regressions incomplete');
 assert(r.cliChecks.length===2&&r.cliChecks[0].exit===0&&r.cliChecks[1].exit===2&&e.requireReadyExit===2,'Current readiness CLI regression changed');
 for(const x of r.verifierFiles)assert(sha(x.path)===x.sha256,'Current verifier source changed');
 assert(!r.actualRuntimeOrMediaAccepted&&!r.ready&&r.finalPackage===null,'Current verifier proof promoted to media/release');
 if(m.validation.reviewedSourceOverlays)assert(r.codeFreeze===m.repository.codeCommit,'Reviewed source verifier freeze changed');
}
if(m.validation.sfuShutdownImage){
 const e=m.validation.sfuShutdownImage;
 assert(sha(e.receipt)===e.receiptSha256,'SFU image receipt changed');
 require('./reviewed-source-overlays.cjs').verifySfuShutdownImage(m,JSON.parse(fs.readFileSync(path.join(root,e.receipt))),{git});
}
if(m.validation.etContractPrototype){
 const e=m.validation.etContractPrototype,r=JSON.parse(fs.readFileSync(path.join(root,e.receipt)));
 assert(sha(e.receipt)===e.receiptSha256&&r.localTests===97&&r.archiveSha256===e.archiveSha256,'Prototype receipt changed');
 for(const x of r.files)assert(sha(x.path)===x.sha256,'Archived prototype byte mismatch');
 assert(r.productIntegrated===false&&r.mediaPlanExecuted===false,'Prototype promoted to runtime implementation');
}
console.log(JSON.stringify({id:m.id,codeCommit:m.repository.codeCommit,sdkSourceBoundary:sdkScope.currentBoundary,historicalSdkSourceBoundary:sdkScope.historicalBoundary,sourceConsistent:true,components:Object.keys(m.components),sdkVersion:packed.version,historicalSdkReceiptsApplicableToCurrentSdk:!sdkScope.historical,ready:m.ready,easytier:m.easytier.implementationStatus,actualNetworkVerified:m.easytier.actualNetworkVerified}));
if(process.argv.includes('--require-ready')&&!m.ready){console.error('Release blocked: '+m.pending.join('; '));process.exitCode=2;}
