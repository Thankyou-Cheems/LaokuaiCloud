import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const text=ts.transpileModule(readFileSync('src/audio/processors/adaptiveTransmitGate.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {AdaptiveTransmitGate}=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
const frame=(probability,rmsDbfs,nonzero=true)=>({probability,rmsDbfs,nonzero,valid:true});
const gate=new AdaptiveTransmitGate();
for(let n=0;n<100;n++)gate.process(frame(.8,-20),true);
assert.equal(gate.open,false,'uncalibrated medium model probability must not open broadband noise');assert.equal(gate.floorDbfs,null);
for(let n=0;n<10;n++)gate.process(frame(.01,-60),true);
assert.equal(gate.floorDbfs,-60);gate.process(frame(.8,-45),true);assert.equal(gate.open,false);gate.process(frame(.8,-45),true);assert.equal(gate.open,true);
gate.process(frame(.01,-60),true,30);assert.equal(gate.speech,false,'hangover is not speech');
for(let n=0;n<31;n++)gate.process(frame(.01,-60),true);assert.equal(gate.open,false);
gate.process(frame(.99,-85),true);assert.equal(gate.open,true,'quiet strong speech opens immediately');
const floor=gate.floorDbfs;
for(const blocked of [frame(.01,-20),frame(.01,-100,false),{...frame(.01,-20),valid:false},frame(NaN,-20)]){
 gate.process(blocked,blocked.probability!==.01 || blocked.valid===false);assert.equal(gate.open,false);
 assert.equal(gate.floorDbfs,floor,'blocked/zero/invalid frames do not learn floor');
}
gate.process(frame(.01,-20),true);assert.ok(gate.floorDbfs-floor<.1,'upward floor learning is bounded and slow');
gate.process(frame(.01,-80),true);assert.ok(gate.floorDbfs<floor-3,'floor decreases quickly');
gate.reset();assert.equal(gate.floorDbfs,null);assert.equal(gate.open,false);
console.log('adaptive transmit gate trusted floor, onset, SNR, hangover, hard block and reset checks passed');
