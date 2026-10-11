/** Small supervisor only. Full read/decode/save/compare is an injected independent worker. */
export async function runObservedTrial(p,scope,scopeSha256) {
 const phaseTimers=new Set();
 async function bounded(operation,ms,code){let timer;try{const timeout=new Promise((_,reject)=>{timer=p.setTimer(()=>reject(new Error(code)),ms);phaseTimers.add(timer);});return await Promise.race([Promise.resolve().then(operation),timeout]);}finally{p.clearTimer(timer);phaseTimers.delete(timer);}}
 await bounded(()=>p.full({stage:'before'}),scope.snapshot.timeoutMs,'baseline-full-timeout');
 await bounded(()=>p.prepare(),scope.prepareTimeoutMs,'trial-prepare-timeout');
 await bounded(()=>Promise.all([p.full({stage:'prepared'}),p.light({stage:'warmup',warmup:true})]),scope.snapshot.timeoutMs,'prepared-observation-timeout');
 let stopped=false,reason=null,failure=null,ready=false,duringComplete=false,fresh=false,core,lightLoop=false,flight=null;
 let resolveStop;const stoppedEvent=new Promise(resolve=>{resolveStop=resolve;});
 const stop=code=>{if(stopped)return;stopped=true;reason=code;p.processes.shutdownOwned();resolveStop();for(const t of phaseTimers)p.clearTimer(t);phaseTimers.clear();p.cancelReads();};
 const timer=p.setTimer(()=>stop('deadline'),scope.maximumRunMs),detach=p.onCancel(()=>stop('operator-stop'));
 async function active(operation){const row=await Promise.race([Promise.resolve(operation).then(value=>({value})),stoppedEvent.then(()=>({stopped:true}))]);if(row.stopped)throw new Error('trial-stopped');return row.value;}
 const resources=()=>core?.ownedResources();
 async function readLight(){
  if(!core.isAlive())throw new Error('owned-core-exited');
  const value=await active(p.light({stage:'during',owned:resources()}));
  if(!core.isAlive())throw new Error('owned-core-exited');
  return value;
 }
 try {
  await active(bounded(async()=>{
   core=await p.start();
   while(!stopped&&!ready){ready=Boolean((await readLight()).ready);if(!ready)await active(p.pause(scope.light.pauseMs));}
  },scope.readinessDeadlineMs,'owned-readiness-timeout'));
  if(!ready)throw new Error('owned-nic-never-ready');
  lightLoop=true;
  const loop=(async()=>{while(lightLoop&&!stopped){flight=readLight();const result=await flight;flight=null;if(!result.ready)throw new Error('owned-nic-lost');if(lightLoop&&!stopped)await active(p.pause(scope.light.pauseMs));}})();
  void loop.catch(error=>{if(!stopped){failure=error.message;stop('failure');}});
  if(!core.isAlive())throw new Error('owned-core-exited');
  const during=await active(bounded(()=>p.full({stage:'during',owned:resources()}),scope.snapshot.timeoutMs,'during-full-timeout'));
  if(!core.isAlive()||!during.ready)throw new Error('during-owned-evidence-unavailable');
  duringComplete=true;lightLoop=false;
  await active(bounded(async()=>{if(flight)await flight;const final=await readLight();if(!final.ready)throw new Error('owned-nic-lost');fresh=true;},scope.finalFreshLightBudgetMs,'fresh-light-timeout'));
  stop('evidence-complete');
 }catch(error){if(!stopped){failure=error.message;stop('failure');}}
 finally{
  lightLoop=false;if(!stopped)stop('failure');p.clearTimer(timer);detach();
  try{await p.processes.drainOwned();}catch{failure??='owned-cleanup-failed';}
 }
 const reports=p.processes.cleanupReports();
 if(reason!=='evidence-complete')failure??=reason==='deadline'?'observation-deadline-exceeded':reason;
 let clean=0;
 try {
  await bounded(async()=>{
   while(clean<scope.residualCleanSamples){
    // Never reuse a former numeric PID after stop. GUID/alias/any port owner detect residue.
    const sample=await p.light({stage:'settling',owned:null});clean=sample.ready?clean+1:0;
    if(clean<scope.residualCleanSamples)await p.pause(scope.light.pauseMs);
   }
  },scope.residualSettleMs,'residual-settle-timeout');
 }catch(error){failure??=error.message;p.cancelReads();}
 try{await bounded(()=>p.full({stage:'after',owned:null,reports}),scope.residualObservationMs,'residual-full-timeout');}
 catch(error){failure??=error.message;p.cancelReads();}
 if(!ready||!duringComplete||!fresh)failure??='running-evidence-incomplete';
 return {schema:2,outcome:failure?'failed':'passed',reason,failure,scopeSha256,ready,duringComplete,freshLightBeforeStop:fresh,cleanResidualSamples:clean,reports,realCommunityJoinVerified:false,deletedOsResources:false};
}
