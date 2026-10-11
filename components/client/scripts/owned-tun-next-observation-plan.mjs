/** Planning only. No imports/effects/native adapter and no executable entry point. */
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
export const NEXT_OBSERVATION_PLAN=freeze({
  schema:1,status:'proposal-not-wired-not-approved',
  fullBeforeCount:2,fullReadTimeoutMs:40000,prepareTimeoutMs:5000,
  stopRequestDeadlineMs:65000,readinessDeadlineMs:10000,
  lightReadTimeoutMs:5000,lightPauseMs:1000,lightMaximumInFlight:1,
  fullDuringCount:1,finalFreshLightBudgetMs:10000,decisionAndPersistenceBudgetMs:2000,
  stopForceAfterMs:4000,stopFinalAfterMs:6000,
  residualSettleTimeoutMs:15000,residualCleanSamples:2,residualFullTimeoutMs:40000,
  scopeExpansion:'native stop-request deadline 30s -> 65s; post-stop observation 40s -> 15s light settling + 40s full read',
  requiresFreshOriginalHumanApproval:true,payloadAndNetworkConfigChanges:false,
});
export function lifetimeBudget(plan=NEXT_OBSERVATION_PLAN) {
  const requiredMs=plan.readinessDeadlineMs+plan.fullReadTimeoutMs+plan.finalFreshLightBudgetMs+plan.decisionAndPersistenceBudgetMs;
  return {requiredMs,marginMs:plan.stopRequestDeadlineMs-requiredMs,old30sMarginMs:30000-requiredMs,
    conservativeWallMs:plan.fullBeforeCount*plan.fullReadTimeoutMs+plan.prepareTimeoutMs+plan.stopRequestDeadlineMs
      +plan.stopFinalAfterMs+plan.residualSettleTimeoutMs+plan.residualFullTimeoutMs+plan.decisionAndPersistenceBudgetMs,
    exitConfirmationDeadlineMs:plan.stopRequestDeadlineMs+plan.stopFinalAfterMs};
}
export function configurationCoverage({before,during,after,light}) {
  // Equal before/after cannot prove absence of a temporary during-run change.
  if(!before?.complete||!after?.complete) return 'full-pre-post-evidence-unavailable';
  if(!during?.complete||during.startedBeforeReady!==false||during.collectedWhileOwnedCoreAlive!==true) return 'during-global-evidence-unavailable';
  if([before,during,after].some(s=>s.semanticDifferenceCount!==0)) return 'configuration-drift-observed';
  if(!light?.receiptMatched||!light.freshBeforeStop||light.violationCount!==0) return 'light-readiness-or-safety-unavailable';
  return 'sampled-coexistence-evidence-complete';
}
/** Independent one-shot stop controller. It never waits for a reader or finds processes. */
export function createProposedStopWatchdog({setTimer,clearTimer,shutdownOwned,cancelReaders},plan=NEXT_OBSERVATION_PLAN) {
  let stopped=false,reason=null;
  const stop=why=>{
    if(stopped)return;
    stopped=true;reason=why;
    shutdownOwned(); // Stored child handles only; actual exit/NIC disappearance need later evidence.
    cancelReaders();
  };
  const timer=setTimer(()=>stop('deadline'),plan.stopRequestDeadlineMs);
  return {stop,get stopped(){return stopped;},get reason(){return reason;},dispose(){clearTimer(timer);}};
}
