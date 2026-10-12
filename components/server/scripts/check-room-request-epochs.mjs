import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const root=path.resolve(process.argv[2]??new URL('../../../',import.meta.url).pathname);
const source=fs.readFileSync(path.join(root,'components/server/src/socket/handlers/voice.ts'),'utf8');
const compiled=ts.transpileModule(source,{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});assert.equal(compiled.diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};const quiet=new Proxy({}, {get:()=>()=>{}});
function harness(){
 const holds=new Map(),events=[],tokens=[],clientsInfo={},handlers={},sockets={},registration=[];
 const gate=async(phase,room,value)=>{const held=holds.get(phase+':'+room);return held?await held.promise:value;};
 const deps={
  '../utils/voiceRooms':{sfuRoomId:(s,r)=>s+'_'+r,voiceRoomName:(s,r)=>'voice:'+s+':'+r},consola:{default:quiet},'../middleware/auth':{},'../utils/clients':{syncAllClients(){},broadcastMemberList(){}},'../../utils/rateLimiter':{checkRateLimit:()=>({allowed:true})},'../../utils/voiceSeats':{getVoiceSeatLimit:()=>null},'../../db':{isConversationId:()=>false},
  '../utils/standing':{socketIsIdentified:(all,id)=>!!all[id]?.serverUserId,socketMay:async()=>true},'../utils/voiceStash':{beginVoiceRecoveryGrace(){},forgetStashedVoiceState(){},stashedVoiceState:new Map(),applyVoiceState(){}},'../utils/conversationAccess':{DENIAL_RESPONSES:{not_found:{error:'not_found',message:'missing'}},resolveConversationAccess:r=>gate('access',r,{allowed:true,kind:'channel'})},'./calls':{},'../utils/blockedInVoice':{},'../utils/blocking':{},'../utils/callRings':{},'../utils/contactGate':{},'../../services/channelPermissions':{mayInChannel:(r,u,p)=>gate(p,r,true)},'../../sfu/clientToken':{CAP_SPEAK:'speak'},'./voiceMode':{registerVoiceModeHandlers:()=>({})},'../utils/voiceCapabilities':{voiceCapabilities:(r)=>gate('capabilities',r,['speak'])},'../../sfu/audioOnly':{audioOnlyEnabled:()=>true}
 };
 const exports={};vm.runInNewContext(compiled.outputText,{exports,process:{env:{SFU_PUBLIC_HOST:'wss://test.invalid'}},require:name=>{assert.ok(Object.hasOwn(deps,name),'Unexpected '+name);return deps[name];}});
 const io={to:()=>({emit(){}}),sockets:{sockets:new Map()}};
 const add=(id='session-a',user='user-a')=>{const ci={serverUserId:user,grytUserId:'account-'+user,nickname:user,voiceChannelId:'',streamID:'',hasJoinedChannel:false,cameraEnabled:false,screenShareEnabled:false};clientsInfo[id]=ci;
 const socket={id,connected:true,rooms:new Set([id]),emit:(event,payload)=>events.push({id,event,payload}),to:()=>({emit(){}}),leave(room){this.rooms.delete(room);},join(room){this.rooms.add(room);}};sockets[id]=socket;io.sockets.sockets.set(id,socket);
 const sfuClient={isConnected:()=>true,getActiveUsers:()=>new Set(),registerRoom:room=>{registration.push(room);return gate('register',room.replace('stable-server_',''),undefined);},generateClientJoinToken:(room,user,caps,session)=>{tokens.push({room,user,caps,session});return {room_id:room,user_id:user,fixture:true};},untrackUserConnection(){}};
 handlers[id]=exports.registerVoiceHandlers({io,socket,clientId:id,serverId:'stable-server',clientsInfo,sfuClient,getClientIp:()=> '127.0.0.1'});return {ci,socket,events,request:room=>handlers[id]['voice:room:request'](room),leave:()=>handlers[id]['voice:channel:joined'](false),join:()=>handlers[id]['voice:channel:joined'](true),clearStream:()=>handlers[id]['voice:stream:set']('')};};
 const hold=(phase,room)=>{const d=defer();holds.set(phase+':'+room,d);return d;};return {add,hold,events,tokens,clientsInfo,registration};
}
const tests=[];const test=(name,fn)=>tests.push({name,fn});
for(const phase of ['access','join_voice','register','capabilities']) test(`Latest request wins when A waits at ${phase}`,async()=>{
 const h=harness(),a=h.add(),d=h.hold(phase,'room-a');const old=a.request('room-a');await flush();await a.request('room-b');d.resolve(phase==='access'?{allowed:true,kind:'channel'}:phase==='join_voice'?true:phase==='capabilities'?['speak']:undefined);await old;
 assert.equal(a.ci.voiceChannelId,'room-b','old request changed selected room');assert.deepEqual(h.events.filter(x=>x.event==='voice:room:granted').map(x=>x.payload.room_id),['stable-server_room-b'],'old request issued a late grant');
});
for(const action of ['leave','clearStream','disconnect','replace-client','change-identity']) test(`Pending access is retired by ${action}`,async()=>{
 const h=harness(),a=h.add(),d=h.hold('access','room-a');const p=a.request('room-a');await flush();
 if(action==='leave')await a.leave();else if(action==='clearStream')a.clearStream();else if(action==='disconnect')a.socket.connected=false;else if(action==='replace-client')h.clientsInfo['session-a']={...a.ci,serverUserId:'different-user'};else a.ci.serverUserId='different-user';
 d.resolve({allowed:true,kind:'channel'});await p;assert.equal(h.tokens.length,0,'retired request minted a token');assert.ok(!h.events.some(x=>x.event==='voice:room:granted'),'retired request emitted a grant');
});
test('Old request rejection cannot emit an error into the current room request',async()=>{
 const h=harness(),a=h.add(),d=h.hold('access','room-a');const old=a.request('room-a');await flush();await a.request('room-b');d.reject(new Error('old access failure'));await old;assert.ok(!h.events.some(x=>x.event==='voice:room:error'),'old request error leaked to current request');
});
test('Disconnected request rejection has no reply side effect',async()=>{
 const h=harness(),a=h.add(),d=h.hold('access','room-a');const old=a.request('room-a');await flush();a.socket.connected=false;d.reject(new Error('late'));await old;assert.equal(h.events.length,0);
});
test('Cancelling one socket does not retire another socket request',async()=>{
 const h=harness(),a=h.add(),b=h.add('session-b','user-b'),da=h.hold('access','room-a'),db=h.hold('access','room-b');const pa=a.request('room-a'),pb=b.request('room-b');await flush();await a.leave();da.resolve({allowed:true,kind:'channel'});db.resolve({allowed:true,kind:'channel'});await Promise.all([pa,pb]);assert.deepEqual(h.tokens.map(x=>x.session),['session-b']);assert.equal(b.ci.voiceChannelId,'room-b');
});
test('Current valid grant retains exact user, session and capabilities',async()=>{
 const h=harness(),a=h.add();await a.request('room-a');assert.equal(h.tokens.length,1);assert.equal(h.tokens[0].user,'user-a');assert.equal(h.tokens[0].session,'session-a');assert.deepEqual(Array.from(h.tokens[0].caps),['speak']);assert.equal(a.ci.voiceChannelId,'room-a');
});
for(const action of ['leave','new-request','disconnect','change-identity']) test(`Delayed joined announcement is retired by ${action}`,async()=>{
 const h=harness(),a=h.add();a.ci.voiceChannelId='room-a';const d=h.hold('join_voice','room-a'),joining=a.join();await flush();
 if(action==='leave')await a.leave();else if(action==='new-request')await a.request('room-b');else if(action==='disconnect')a.socket.connected=false;else a.ci.serverUserId='different-user';
 d.resolve(true);await joining;assert.equal(a.ci.hasJoinedChannel,false,'stale joined=true restored presence');assert.ok(!a.socket.rooms.has('voice:stable-server:room-a'),'stale announcement joined the old socket room');
});
const results=[];for(const {name,fn}of tests){try{await fn();console.log('PASS '+name);results.push({name,pass:true});}catch(error){console.log('FAIL '+name+': '+error.message);results.push({name,pass:false,error:error.message});}}console.log(JSON.stringify({sourceRoot:root,checks:results.length,passed:results.filter(x=>x.pass).length,results},null,2));if(results.some(x=>!x.pass))process.exitCode=1;
