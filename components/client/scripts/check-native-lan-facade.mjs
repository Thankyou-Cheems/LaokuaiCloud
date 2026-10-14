import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../src/lib/voiceFacade.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const forbidden=()=>{throw new Error('SDK hook must not execute in native branch');};
const native={sfu:{marker:'native'},microphone:{marker:'native'},speakers:{marker:'native'},status:{phase:'idle'}};
const exports={};vm.runInNewContext(compiled,{exports,window:{electronAPI:{nativeLanVoiceEnabled:true}},require:name=>{
  if(name==='@gryt/voice')return {useSFU:forbidden,useMicrophone:forbidden,useSpeakers:forbidden,useVoiceLatency:forbidden};
  if(name==='react')return {createContext:initial=>({initial}),useContext:()=>native};
  throw new Error(name);
}});
assert.equal(exports.nativeVoiceEnabled,true);
assert.equal(exports.useSFU(),native.sfu);assert.equal(exports.useMicrophone(false),native.microphone);assert.equal(exports.useSpeakers(),native.speakers);
for(const enabled of [false,true]) {
  const latency=exports.useVoiceLatency(enabled);assert.equal(latency.latency.networkRttMs,null);assert.equal(latency.latency.sfuEndpoint,null);assert.match(latency.modeLabel,/尚未测量/);
}
assert.equal(exports.useNativeAudioStatus(),native.status);
console.log('Native facade: SDK audio/SFU/latency hooks never execute, independent native context and explicitly unmeasured latency passed.');
