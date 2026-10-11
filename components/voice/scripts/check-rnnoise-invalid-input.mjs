import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import ts from 'typescript';
import os from 'node:os';try{os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
globalThis.window={};globalThis.self={postMessage(){}};
const source=ts.transpileModule(readFileSync('src/audio/processors/rnnoiseWorker.ts','utf8')+'\nexport {init,processFrame};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
 .replace("'@shiguredo/rnnoise-wasm'",JSON.stringify(import.meta.resolve('@shiguredo/rnnoise-wasm')));
const api=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
await api.init();const replies=[];const port={postMessage(v){replies.push(v);}};
const invalid=new Float32Array(480);invalid[3]=NaN;invalid[20]=Infinity;api.processFrame(invalid,port,0);
assert.equal(replies.at(-1).type,'fault');assert.equal(replies.at(-1).reason,'rnnoise-nonfinite-input');
assert.ok(invalid.every(Number.isFinite));
await api.init();const bytes=readFileSync('third-party/receive-rnn/fixtures/samples.pcm'),pcm=new Int16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2);
let trusted=0;for(let n=0;n<800;n++){const frame=new Float32Array(480);for(let i=0;i<480;i++)frame[i]=pcm[(n*480+i)%pcm.length]/32768*.1;
 api.processFrame(frame,port,0);const reply=replies.at(-1);assert.equal(reply.type,'processed');assert.equal(reply.valid,true);assert.ok(frame.every(Number.isFinite));if(reply.probability>=.95)trusted++;}
assert.ok(trusted>0);self.onmessage({data:{type:'destroy'}});
const result={nonfiniteInputSanitized:true,explicitFault:'rnnoise-nonfinite-input',realModelFreshInitRecovery:true,trustedFrames:trusted,destroySent:true,
 note:'Real installed RNNoise WASM and production worker processFrame; no browser, microphone or network.'};
writeFileSync('rnnoise-invalid-input-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
