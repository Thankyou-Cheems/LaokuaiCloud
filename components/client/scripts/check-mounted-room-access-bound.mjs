import {coordinatorTestDependency} from "./room-coordinator-test-deps.mjs";
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]??new URL('../../../',import.meta.url).pathname),sdk=path.join(root,'components/voice');
const require=createRequire(path.join(root,'components/client/package.json')),ts=require('typescript');
const {advance,fakePhonePlatform,log,mountEngine,settle,voiceConfig}=await import(pathToFileURL(path.join(sdk,'scripts/engine-harness.mjs')));
const {VoiceConfigProvider}=await import(pathToFileURL(path.join(sdk,'dist/config/index.js')));
const {setVoicePlatform}=await import(pathToFileURL(path.join(sdk,'dist/platform/index.js')));
const {VoiceSingletonHooks}=await import(pathToFileURL(path.join(sdk,'dist/shared/SingletonHooks.js')));
const {useSFU}=await import(pathToFileURL(path.join(sdk,'dist/webrtc/hooks/useSFU.js')));
const input=fs.readFileSync(path.join(root,'components/client/src/packages/webRTC/src/adapters/roomCoordinator.ts'),'utf8');
const {outputText}=ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
async function run(cancelFirst){
 const exports={};vm.runInNewContext(outputText,{exports,setTimeout,clearTimeout,require:coordinatorTestDependency});
 const socket=new EventEmitter();socket.connected=true;socket.id='session-a';let requests=[];
 socket.on('voice:room:request',channel=>{requests.push(channel);if(channel==='denied')queueMicrotask(()=>socket.emit('voice:room:error',{error:'forbidden',message:'Cannot join'}));});
 const room=exports.createRoomCoordinator(socket,'server-a',undefined,'stable-server');room.onReconnected=()=>()=>{};
 setVoicePlatform(fakePhonePlatform());const engine=await mountEngine({provider:VoiceConfigProvider,runner:VoiceSingletonHooks,read:()=>useSFU(),config:voiceConfig({stunHosts:['stun:a.test']}),target:{id:'server-a',room}});
 const phases=[];try{
  if(cancelFirst){let first;await settle(()=>{first=engine.current.connect('pending').catch(()=>{});});await advance(1000);assert.equal(requests.length,1);await settle(()=>engine.current.disconnect());await advance(100);await first;requests=[];}
  let pending;await settle(()=>{pending=engine.current.connect('denied').catch(()=>{});});
  let elapsed=0;for(const step of [1000,14000,15000,90000,10000]){await advance(step);elapsed+=step;phases.push({elapsed,requests:requests.length,state:engine.current.connectionState,error:engine.current.connectionError});}
  await pending;for(const event of ['voice:room:granted','voice:room:error','disconnect'])assert.equal(socket.listenerCount(event),event==="voice:room:error"?1:0,'pending request listener leaked');const result={cancelFirst,phases,finalRequests:requests.length,finalState:engine.current.connectionState,finalError:engine.current.connectionError};
  if(cancelFirst){assert.equal(phases[0].state,'connecting');assert.equal(phases[1].state,'disconnected');assert.equal(requests.length,1);assert.equal(result.finalError,'Room access could not be confirmed. Please try joining again.');}else{assert.equal(phases[0].state,'disconnected');assert.equal(requests.length,1);assert.equal(result.finalError,'Cannot join');}return result;
 }finally{await engine.unmount();}
}
log(JSON.stringify({sourceRoot:root,results:[await run(false),await run(true)]},null,2));
