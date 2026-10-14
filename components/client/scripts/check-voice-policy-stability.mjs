import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
function load(source,deps){const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:name=>{assert.ok(name in deps || (name.endsWith("/voiceFacade") && "@gryt/voice" in deps));return name.endsWith("/voiceFacade") ? deps["@gryt/voice"] : deps[name];}});return exports;}
const policy=load(fs.readFileSync(path.join(root,'src/lib/pureVoicePolicy.ts'),'utf8'),{});
function harness(source){
 const sfu={currentServerConnected:'fixture-server',currentChannelConnected:'fixture-room',isConnected:false};
 const own={serverUserId:'fixture-self',voiceChannelId:'fixture-room',hasJoinedChannel:true,streamID:''};
 const peer={serverUserId:'fixture-peer',voiceChannelId:'fixture-room',hasJoinedChannel:true,streamID:'fixture-remote'};
 const socket={connected:true,id:'fixture-socket'};
 const sockets={sockets:{'fixture-server':socket},clients:{'fixture-server':{'fixture-socket':own,peer}},serverDetailsList:{'fixture-server':{channels:[{id:'fixture-room',myPermissions:['speak']}],server_info:{}}}};
 const deps={'@gryt/voice':{useSFU:()=>sfu},react:{useMemo:fn=>fn()},'@/settings':{useSettings:()=>({})},'@/socket':{useSockets:()=>sockets},'../../../../lib/pureVoicePolicy':policy,'../../../../lib/squadRuntime':{useSquadGateEnabled:()=>false},'../../../../lib/voiceTransportPreset':{voicePresetCodec:()=>({})}};
 const config=load(source,deps).useVoiceConfigFromSettings;
 const key=()=>JSON.stringify(config([]).connection.receiveMicrophoneStreamIds);
 return {sfu,own,peer,socket,key};
}
const relative='components/client/src/packages/webRTC/src/adapters/voiceConfig.ts';
const baseline=harness(execFileSync('git',['show','701200d0:'+relative],{cwd:path.resolve(root,'../..'),encoding:'utf8'}));
const before=baseline.key();baseline.sfu.isConnected=true;assert.notEqual(baseline.key(),before,'old media state must reproduce the policy transition');
const fixed=harness(fs.readFileSync(path.join(root,'src/packages/webRTC/src/adapters/voiceConfig.ts'),'utf8'));
const stable=fixed.key();assert.equal(stable,'["fixture-remote"]');
fixed.sfu.isConnected=true;assert.equal(fixed.key(),stable);
fixed.own.streamID='fixture-local-1';assert.equal(fixed.key(),stable);
fixed.sfu.isConnected=false;fixed.own.streamID='fixture-local-2';assert.equal(fixed.key(),stable);
fixed.peer.voiceChannelId='another-room';assert.equal(fixed.key(),'[]');
fixed.peer.voiceChannelId='fixture-room';fixed.socket.connected=false;assert.equal(fixed.key(),'[]');
fixed.socket.connected=true;fixed.own.serverUserId=undefined;assert.equal(fixed.key(),'[]');
console.log('PASS: old media-state feedback reproduced; connect/reconnect/local publication stable; cross-room and unauthenticated receive denied');
