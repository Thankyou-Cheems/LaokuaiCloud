const assert=require('node:assert/strict'),crypto=require('node:crypto');
const scopes={
 'community-et-real-wiring':[
  "components/client/electron/communityEtBindingProjection.ts",
  "components/client/electron/communityEtConfig.test.mjs",
  "components/client/electron/communityEtConfig.ts",
  "components/client/electron/communityEtCredentialObservation.ts",
  "components/client/electron/communityEtGrantRuntime.ts",
  "components/client/electron/communityEtGrantTransport.ts",
  "components/client/electron/communityEtHttpContract.ts",
  "components/client/electron/communityEtRuntime.test.mjs",
  "components/client/electron/communityEtTrustedConfiguration.ts",
  "components/client/electron/easyTierCommunityIpc.ts",
  "components/client/electron/easyTierCommunityManager.ts",
  "components/client/electron/easyTierExistingConfiguration.ts",
  "components/client/electron/easyTierWindowsProcesses.ts",
  "components/client/electron/easyTierWindowsProduction.ts",
  "components/client/electron/main.ts",
  "components/client/electron/preload.ts",
  "components/client/electron/windowsEasyTierCliRuntime.ts",
  "components/client/scripts/check-community-easytier-network.mjs",
  "components/client/scripts/check-community-easytier-production.mjs",
  "components/client/src/components/communityLanSession.tsx",
  "components/client/src/lib/easyTierCommunity.ts",
  "components/client/src/packages/common/src/utils/tokenStorage.ts",
  "components/server/src/config/communityEt.test.ts",
  "components/server/src/config/communityEt.ts",
  "components/server/src/easytier/communityCredentialProvider.test.ts",
  "components/server/src/easytier/communityCredentialProvider.ts",
  "components/server/src/easytier/communityGrantApi.test.ts",
  "components/server/src/easytier/communityGrantApi.ts",
  "components/server/src/easytier/communityGrantAuth.ts",
  "components/server/src/easytier/communityGrantFactory.ts",
  "components/server/src/easytier/communityGrantRouter.test.ts",
  "components/server/src/easytier/communityGrantRouter.ts",
  "components/server/src/easytier/communityGrantService.test.ts",
  "components/server/src/easytier/communityGrantService.ts",
  "components/server/src/easytier/communityGrantStore.ts",
  "components/server/src/easytier/communityRpcWire.test.ts",
  "components/server/src/easytier/communityRpcWire.ts",
  "components/server/src/index.ts",
  "components/server/src/routes/ownJsonParsers.ts",
  "components/server/src/routes/routeJsonLimits.test.ts"
],
 'sfu-shutdown':[
  'cmd/sfu/main.go','cmd/sfu/main_test.go','cmd/sfu/replay_window_test.go','cmd/sfu/shutdown.go','cmd/sfu/shutdown_test.go',
  'internal/lifecycle/registry.go','internal/lifecycle/registry_test.go','internal/readiness/udp.go','internal/readiness/shutdown_test.go',
  'internal/recovery/recovery.go','internal/svc/forwarder.go','internal/track/manager.go','internal/webrtc/peer.go',
  'internal/websocket/connection.go','internal/websocket/handler.go','internal/websocket/keepalive.go','internal/websocket/shutdown_pure_test.go',
 ].map(x=>'components/sfu/'+x).sort(),
 'easytier-pure-contract':[
  'components/client/electron/communityEtConfig.ts','components/client/electron/communityEtConfig.test.mjs',
  'components/client/electron/communityEtGrant.ts','components/client/electron/communityEtGrant.test.mjs',
  'components/server/src/easytier/communityGrant.ts','components/server/src/easytier/communityGrant.test.ts',
  'components/server/src/easytier/communityDeviceBinding.ts','components/server/src/easytier/communityDeviceBinding.test.ts',
 ].sort(),
};
/** Explicit source deltas supersede component trees, never historical UI/runtime evidence. */
function verifyReviewedSourceOverlays(manifest,original,{git,sha,readFrozen,readReceipt}){
 const entries=manifest.validation.reviewedSourceOverlays;
 if(!entries){
  assert.equal(git(['diff','--name-only',original.sourceCommit,'HEAD','--','components']),'','Unreviewed source after UI freeze');
  return original.componentTrees;
 }
 assert.ok(readReceipt,'Reviewed source receipt reader required');
 assert.deepEqual(entries.map(e=>e.kind),['sfu-shutdown','easytier-pure-contract','community-et-real-wiring'],'Reviewed source chain changed');
 let baseline=original.sourceCommit,trees=original.componentTrees;
 for(const entry of entries){
  assert.equal(entry.receipt,'release/acceptance/'+entry.kind+'-source.json','Source receipt path changed');
  assert.equal(sha(entry.receipt),entry.receiptSha256,'Reviewed source receipt changed');
  const r=readReceipt(entry.receipt);
  assert.equal(r.kind,entry.kind);assert.equal(r.status,'PASS-REVIEWED-SOURCE-ONLY');
  assert.equal(r.baseline,baseline);assert.equal(r.sourceCommit,entry.sourceCommit);
  git(['merge-base','--is-ancestor',baseline,r.sourceCommit]);git(['merge-base','--is-ancestor',r.sourceCommit,'HEAD']);
  assert.equal(git(['rev-parse',r.sourceCommit+'^{tree}']),r.sourceTree,'Reviewed source tree mismatch');
  const changed=git(['diff','--name-only',baseline,r.sourceCommit,'--','components']).split('\n').filter(Boolean).sort();
  assert.deepEqual(changed,scopes[entry.kind],'Reviewed source exceeded exact path scope');
  assert.deepEqual(r.changes.map(x=>x.path).sort(),changed,'Reviewed source inventory incomplete');
  if(entry.kind==='easytier-pure-contract'){
   assert.ok(git(['diff','--name-status',baseline,r.sourceCommit,'--','components']).split('\n').every(x=>x.startsWith('A\t')),'Contract delta is not add-only');
   assert.equal(r.checks.serverTests,47);assert.equal(r.checks.clientTests,121);
   assert.equal(r.checks.strictServerTypesExit,0);assert.equal(r.checks.strictClientTypesExit,0);assert.equal(r.checks.lintExit,0);
  }else if(entry.kind==='community-et-real-wiring'){
   assert.equal(r.checks.mainTests,239);assert.equal(r.checks.serverTests,86);assert.equal(r.checks.serverEntryTests,19);
   assert.equal(r.checks.strictClientTypesExit,0);assert.equal(r.checks.strictServerTypesExit,0);assert.equal(r.checks.lintExit,0);
   assert.equal(r.checks.appRoots,655);assert.equal(r.checks.mainRoots,64);assert.equal(r.checks.serverRoots,229);
   assert.equal(r.checks.canonicalHttpBlob,'21d7a4804b1b35d33197346b5b7098254c9a8701');
   assert.equal(r.checks.serverOwnerFilesExact,9);
  }else{assert.equal(r.checks.shutdownTests,15);assert.equal(r.checks.compiledPackages,8);}
  for(const x of r.changes){
   assert.equal(git(['rev-parse',r.sourceCommit+':'+x.path]),x.gitBlob,'Reviewed Git blob changed');
   assert.equal(crypto.createHash('sha256').update(readFrozen(r.sourceCommit,x.path)).digest('hex'),x.sha256,'Reviewed source bytes changed');
  }
  for(const [name,c]of Object.entries(manifest.components))assert.equal(git(['rev-parse',r.sourceCommit+':'+c.path]),r.componentTrees[name],'Reviewed component tree changed');
  for(const flag of ['realProviderWired','realIpcWired'])assert.equal(r.boundaries[flag],entry.kind==='community-et-real-wiring','Wiring source boundary changed');
  for(const flag of ['nativeActivated','realMediaAccepted','physicalDirectVerified','activationReady','ready'])assert.equal(r.boundaries[flag],false,'Source evidence promoted to execution');
  assert.equal(r.boundaries.finalPackage,null);
  baseline=r.sourceCommit;trees=r.componentTrees;
 }
 assert.equal(manifest.repository.codeCommit,baseline,'Manifest code freeze does not match reviewed chain');
 assert.equal(git(['diff','--name-only',baseline,'HEAD','--','components']),'','Unreviewed source after contract freeze');
 return trees;
}
function verifySfuShutdownImage(manifest,r,{git}){
 const e=manifest.validation.sfuShutdownImage,c=r.candidate;
 assert.equal(r.status,'PASS-STATIC-IMAGE-AND-OFFLINE-PID1-SIGNALS-ONLY');
 assert.equal(r.sourceCommit,manifest.components.sfu.sourceCommit);assert.equal(r.sourceCommit,c.sourceCommit);
 assert.equal(r.componentTree,manifest.components.sfu.tree);assert.equal(c.componentTree,r.componentTree);
 assert.equal(git(['rev-parse',r.sourceCommit+':components/sfu']),r.componentTree);
 for(const k of ['manifestDigest','configDigest'])assert.equal(c[k],e[k],'SFU image identity changed');
 assert.equal(c.sourceLabels['org.opencontainers.image.revision'],r.sourceCommit);
 assert.equal(c.sourceLabels['local.laokuai.component-tree'],r.componentTree);
 assert.equal(c.tar.sha256,e.tarSha256);assert.equal(c.tar.bytes,10624000);
 assert.equal(c.compiledArtifacts['usr/local/bin/sfu'].sha256,e.elfSha256);
 assert.equal(r.task6ReadOnly.tarHashMatched,true);assert.equal(r.task6ReadOnly.elfHashMatched,true);
 assert.deepEqual(r.acceptance.offlinePid1Signals.map(x=>x.variant),['pid1-term','pid1-int','normal-docker-stop']);
 for(const x of r.acceptance.offlinePid1Signals){
  assert.equal(x.exitCode,0);assert.equal(x.passed,true);assert.equal(x.shutdownComplete,true);assert.equal(x.namespacePID1,'sfu');
  assert.ok(x.signalToDieSeconds>=0&&x.signalToDieSeconds<5);
  for(const k of ['panicLogged','OOMKilled','signal9Event'])assert.equal(x[k],false);
 }
 assert.equal(r.acceptance.cleanupResidual,0);
 for(const k of ['realAuthenticatedConnections','activeRoomRTPLeaseDrain'])assert.equal(r.acceptance[k],false);
 assert.equal(r.ready,false);assert.equal(r.finalPackage,null);assert.equal(r.productionDeploymentApproved,false);
}
function verifyPublicListReadOnly(manifest,r){
 const e=manifest.validation.public270ReadOnly;
 assert.equal(e.customWireInteropPassed,true);assert.equal(e.credentialCount,0);
 assert.equal(e.credentialMutationAccepted,false);assert.equal(e.completeProviderAccepted,false);
 assert.equal(r.target,'TencentCloudPublic/root@124.221.119.113');assert.equal(r.publicContainer,'cheems-p2p');
 assert.equal(r.instanceId,'e2a5bd9d-47bb-4120-8589-e6898112ae85');assert.equal(r.portal,'127.0.0.1:15890');
 assert.equal(r.method,'CredentialManageRpc.ListCredentials');assert.equal(r.methodIndex,3);assert.equal(r.credentialCount,0);
 for(const k of ['readOnly','customWireInteropPassed','sshChildExited'])assert.equal(r[k],true);
 for(const k of ['nativeStarted','listenerCreated','tunOrCredentialsMutated','rawConfigOrCredentialSecretRequested','completeProviderAccepted'])assert.equal(r[k],false);
}
module.exports={verifyReviewedSourceOverlays,verifySfuShutdownImage,verifyPublicListReadOnly};
