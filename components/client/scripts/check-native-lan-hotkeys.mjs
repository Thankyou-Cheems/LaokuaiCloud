import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as hotkeys from '../src/lib/hotkeys.ts';
const effects=[],events=new Map(),gates=[],bindings=[];
const source=readFileSync(new URL('../src/packages/audio/src/hooks/useGlobalHotkeys.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const prefs={inputMode:'voice_activity',pushToTalkKey:'KeyV',muteHotkey:'',deafenHotkey:'',disconnectHotkey:''};
const imports={react:{useCallback:fn=>fn,useEffect:fn=>effects.push(fn),useRef:initial=>({current:initial}),useState:initial=>[initial,()=>{}]},
  'react-hot-toast':{default(){}},'@/settings':{useSettings:()=>prefs},'@/i18n':{i18n:{t:key=>key}},'@/socket/src/utils/socketHookMessages':{socketHookToast:fn=>fn()},
  '@/webRTC/src/components/EffectiveVoicePolicy':{useEffectiveVoicePolicy:()=>({requiredPushToTalk:true})},
  '../../../../lib/electron':{isElectron:()=>true,getElectronAPI:()=>({setHotkeys:async value=>{bindings.push(value);return false;}})},
  '../../../../lib/hotkeys':hotkeys,'../../../../lib/icons':{},'../../../../lib/voiceFacade':{useMicrophone:()=>({setPushToTalkActive:held=>gates.push(held)})}};
const exports={};vm.runInNewContext(compiled,{exports,console:{log(){}},document:{activeElement:null},window:{addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)},require:name=>{assert.ok(name in imports,name);return imports[name];}});
exports.useGlobalHotkeys();const cleanup=effects.map(fn=>fn());
assert.equal(bindings[0].ptt,'KeyV','required PTT registers saved key even with saved voice activity preference');
const event={code:'KeyV',ctrlKey:false,shiftKey:false,altKey:false,metaKey:false,preventDefault(){}};
events.get('keydown')(event);events.get('keyup')(event);
assert.deepEqual(gates,[true,false]);assert.equal(prefs.inputMode,'voice_activity');
events.get('keydown')(event);events.get('blur')();assert.deepEqual(gates,[true,false,true,false]);
cleanup.forEach(fn=>typeof fn==='function'&&fn());
console.log('Production forced PTT hotkey registration, key press/release, blur close and saved voice-activity preference passed; fake keyboard/IPC.');
