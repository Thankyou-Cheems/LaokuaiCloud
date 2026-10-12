const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const evidence=require('./release-evidence-scope.cjs'),root=path.resolve(__dirname,'..'),clone=x=>structuredClone(x),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.json'))),entry=manifest.validation.lifecycle3LocalIntegration,lifecycle=JSON.parse(fs.readFileSync(path.join(root,entry.receipt))),relEntry=manifest.validation.recipientBuildPreparation,relink=JSON.parse(fs.readFileSync(path.join(root,relEntry.relinkReceipt)));
const cache=new Map();const git=args=>{const key=JSON.stringify(args);if(!cache.has(key)){const r=spawnSync('git',args,{cwd:root,windowsHide:true,encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(r.status,0,r.stderr);cache.set(key,r.stdout.trim());}return cache.get(key);};
const frozenBytes=new Map();
const services={git,sha:f=>hash(fs.readFileSync(path.join(root,f))),readFrozen:(commit,file)=>{const key=commit+':'+file;if(!frozenBytes.has(key)){const r=spawnSync('git',['show',key],{cwd:root,windowsHide:true,maxBuffer:16*1024*1024});assert.equal(r.status,0);frozenBytes.set(key,r.stdout);}return frozenBytes.get(key);},currentSourceReceipt:manifest.validation.currentComponentSource?JSON.parse(fs.readFileSync(path.join(root,manifest.validation.currentComponentSource.receipt))):undefined};
services.readReceipt=file=>JSON.parse(fs.readFileSync(path.join(root,file)));
const cases=[];let negatives=0;function test(name,fn){fn();cases.push(name);console.log('PASS '+name);}function rejects(name,fn){test(name,()=>assert.throws(fn));negatives++;}
test('Current packedFiles schema preserves exact version/count',()=>evidence.verifyPackedInventory({version:'new'},{version:'new',packedFiles:212},212));
test('Historical installedPackedFiles schema preserves exact version/count',()=>evidence.verifyPackedInventory({version:'old'},{version:'old',installedPackedFiles:212},212));
test('Consistent dual inventory aliases accepted',()=>evidence.verifyPackedInventory({version:'new'},{version:'new',packedFiles:212,installedPackedFiles:212},212));
for(const [name,info,count]of [['missing',{},212],['mismatch',{packedFiles:211},212],['aliases-disagree',{packedFiles:212,installedPackedFiles:211},212],['fractional',{packedFiles:212.1},212],['zero',{packedFiles:0},0]])rejects('Reject '+name+' inventory',()=>evidence.verifyPackedInventory({version:'new'},{version:'new',...info},count));
rejects('Reject stale SDK version',()=>evidence.verifyPackedInventory({version:'old'},{version:'new',packedFiles:212},212));
const scope=evidence.verifyLifecycleScope(manifest,lifecycle,services);
test('Actual lifecycle receipt and frozen history/tree/hash chain accepted',()=>assert.equal(scope.historicalBoundary,lifecycle.baseline));
test('Historical Provider receipt stays historical, not current acceptance',()=>assert.equal(evidence.bindSdkReceipt(scope.historical.sourceCommit,scope.historical.package.sha256,scope).currentSdkAccepted,false));
test('Current exact SDK source/package binding accepted',()=>assert.equal(evidence.bindSdkReceipt(scope.current.sourceCommit,scope.current.package.sha256,scope).scope,'current'));
rejects('Reject mixed historical source/current archive',()=>evidence.bindSdkReceipt(scope.historical.sourceCommit,scope.current.package.sha256,scope));
rejects('Reject unknown SDK scope',()=>evidence.bindSdkReceipt('unknown','unknown',scope));
rejects('Reject historical receipt without verified historical context',()=>evidence.bindSdkReceipt(scope.historical.sourceCommit,scope.historical.package.sha256,{current:scope.current}));
for(const [name,mutate]of [['saved-history-package',m=>m.components.voice.preservedReceivePath1.package.sha256='0'.repeat(64)],['saved-history-source',m=>m.components.voice.preservedReceivePath1.sourceCommit='0'.repeat(40)],['current-sdk-archive',m=>m.components.voice.package.sha256='0'.repeat(64)],['current-component-tree',m=>m.components.client.tree='0'.repeat(40)]])rejects('Reject '+name+' tampering',()=>{const m=clone(manifest);mutate(m);evidence.verifyLifecycleScope(m,lifecycle,services);});
rejects('Reject source tree tampering',()=>{const r=clone(lifecycle);r.candidate.sourceTree='0'.repeat(40);evidence.verifyLifecycleScope(manifest,r,services);});
rejects('Reject unproven baseline ancestry',()=>evidence.verifyLifecycleScope(manifest,lifecycle,{...services,git:a=>{if(a[0]==='merge-base')throw Error('Not ancestor');return git(a);}}));
rejects('Reject old SDK bytes altered on disk',()=>evidence.verifyLifecycleScope(manifest,lifecycle,{...services,sha:()=> '0'.repeat(64)}));
for(const flag of ['ready','productRun','nativeRun','realNetworkTrial','deployment','userConfigurationTouched'])rejects('Reject lifecycle source evidence '+flag+' promotion',()=>{const r=clone(lifecycle);r.boundaries[flag]=true;evidence.verifyLifecycleScope(manifest,r,services);});
test('Actual failed-original/successful-fixed relink proof accepted',()=>evidence.verifyRelinkEvidence(relEntry,relink,services.sha));
rejects('Reject changed corrected helper bytes',()=>evidence.verifyRelinkEvidence(relEntry,relink,()=> '0'.repeat(64)));
rejects('Reject missing relink proof',()=>evidence.verifyRelinkEvidence(relEntry,{},services.sha));
rejects('Reject false unchanged-helper success',()=>{const r=clone(relink);r.helperRepair.originalHelperSucceededUnchanged=true;evidence.verifyRelinkEvidence(relEntry,r,services.sha);});
rejects('Reject lost first failure',()=>{const r=clone(relink);r.attempts[0].exitCode=0;evidence.verifyRelinkEvidence(relEntry,r,services.sha);});
rejects('Reject failed corrected build',()=>{const r=clone(relink);r.attempts[1].exitCode=1;evidence.verifyRelinkEvidence(relEntry,r,services.sha);});
rejects('Reject relink entry flags without matching proof',()=>{const e=clone(relEntry);e.modifiedLibraryRelinkPassed=false;evidence.verifyRelinkEvidence(e,relink,services.sha);});
for(const flag of ['nativeExecuted','appRebuilt','externalRecipientActuallyReceived','licenseFulfillmentAdjudicated','publicApproved','ready'])rejects('Reject relink '+flag+' promotion',()=>{const r=clone(relink);r.boundaries[flag]=true;evidence.verifyRelinkEvidence(relEntry,r,services.sha);});
rejects('Reject marker binaries imported into product',()=>{const r=clone(relink);r.testOnlyLibraryProbe.binariesImportedIntoProduct=true;evidence.verifyRelinkEvidence(relEntry,r,services.sha);});
if(services.currentSourceReceipt){
 test('Current source/render supersession is bound to exact new Git trees',()=>evidence.verifyCurrentComponentSource(manifest,services.currentSourceReceipt,services));
 for(const[name,mutate]of [
 ['new-source-tree',r=>r.sourceTree='0'.repeat(40)],
 ['missing-source-delta',r=>r.changes.pop()],
 ['new-source-byte',r=>r.changes[0].sha256='0'.repeat(64)],
 ['old-rendered-input',r=>r.popupRender.sourceInputHashes[Object.keys(r.popupRender.sourceInputHashes)[0]]='0'.repeat(64)],
 ['failed-render-case',r=>r.popupRender.checks[0].passed=false],
 ['old-eight-of-nine',r=>r.popupRender.baseChecksPassed=8],
 ['missing-extra-size',r=>r.popupRender.extraChecksPassed=3],
 ['render-nonzero-exit',r=>r.popupRender.exitCode=1],
 ['render-listener',r=>r.popupRender.ownedEndpointCount=1],
 ['render-foreground',r=>r.popupRender.foregroundCount=1],
 ['render-residual',r=>r.popupRender.residualCount=1],
 ['render-no-endpoint-query',r=>r.popupRender.endpointSamples=0],
 ['failed-endpoint-query',r=>r.popupRender.allEndpointQueriesSucceeded=false],
 ['guard-aborted-run',r=>r.popupRender.monitorStopReason='monitor-error'],
 ['test-window-show',r=>r.popupRender.showOrFocusEvents=1],
 ['type-failure',r=>r.localTypes.appErrors=1],
 ['popup-geometry-overflow',r=>{const c=r.popupRender.checks.find(x=>x.popup);c.popup.right=c.viewport.width+24;}],
 ['document-geometry-overflow',r=>r.popupRender.checks[0].documentWidth=r.popupRender.checks[0].viewport.width+24],
 ['footer-overlap',r=>r.popupRender.checks[0].footer.bottom=r.popupRender.checks[0].viewport.height+24],
 ['lost-keyboard-focus',r=>{const c=r.popupRender.checks.find(x=>x.keyboard);c.focusRestored=false;}],
 ['unbuilt-package-promotion',r=>r.boundaries.newPackageBuilt=true],
 ['real-media-promotion',r=>r.boundaries.realMediaAccepted=true],
 ['ready-promotion',r=>r.boundaries.ready=true]])rejects('Reject '+name+' current-scope forgery',()=>{const r=clone(services.currentSourceReceipt);mutate(r);evidence.verifyCurrentComponentSource(manifest,r,services);});
 rejects('Reject missing current source receipt',()=>evidence.verifyLifecycleScope(manifest,lifecycle,{...services,currentSourceReceipt:undefined}));
 rejects('Reject missing current source receipt hash pin',()=>{const m=clone(manifest);m.validation.currentComponentSource.receiptSha256='0'.repeat(64);evidence.verifyCurrentComponentSource(m,services.currentSourceReceipt,services);});
}
if(manifest.validation.reviewedSourceOverlays){
 const reviewed=require('./reviewed-source-overlays.cjs');
 const run=(m=manifest,s=services)=>reviewed.verifyReviewedSourceOverlays(m,services.currentSourceReceipt,s);
 test('Exact SFU17, contract8 and real wiring40 chain accepted without UI proof promotion',()=>assert.equal(run().client,manifest.components.client.tree));
 for(const [name,mutate] of [
  ['missing-chain',m=>delete m.validation.reviewedSourceOverlays],
  ['reordered-chain',m=>m.validation.reviewedSourceOverlays.reverse()],
  ['receipt-hash',m=>m.validation.reviewedSourceOverlays[0].receiptSha256='0'.repeat(64)],
  ['wrong-code-freeze',m=>m.repository.codeCommit=m.validation.currentComponentSource.sourceCommit],
 ])rejects('Reject '+name+' reviewed source forgery',()=>{const m=clone(manifest);mutate(m);run(m);});
 for(const [name,mutate]of [
  ['lost-path',r=>r.changes.pop()],['changed-source-byte',r=>r.changes[0].sha256='0'.repeat(64)],
  ['wrong-baseline',r=>r.baseline=r.sourceCommit],['fake-types',r=>r.checks.strictClientTypesExit=1],
  ['wired-provider',r=>r.boundaries.realProviderWired=true],['wired-ipc',r=>r.boundaries.realIpcWired=true],
  ['activation',r=>r.boundaries.activationReady=true],['physical-direct',r=>r.boundaries.physicalDirectVerified=true],
 ])rejects('Reject '+name+' contract evidence forgery',()=>run(manifest,{...services,readReceipt:f=>{const r=services.readReceipt(f);if(r.kind==='easytier-pure-contract')mutate(r);return r;}}));
 for(const [name,mutate]of [
  ['missing-wiring-path',r=>r.changes.pop()],['wiring-byte',r=>r.changes[0].sha256='0'.repeat(64)],
  ['wiring-blob',r=>r.changes[0].gitBlob='0'.repeat(40)],['wiring-owner-count',r=>r.checks.serverOwnerFilesExact=8],
  ['wiring-main-types',r=>r.checks.mainRoots=63],['wiring-server-types',r=>r.checks.strictServerTypesExit=1],
  ['wiring-http-identity',r=>r.checks.canonicalHttpBlob='0'.repeat(40)],['wiring-test-count',r=>r.checks.serverEntryTests=18],
  ['missing-provider-source',r=>r.boundaries.realProviderWired=false],['missing-ipc-source',r=>r.boundaries.realIpcWired=false],
  ...['nativeActivated','realMediaAccepted','physicalDirectVerified','activationReady','ready'].map(flag=>['wiring-'+flag,r=>r.boundaries[flag]=true]),
  ['wiring-package',r=>r.boundaries.finalPackage='unbuilt.exe'],
 ])rejects('Reject '+name+' real wiring forgery',()=>run(manifest,{...services,readReceipt:f=>{const r=services.readReceipt(f);if(r.kind==='community-et-real-wiring')mutate(r);return r;}}));
 const live=services.readReceipt(manifest.validation.public270ReadOnly.receipt);
 test('Public real ListCredentials proof remains readonly-only',()=>reviewed.verifyPublicListReadOnly(manifest,live));
 for(const [name,mutate]of [['provider-acceptance',r=>r.completeProviderAccepted=true],['credential-mutation',r=>r.tunOrCredentialsMutated=true],['wrong-instance',r=>r.instanceId='other'],['wrong-portal',r=>r.portal='0.0.0.0:15890'],['unclosed-ssh',r=>r.sshChildExited=false]])rejects('Reject live '+name+' promotion',()=>{const r=clone(live);mutate(r);reviewed.verifyPublicListReadOnly(manifest,r);});
 const image=services.readReceipt(manifest.validation.sfuShutdownImage.receipt);
 test('New image PID1 signals bound to exact shutdown source',()=>reviewed.verifySfuShutdownImage(manifest,image,services));
 for(const [name,mutate]of [
  ['image-digest',r=>r.candidate.manifestDigest='sha256:'+'0'.repeat(64)],
  ['pid1-nonzero',r=>r.acceptance.offlinePid1Signals[0].exitCode=2],
  ['missing-pid1-case',r=>r.acceptance.offlinePid1Signals.pop()],
  ['active-media-claim',r=>r.acceptance.activeRoomRTPLeaseDrain=true],
 ])rejects('Reject '+name+' image forgery',()=>{const r=clone(image);mutate(r);reviewed.verifySfuShutdownImage(manifest,r,services);});
}
console.log(JSON.stringify({checks:cases.length,positive:cases.length-negatives,negative:negatives,allPassed:true,realNetworkOrNativeExecuted:false}));
