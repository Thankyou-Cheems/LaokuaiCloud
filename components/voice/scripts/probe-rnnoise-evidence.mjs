import {readFileSync,writeFileSync} from 'node:fs';
import os from 'node:os';
try{os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
// This bundle's environment check accepts web/worker only; no browser/device APIs are used by its embedded WASM loader.
globalThis.window={};
const {Rnnoise}=await import('@shiguredo/rnnoise-wasm');
const model=await Rnnoise.load();const frame=new Float32Array(model.frameSize);
const bytes=readFileSync('third-party/receive-rnn/fixtures/samples.pcm');
const pcm=new Int16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2);
const rows=[];
for(const kind of ['impulse','public-speech','seeded-noise']){
  const state=model.createDenoiseState();let seed=42;
  const input=new Float32Array(48000*8),output=new Float32Array(48000*8),probabilities=[];
  for(let f=0;f<800;f++){
    for(let i=0;i<480;i++){
      const index=f*480+i;
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      input[index]=kind==='impulse'?(index===5040?.5:0):kind==='public-speech'?pcm[index%pcm.length]/32768*.1:(seed/2**32*2-1)*.02;
      frame[i]=input[index]*32768;
    }
    const probability=state.processFrame(frame);probabilities.push(probability);
    for(let i=0;i<480;i++)output[f*480+i]=frame[i]/32768;
  }
  let peak=0,peakAt=0,firstNonzero=-1;
  for(let i=0;i<output.length;i++){if(firstNonzero<0&&Math.abs(output[i])>1e-8)firstNonzero=i;if(Math.abs(output[i])>peak){peak=Math.abs(output[i]);peakAt=i;}}
  rows.push({kind,maxProbability:Math.max(...probabilities),trustedFrames:probabilities.filter(x=>x>=.95).length, candidateFrames:probabilities.filter(x=>x>=.5).length,
    peak,peakAt,firstNonzero,impulseInputAt:kind==='impulse'?5040:undefined,
    impulsePeakDelaySamples:kind==='impulse'?peakAt-5040:undefined,probabilities:kind==='impulse'?probabilities.slice(8,15):undefined});
  state.destroy();
}
const result={rnnoiseVersion:'2025.1.5',rate:48000,frameSize:model.frameSize,heapBytes:model.rnnoiseModule.HEAPF32.buffer.byteLength,
  rows,note:'Real installed embedded RNNoise WASM, environment check stub only, no device/browser/API/network. Node fixture, not deadline or sound-quality certification.'};
writeFileSync('rnnoise-evidence-probe-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));

