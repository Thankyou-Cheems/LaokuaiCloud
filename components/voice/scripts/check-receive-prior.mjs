import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { ReceiveLongTermController, ReceiveLongTermLeveler, createReceiveAnalyzerRuntime } from '../dist/audio/processors/receiveLongTermCore.js';
import { ReceiveLimiter } from '../dist/audio/processors/receiveLevelingCore.js';
import { validateReceiveLevelPrior, exportReceiveLevelPrior, RECEIVE_LEVEL_PRIOR_SCHEMA } from '../dist/audio/lib/receiveLevelPrior.js';
import { RECEIVE_ANALYZER_BASE64 } from '../dist/audio/processors/receiveAnalyzerAsset.js';
try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
const tests=[],cases=[],amp=db=>10**(db/20),ceiling=amp(-3);
function test(name,run){run();tests.push(name);}
const prior={schemaVersion:1,processorSchema:RECEIVE_LEVEL_PRIOR_SCHEMA,learnedGainDb:18,
  speechLevelDbfs:-38,effectiveSpeechSeconds:30,lastVerifiedUnixMs:1000};
test('prior validation rejects schema, ranges, NaN, infinity and insufficient evidence; copies scalars',()=>{
  const good=validateReceiveLevelPrior({...prior,irrelevantAudio:'must never copy'});assert.deepEqual(good,prior);
  for(const bad of [null,{}, {...prior,schemaVersion:2},{...prior,processorSchema:'old'},
    {...prior,learnedGainDb:NaN},{...prior,learnedGainDb:19},{...prior,speechLevelDbfs:Infinity},
    {...prior,effectiveSpeechSeconds:4.9},{...prior,lastVerifiedUnixMs:1.2}]) assert.equal(validateReceiveLevelPrior(bad),undefined);
});
test('historical learned gain retained, initial actual +3 cap, silence cannot renew/restore, old statistics never current evidence',()=>{
  const c=new ReceiveLongTermController();assert.equal(c.importPrior(prior),true);
  assert.equal(c.gainDb,18);assert.equal(c.energyCount,0);assert.equal(c.activeSeconds,0);assert.ok(Number.isNaN(c.levelDb));
  for(let i=0;i<300;i++)assert.equal(c.update(0,0,-70),0);
  assert.equal(c.gainDb,18);assert.equal(c.priorRestoring,true);
  for(let i=0;i<99;i++)assert.ok(c.update(amp(-38)**2,1,-70)<=3+1e-10);
  const first=c.update(amp(-38)**2,1,-70);assert.ok(first>3&&first<3.02);
  for(let i=0;i<200;i++)c.update(amp(-38)**2,1,-70);
  assert.ok(c.restorationDb<6.1);assert.ok(Math.abs(c.gainDb-18)<1e-9);
  for(let i=0;i<1500;i++)c.update(amp(-38)**2,1,-70);
  assert.equal(c.priorRestoring,false);assert.ok(Math.abs(c.gainDb-18)<1e-9);
  assert.equal(c.importPrior({...prior,learnedGainDb:1}),false);
});
test('changed microphone level rejects prior after current robust 1s speech; safe bounded re-learning',()=>{
  const c=new ReceiveLongTermController();c.importPrior(prior);
  for(let i=0;i<100;i++)c.update(amp(-8)**2,1,-70);
  assert.equal(c.priorRejected,true);assert.equal(c.priorRestoring,false);
  assert.ok(c.gainDb<=3&&c.gainDb>=-6);assert.equal(c.energyCount,100);
  const negative=new ReceiveLongTermController();negative.importPrior({...prior,learnedGainDb:-12,speechLevelDbfs:-8});
  assert.equal(negative.update(0,0,-70),-6);
  const missing=new ReceiveLongTermController();missing.importPrior(prior);
  for(let i=0;i<200;i++)assert.equal(missing.update(amp(-38)**2,1,NaN,false),0);
});
test('export only established fresh current speech near learned target, never provisional/restoring/stale speech',()=>{
  const s={status:'settled',priorRestoring:false,estimatorReliability:'established',speechWindowSeconds:5,
    learnedAutoGainDb:10,targetAutoGainDb:10,speechLevelDbfs:-30,acceptedSpeechSeconds:12,
    audioTimeSeconds:20,lastAcceptedSpeechAudioTimeSeconds:19.8};
  assert.equal(exportReceiveLevelPrior(s,2000).effectiveSpeechSeconds,12);
  for(const delta of [{priorRestoring:true},{estimatorReliability:'provisional'},{speechWindowSeconds:4},
    {lastAcceptedSpeechAudioTimeSeconds:null},{lastAcceptedSpeechAudioTimeSeconds:18},
    {targetAutoGainDb:12},{audioTimeSeconds:NaN},{status:'unavailable'}]) assert.equal(exportReceiveLevelPrior({...s,...delta},2000),undefined);
});
const stats=(data,at,n)=>{let e=0,p=0;for(let i=at;i<at+n;i++){e+=data[i]**2;p=Math.max(p,Math.abs(data[i]));}
  return{rmsDb:10*Math.log10(e/n),peak:p};};
// A known normalized quiet signal rising 30 dB isolates the last protection stages. It does not mock the RNN.
for(const rate of[8000,44100,48000,96000])for(const count of[1,4,16])for(const manual of[0,1,2])for(const master of[.25,1,2]){
  const length=rate,change=Math.floor(rate*.2),back=Math.floor(rate*.5),all=new Float32Array(length);
  const route=new ReceiveLimiter(rate),bus=new ReceiveLimiter(rate),sizes=[1,127,256,64,128];let block=0;
  const source=new Float32Array(256),a=new Float32Array(256),sum=new Float32Array(256),b=new Float32Array(256);
  for(let at=0;at<length;){const n=Math.min(sizes[block++%sizes.length],length-at);
    for(let i=0;i<n;i++){const t=at+i;source[i]=Math.SQRT2*amp(t<change||t>=back?-20:10)*Math.sin(2*Math.PI*400*t/rate)*manual;}
    route.process([source.subarray(0,n)],[a.subarray(0,n)],true,true);
    for(let i=0;i<n;i++)sum[i]=a[i]*count*master;
    bus.process([sum.subarray(0,n)],[b.subarray(0,n)],true);all.set(b.subarray(0,n),at);at+=n;
  }
  let maxPeak=0;for(const x of all){assert.ok(Number.isFinite(x));maxPeak=Math.max(maxPeak,Math.abs(x));}
  assert.ok(maxPeak<=ceiling+1e-7);if(manual===0)assert.equal(maxPeak,0);
  const delay=route.latencySamples+bus.latencySamples,quiet=stats(all,change-Math.floor(rate*.02),Math.floor(rate*.01)),windows={};
  for(const [name,n]of[['first128',128],['first10ms',Math.round(rate*.01)],['first100ms',Math.round(rate*.1)]]){
    const s=stats(all,change+delay,n);windows[name]={...s,rmsRiseDb:manual===0?null:s.rmsDb-quiet.rmsDb};
  }
  if(count===1&&manual===1&&master===1)for(const s of Object.values(windows))assert.ok(s.rmsRiseDb<8,JSON.stringify({rate,s}));
  const restored=stats(all,Math.floor(rate*.9),Math.floor(rate*.05));
  if(manual>0&&count===1)assert.ok(restored.rmsDb>quiet.rmsDb-2);
  cases.push({rate,count,manual,master,quiet,windows,restored,maxPeak,delaySamples:delay});
}
tests.push('108 actual route/master protection cases, dynamic blocks, +30dB step first128/10ms/100ms, return quiet, manual0/100/200, 1/4/16 aligned routes');
test('fast stage does not amplify noise, stereo links, impulses/clipped/nonfinite remain finite and strict sample limited',()=>{
  for(const rate of[44100,48000]){
    const p=new ReceiveLimiter(rate),a=new Float32Array(128),b=new Float32Array(128),out=[new Float32Array(128),new Float32Array(128)];
    for(let k=0;k<100;k++){a.fill(k<40?.001:1);b.fill(k<40?.001:-1);if(k===40){a[0]=20;a[1]=NaN;b[2]=Infinity;}
      p.process([a,b],out,true,true);for(const ch of out)for(const x of ch){assert.ok(Number.isFinite(x));assert.ok(Math.abs(x)<=ceiling+1e-7);}
      if(k<40)assert.equal(p.fastGain,1);
    }
    p.reset();a.fill(.01);p.process([a],[out[0]],false,true);
    assert.equal(p.fastGain,1);for(let i=p.latencySamples;i<128;i++)assert.equal(out[0][i],a[i-p.latencySamples]);
  }
});
const module=await WebAssembly.compile(Buffer.from(RECEIVE_ANALYZER_BASE64,'base64')),runtime=createReceiveAnalyzerRuntime(module);
const raw=readFileSync('third-party/receive-rnn/fixtures/samples.pcm'),pcm=new Int16Array(raw.buffer,raw.byteOffset,raw.length/2);
const core=new ReceiveLongTermLeveler(48000,runtime),input=new Float32Array(128),out=new Float32Array(128);
core.configure(true,48000);core.controller.importPrior(prior);
const alloc=runtime.gryt_allocation_calls(),free=runtime.gryt_free_calls();let at=0;
for(let k=0;k<48000*30/128;k++){
  for(let i=0;i<128;i++)input[i]=pcm[(at++)%pcm.length]/32768*.1;
  core.process([input],[out],true);for(const x of out)assert.ok(Number.isFinite(x));
}
assert.ok(core.controller.activeSeconds>5);assert.equal(runtime.gryt_allocation_calls(),alloc);assert.equal(runtime.gryt_free_calls(),free);
const realRnn={acceptedSpeechSeconds:core.controller.activeSeconds,learnedGainDb:core.controller.gainDb,
  appliedGainDb:core.appliedDb,speechLevelDbfs:core.controller.levelDb,
  priorRejected:core.controller.priorRejected,priorRestoring:core.controller.priorRestoring};
core.destroy();assert.equal(runtime.gryt_live_states(),0);
tests.push('actual embedded RNN public PCM prior lifecycle, fresh accepted evidence, no WASM allocation/free in processing, handle cleanup');
const result={status:'passed',tests,cases,realRnn,scope:'Actual Node DSP and RNN; protection steps isolate downstream known normalized signal. No microphone/listening, no true-peak/hearing safety or hardware deadline claim.'};
if(process.env.RECEIVE_RESULTS)writeFileSync(process.env.RECEIVE_RESULTS,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,tests,realRnn,singleRoute:cases.filter(x=>x.count===1&&x.manual===1&&x.master===1)},null,2));
