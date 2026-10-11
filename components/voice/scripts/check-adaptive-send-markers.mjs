import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import os from 'node:os';try{os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
const load=async path=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
const {TRANSMIT_SPEECH_CORE_CODE}=await load('src/audio/processors/transmitSpeechCode.ts');
const {RNNOISE_WORKLET_CODE}=await load('src/audio/processors/rnnoiseProcessor.ts');
const {TRANSMIT_CAPTURE_CODE}=await load('src/audio/processors/transmitCaptureProcessor.ts');
const gateSource=readFileSync('src/audio/processors/noiseGateProcessor.ts','utf8').replace(/^import[^\n]*\n/,'const TRANSMIT_SPEECH_CORE_CODE='+JSON.stringify(TRANSMIT_SPEECH_CORE_CODE)+';\n');
const {NOISE_GATE_WORKLET_CODE}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(gateSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
const classes=new Map();const context=vm.createContext({Float32Array,WebAssembly,Math,Number,Array,console,sampleRate:48000,currentFrame:0,currentTime:0,
 AudioWorkletProcessor:class{constructor(){this.port={sent:[],postMessage(v){this.sent.push(v)},close(){}};}},registerProcessor:(name,cls)=>classes.set(name,cls)});
vm.runInContext(RNNOISE_WORKLET_CODE+NOISE_GATE_WORKLET_CODE+TRANSMIT_CAPTURE_CODE,context);
const RN=classes.get('rnnoise-processor'),rn=new RN({});rn.port.onmessage({data:{type:'enable',enabled:true}});
const workerPort={sent:[],postMessage(v){this.sent.push(v)}};rn.port.onmessage({data:{type:'worker-port'},ports:[workerPort]});
const zeros=new Float32Array(128),out=new Float32Array(128),carrier=Array.from({length:4},()=>new Float32Array(128));
const params={allowed:[1],evidenceEnabled:[1]};
workerPort.onmessage({data:{type:'processed',frame:new Float32Array(480).fill(.25).buffer,generation:0,probability:.99,rmsDbfs:-12,valid:true,sequence:7}});
for(let b=0;b<4;b++){out.fill(9);rn.process([[zeros]],[[out],carrier],params);for(let i=0;i<128;i++){const valid=b*128+i<480;assert.equal(out[i],valid?.25:0);assert.equal(carrier[2][i],valid?1:0);assert.equal(carrier[3][i],valid?7:0);}}
rn.process([[zeros]],[[out],carrier],{allowed:[0],evidenceEnabled:[1]});assert.ok(out.every(x=>x===0));assert.ok(carrier[2].every(x=>x===0));
workerPort.onmessage({data:{type:'processed',frame:new Float32Array(480).fill(.8).buffer,generation:0,probability:1,rmsDbfs:-2,valid:true,sequence:8}});assert.equal(rn._outQ.length,0,'old generation discarded');
workerPort.onmessage({data:{type:'reset-ack',generation:rn._generation}});
const Gate=classes.get('noise-gate-processor'),gate=new Gate({}),audio=new Float32Array(128),gcarrier=[new Float32Array(128),new Float32Array(128)];
const evidence=[new Float32Array(128).fill(.99),new Float32Array(128).fill(-20),new Float32Array(128).fill(1),new Float32Array(128).fill(1)];
const gp={threshold:[0],release:[200],smoothing:[.8],automatic:[1],eligible:[1],evidenceEnabled:[1]};
gate.process([[new Float32Array(128).fill(2)],[],evidence],[[audio],gcarrier],gp);
assert.ok(audio.every(x=>Math.abs(x)<=Math.fround(10**(-1/20))));assert.ok(gcarrier[0].every(x=>x===1));
const Boundary=classes.get('gryt-transmission-boundary-v1'),boundary=new Boundary(),published=new Float32Array(128);
boundary.port.onmessage({data:{revision:1,blocked:false,speechEligible:true,speechEnabled:true}});boundary.process([[audio],gcarrier],[[published]]);
assert.deepEqual(published,audio);assert.equal(boundary.port.sent.find(x=>x.type==='speech').speaking,true);
boundary.port.onmessage({data:{revision:2,blocked:true,speechEligible:false,speechEnabled:true}});boundary.process([[audio],gcarrier],[[published]]);
assert.ok(published.every(x=>x===0));assert.equal(boundary.port.sent.filter(x=>x.type==='speech').at(-1).speaking,false);
const rnRace=new RN({});rnRace.port.onmessage({data:{type:'enable',enabled:true}});rnRace.process([[zeros]],[[out],carrier],{allowed:[0],evidenceEnabled:[1]});
const latePort={sent:[],postMessage(v){this.sent.push(v)}};rnRace.port.onmessage({data:{type:'worker-port'},ports:[latePort]});assert.equal(latePort.sent[0].type,'reset','pending reset delivered after channel attachment');
const rows={rnnoiseCarrierExact480Samples:true,underrunZeroCarrier:true,oldGenerationRejected:true,finalGateSpeechAndPcmAligned:true,
 hardBoundaryZeroAndFalse:true,finiteClampMinus1Dbfs:true,pendingResetPortRace:true};
writeFileSync('adaptive-send-marker-results.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2));

const {RECEIVE_ANALYZER_BASE64}=await load('src/audio/processors/receiveAnalyzerAsset.ts');
const evidenceSource=readFileSync('src/audio/processors/transmitSpeechProcessor.ts','utf8').replace(/^import[^\n]*\n/gm,'');
const eprefix='const RECEIVE_ANALYZER_BASE64='+JSON.stringify(RECEIVE_ANALYZER_BASE64)+';const TRANSMIT_SPEECH_CORE_CODE='+JSON.stringify(TRANSMIT_SPEECH_CORE_CODE)+';';
const {TRANSMIT_EVIDENCE_CODE}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(eprefix+evidenceSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
const analyzerModule=await WebAssembly.compile(Buffer.from(RECEIVE_ANALYZER_BASE64,'base64'));
const pcmBytes=readFileSync('third-party/receive-rnn/fixtures/samples.pcm');const publicPcm=new Int16Array(pcmBytes.buffer,pcmBytes.byteOffset,pcmBytes.byteLength/2);
const fallback=[];
for(const rate of [44100,48000]){
 let Klass;const ctx=vm.createContext({Float32Array,WebAssembly,Math,Number,Array,console,sampleRate:rate,currentFrame:0,currentTime:0,
  AudioWorkletProcessor:class{constructor(){this.port={postMessage(){},close(){}};}},registerProcessor:(name,cls)=>Klass=cls});
 vm.runInContext(TRANSMIT_EVIDENCE_CODE,ctx);const instance=new Klass({processorOptions:{analyzerModule}});
 const size=rate/100,input=new Float32Array(Math.ceil(rate*2/128)*128),rendered=new Float32Array(input.length);
 for(let i=0;i<input.length;i++)input[i]=publicPcm[Math.floor(i*48000/rate)%publicPcm.length]/32768*.1;
 let paired=0;
 for(let at=0;at<input.length;at+=128){const audio=new Float32Array(128),ev=Array.from({length:4},()=>new Float32Array(128));
  instance.process([[input.subarray(at,at+128)]],[[audio],ev],{allowed:[1]});rendered.set(audio,at);
  for(let i=0;i<128;i++){const index=at+i;assert.equal(audio[i],index>=size?input[index-size]:0);assert.equal(ev[2][i],index>=size?1:0);if(index>=size){assert.equal(ev[3][i],Math.floor((index-size)/size)+1);paired++;}}
 }
 instance.port.onmessage({data:'reset-history'});assert.equal(instance.ready,false);assert.equal(instance.at,0);
 instance.port.onmessage({data:'dispose'});assert.equal(instance.handle,0);assert.equal(instance.process([[]],[[new Float32Array(128)],[]],{allowed:[1]}),false);
 fallback.push({rate,pairedSamples:paired,exactPcmParity:true,knownDelaySamples:size,handleDestroyed:true});
}
writeFileSync('adaptive-send-marker-results.json',JSON.stringify({...rows,fallback},null,2));console.log(JSON.stringify({fallback},null,2));
