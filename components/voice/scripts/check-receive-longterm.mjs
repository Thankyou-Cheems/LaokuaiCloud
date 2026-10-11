import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { ReceiveLongTermController, ReceiveLongTermLeveler, createReceiveAnalyzerRuntime } from '../dist/audio/processors/receiveLongTermCore.js';
import { ReceiveLimiter } from '../dist/audio/processors/receiveLevelingCore.js';
import { RECEIVE_ANALYZER_BASE64 } from '../dist/audio/processors/receiveAnalyzerAsset.js';
try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
const tests=[];
function test(name,run){run();tests.push(name);}
const amp=db=>10**(db/20),close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('12 contiguous trusted frames; short utterances discarded',()=>{
  const c=new ReceiveLongTermController();
  for(let i=0;i<11;i++)c.update(amp(-38)**2,1,-70);
  assert.equal(c.energyCount,0);c.update(0,0,-70);
  for(let i=0;i<12;i++)c.update(amp(-38)**2,1,-70);
  assert.equal(c.energyCount,12);close(c.activeSeconds,.12);
});
test('5s window, 20% trim, exact -20 target, +1.5/-3 per accepted speech-second',()=>{
  const c=new ReceiveLongTermController();
  for(let i=0;i<99;i++)c.update(amp(-38)**2,1,-70);
  assert.ok(Number.isNaN(c.levelDb));c.update(amp(-38)**2,1,-70);
  close(c.levelDb,-38);close(c.gainDb,.015);
  for(let i=0;i<1300;i++)c.update(amp(-38)**2,1,-70);
  close(c.gainDb,18);assert.equal(c.energyCount,500);
  for(let i=0;i<1000;i++)c.update(0,0,-70);
  close(c.gainDb,18);assert.equal(c.update(0,0,-70),0);
  for(let i=0;i<12;i++)c.update(amp(-38)**2,1,-38);
  close(c.gainDb,17.64);assert.equal(c.noiseLimited,true);
  const trimmed=new ReceiveLongTermController();
  for(let i=0;i<1000;i++)trimmed.update(amp(i%5===0?-2:-30)**2,1,-70);
  close(trimmed.levelDb,-30);close(trimmed.desiredDb,10);
});
test('hold, silence, missing noise, negative persistence, limited and settled evidence',()=>{
  const c=new ReceiveLongTermController();
  for(let i=0;i<1600;i++)c.update(amp(-38)**2,1,-70);
  let value;for(let i=0;i<11;i++)value=c.update(0,0,-70);
  assert.ok(value>0);for(let i=0;i<3;i++)value=c.update(0,0,-70);
  close(value,0);assert.equal(c.update(amp(-38)**2,1,-70,false),0);
  const negative=new ReceiveLongTermController();
  for(let i=0;i<1600;i++)negative.update(amp(-6)**2,1,-70);
  close(negative.gainDb,-12);close(negative.update(0,0,-70),-12);
  assert.equal(negative.rangeLimited,true);
  const settled=new ReceiveLongTermController();
  for(let i=0;i<1000;i++)settled.update(amp(-20)**2,1,-70);
  assert.ok(settled.settledSeconds>=2);assert.equal(settled.rangeLimited,false);
});
test('reset reuses typed buffers',()=>{
  const c=new ReceiveLongTermController(),buffers=[c.pending,c.energies,c.sorted];
  for(let i=0;i<200;i++)c.update(amp(-35)**2,1,-70);c.reset();
  assert.deepEqual([c.pending,c.energies,c.sorted],buffers);
  assert.equal(c.energyCount,0);assert.equal(c.gainDb,0);
});
const module=await WebAssembly.compile(Buffer.from(RECEIVE_ANALYZER_BASE64,'base64'));
const runtime=createReceiveAnalyzerRuntime(module);
const bytes=readFileSync('third-party/receive-rnn/fixtures/samples.pcm');
const pcm=new Int16Array(bytes.buffer,bytes.byteOffset,bytes.length/2);
const core=new ReceiveLongTermLeveler(48000,runtime);core.configure(true,48000);
const input=new Float32Array(128),output=new Float32Array(128);
let at=0,peak=0;
const alloc=runtime.gryt_allocation_calls(),frees=runtime.gryt_free_calls();
for(let block=0;block<48000*30/128;block++){
  for(let i=0;i<128;i++)input[i]=pcm[(at++)%pcm.length]/32768*.1;
  core.process([input],[output],true);
  for(const x of output){assert.ok(Number.isFinite(x));peak=Math.max(peak,Math.abs(x));}
}
const realAnalyzer={acceptedSpeechSeconds:core.controller.activeSeconds,learnedAutoGainDb:core.controller.gainDb,
  appliedAutoGainDb:core.appliedDb,desiredDb:core.controller.desiredDb,peak};
test('real RNN public golden PCM learns, zero WASM allocation/free in processing',()=>{
  assert.ok(core.controller.activeSeconds>1);assert.ok(core.controller.gainDb>0);
  assert.equal(runtime.gryt_allocation_calls(),alloc);assert.equal(runtime.gryt_free_calls(),frees);
  assert.equal(runtime.memory.buffer.byteLength,16777216);
});
test('real silence retains learned gain and releases applied positive gain',()=>{
  const learned=core.controller.gainDb;input.fill(0);
  for(let i=0;i<48000*3/128;i++)core.process([input],[output],true);
  close(core.controller.gainDb,learned);assert.ok(Math.abs(core.appliedDb)<1e-8);
});
test('manual gain follows measurement; duplicate real core states identical',()=>{
  const a=new ReceiveLongTermLeveler(48000,runtime),b=new ReceiveLongTermLeveler(48000,runtime);
  a.configure(true,48000);b.configure(true,48000);const other=new Float32Array(128);at=0;
  for(let k=0;k<48000*2/128;k++){
    for(let i=0;i<128;i++)input[i]=pcm[(at++)%pcm.length]/32768*.1;
    a.process([input],[output],true);b.process([input],[other],true);
    for(let i=0;i<128;i++){assert.equal(output[i],other[i]);assert.ok(output[i]*0===0);close(output[i]*2,other[i]*2);}
  }
  close(a.controller.gainDb,b.controller.gainDb);a.destroy();b.destroy();
});
test('nonfinite, clipping, first impulse, manual200 and 16-way sum strictly sample-limited',()=>{
  const stream=new ReceiveLimiter(48000),bus=new ReceiveLimiter(48000);
  const limited=new Float32Array(128),final=new Float32Array(128);core.configure(true,48000);
  for(let k=0;k<40;k++){
    input.fill(k<10?1:0);if(k===0){input[0]=10;input[1]=NaN;input[2]=Infinity;input[3]=-Infinity;}
    core.process([input],[output],true);for(let i=0;i<128;i++)output[i]*=2;
    stream.process([output],[limited],true);for(let i=0;i<128;i++)limited[i]*=16;
    bus.process([limited],[final],true);
    for(const x of final){assert.ok(Number.isFinite(x));assert.ok(Math.abs(x)<=amp(-3)+3e-8);}
  }
});
test('OFF unity; unsupported96k unity-auto with independent downstream fast protection',()=>{
  for(let i=0;i<128;i++)input[i]=Math.sin(i)*.3;
  core.process([input],[output],false);assert.deepEqual(output,input);
  const unsupported=new ReceiveLongTermLeveler(96000,runtime);unsupported.configure(true,96000);
  assert.equal(unsupported.available,false);assert.equal(unsupported.supported,false);
  input.fill(1);for(let i=0;i<1000;i++)unsupported.process([input],[output],true);
  assert.equal(unsupported.controller.gainDb,0);assert.equal(unsupported.compDb,0);
  const protection=new ReceiveLimiter(96000);protection.process([output],[input],true,true);
  assert.ok(protection.fastGain<.3);unsupported.destroy();
});
test('initialization failure and injected analyzer-call failure remove boost, keep finite audible output',()=>{
  const missing=new ReceiveLongTermLeveler(48000);missing.configure(true,48000);assert.equal(missing.fault,true);
  const faulted=new ReceiveLongTermLeveler(48000,{...runtime,gryt_process10ms(){throw Error('injected');}});
  faulted.configure(true,48000);input.fill(.1);
  for(let i=0;i<20;i++)faulted.process([input],[output],true);
  assert.equal(faulted.fault,true);assert.equal(faulted.appliedDb,0);assert.ok(output.some(x=>x!==0));
  assert.ok(output.every(Number.isFinite));faulted.destroy();missing.destroy();
});
core.destroy();test('all handles cleaned',()=>assert.equal(runtime.gryt_live_states(),0));
const result={status:'passed',tests,realAnalyzer,realMicrophone:false};
if(process.env.RECEIVE_RESULTS)writeFileSync(process.env.RECEIVE_RESULTS,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
