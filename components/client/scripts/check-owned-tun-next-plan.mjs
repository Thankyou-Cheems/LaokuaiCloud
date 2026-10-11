import assert from 'node:assert/strict';
import { NEXT_OBSERVATION_PLAN as PLAN,lifetimeBudget,configurationCoverage,createProposedStopWatchdog } from './owned-tun-next-observation-plan.mjs';
let count=0;function test(name,fn){fn();console.log(`ok ${++count} ${name}`);}
test('measured full reads cannot reliably fit the old 30s lifetime plus startup/fresh light',()=>{
  assert.ok(27621+PLAN.readinessDeadlineMs+PLAN.lightReadTimeoutMs>30000);
  const budget=lifetimeBudget();assert.equal(budget.requiredMs,62000);assert.equal(budget.marginMs,3000);assert.equal(budget.old30sMarginMs,-32000);
  assert.equal(budget.conservativeWallMs,213000);assert.equal(budget.exitConfirmationDeadlineMs,71000);
});
const full={complete:true,semanticDifferenceCount:0};
const during={...full,collectedWhileOwnedCoreAlive:true,startedBeforeReady:false};
const light={receiptMatched:true,freshBeforeStop:true,violationCount:0};
test('pre/post equality with light checks cannot replace during-run global evidence',()=>{
  assert.equal(configurationCoverage({before:full,after:full,light}),'during-global-evidence-unavailable');
  assert.equal(configurationCoverage({before:full,during:{...during,semanticDifferenceCount:1},after:full,light}),'configuration-drift-observed');
});
test('an observed during-only change cannot be hidden by restored post state',()=>{
  const record={before:full,during:{...during,semanticDifferenceCount:1},after:full,light};
  assert.equal(configurationCoverage(record),'configuration-drift-observed');
});
test('startup or post-stop samples cannot masquerade as a valid during-run global snapshot',()=>{
  for(const change of [{startedBeforeReady:true},{startedBeforeReady:undefined},{collectedWhileOwnedCoreAlive:false},{complete:false}])
    assert.equal(configurationCoverage({before:full,during:{...during,...change},after:full,light}),'during-global-evidence-unavailable');
});
test('all three complete global samples plus fresh receipt-matched light proof are required',()=>{
  assert.equal(configurationCoverage({before:full,during,after:full,light}),'sampled-coexistence-evidence-complete');
  for(const change of [{receiptMatched:false},{freshBeforeStop:false},{violationCount:1}])
    assert.equal(configurationCoverage({before:full,during,after:full,light:{...light,...change}}),'light-readiness-or-safety-unavailable');
});
test('deadline requests exact-owned stop and reader cancellation despite a stalled full read',()=>{
  const calls=[];let callback,ms;
  const watchdog=createProposedStopWatchdog({setTimer:(cb,n)=>{callback=cb;ms=n;return 1;},clearTimer:()=>calls.push('clear'),
    shutdownOwned:()=>calls.push('stored-owned-handles'),cancelReaders:()=>calls.push('cancel-readers')});
  // Unresolved observer never participates in the deadline callback.
  const stalled=new Promise(()=>{});assert.ok(stalled);assert.equal(ms,65000);callback();
  assert.deepEqual(calls,['stored-owned-handles','cancel-readers']);assert.equal(watchdog.reason,'deadline');
  watchdog.stop('another-error');assert.equal(calls.length,2);watchdog.dispose();
});
test('early policy/safety failure stops immediately instead of waiting out a long window',()=>{
  let stops=0;const w=createProposedStopWatchdog({setTimer:()=>1,clearTimer:()=>{},shutdownOwned:()=>stops++,cancelReaders:()=>{}});
  w.stop('observed-safety-failure');assert.equal(stops,1);assert.equal(w.reason,'observed-safety-failure');w.stop('deadline');assert.equal(stops,1);
});
test('plan is immutable and cannot accidentally execute or extend the current runner scope',()=>{
  assert.equal(PLAN.status,'proposal-not-wired-not-approved');assert.equal(PLAN.fullDuringCount,1);assert.equal(PLAN.lightMaximumInFlight,1);
  assert.throws(()=>{PLAN.stopRequestDeadlineMs=120000;});
});
console.log(`${count} pure observation-plan checks passed; no OS query/native/TUN`);
