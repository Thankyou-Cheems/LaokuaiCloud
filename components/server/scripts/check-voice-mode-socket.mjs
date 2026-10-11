import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import ts from 'typescript';

const code=ts.transpileModule(readFileSync('src/socket/handlers/voiceMode.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports={};vm.runInNewContext(code,{exports,Date,Map,WeakMap,Set,Number,JSON,Object});
const http=createServer();const io=new Server(http,{serveClient:false});
let clock=1000,checks=0;
const peers={},sessions=new Map(),clients=[];
const roomFor=id=>`fixture-server:voice:${id}`;
io.on('connection',socket=>{
  const name=String(socket.handshake.auth.name), room=String(socket.handshake.auth.room);
  peers[socket.id]={serverUserId:name,hasJoinedChannel:true,voiceChannelId:room,streamID:`mic-${socket.id}`};
  sessions.set(name,socket);socket.join(roomFor(room));
  const handlers=exports.registerVoiceModeHandlers({socket,io,clientsInfo:peers,clientId:socket.id,roomFor,identified:()=>name!=='anonymous',now:()=>clock});
  for(const [event,handler] of Object.entries(handlers)) socket.on(event,handler);
  socket.on('disconnect',()=>{delete peers[socket.id];sessions.delete(name);});
});
await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${http.address().port}`;
async function open(name,room='one'){const client=connect(url,{auth:{name,room},transports:['websocket'],reconnection:false});clients.push(client);await new Promise((resolve,reject)=>{client.once('connect',resolve);client.once('connect_error',reject);});return client;}
const request=(client,event,value={})=>new Promise((resolve,reject)=>client.timeout(2000).emit(event,value,(error,result)=>error?reject(error):resolve(result)));
const check=(name,fn)=>Promise.resolve(fn()).then(()=>{checks++;console.log(`PASS ${name}`);});
const base={v:1,seq:1,inputMode:'voice_activity',squad:'standby',transmit:'normal'};
try {
 const alice=await open('fixture-alice'),bob=await open('fixture-bob'),foreign=await open('fixture-foreign','two'),old=await open('fixture-old');
 const bobEvents=[],foreignEvents=[];bob.on('voice:mode',v=>bobEvents.push(v));foreign.on('voice:mode',v=>foreignEvents.push(v));
 await check('capability negotiation actual Socket.IO ACK',async()=>assert.deepEqual(await request(alice,'voice:mode:capabilities'),{v:1,supported:true}));
 await check('private metadata and spoofed identity rejected',async()=>{for(const field of ['keys','path','process','events','serverUserId']) assert.equal((await request(alice,'voice:mode:set',{...base,[field]:'private'})).accepted,false);});
 await check('same-room exchange and semantic boundary state',async()=>{assert.equal((await request(alice,'voice:mode:set',base)).accepted,true);await request(bob,'voice:mode:fetch');assert.equal(bobEvents.at(-1).serverUserId,'fixture-alice');assert.deepEqual(bobEvents.at(-1).state,base);assert.equal(foreignEvents.length,0);});
 await check('old client without metadata retains channel membership',async()=>{assert.equal(peers[old.id].hasJoinedChannel,true);assert.equal(peers[old.id].voiceChannelId,'one');assert.equal((await request(old,'voice:mode:fetch')).length,1);});
 await check('out-of-order state refused',async()=>assert.equal((await request(alice,'voice:mode:set',base)).accepted,false));
 await check('manual priority semantic travels without mute mutation',async()=>{clock+=600;const state={...base,seq:2,squad:'suppressed',transmit:'manual-muted'};const received=new Promise(resolve=>bob.once('voice:mode',resolve));await request(alice,'voice:mode:set',state);assert.equal((await received).state.transmit,'manual-muted');assert.equal(peers[alice.id].isMuted,undefined);});
 await check('foreign channel fetch empty',async()=>assert.deepEqual(await request(foreign,'voice:mode:fetch'),[]));
 await check('burst and fetch throttles',async()=>{for(let seq=3;seq<=12;seq++) await request(alice,'voice:mode:set',{...base,seq});assert.equal((await request(alice,'voice:mode:set',{...base,seq:13})).accepted,false);await request(bob,'voice:mode:fetch');assert.deepEqual(await request(bob,'voice:mode:fetch'),[]);});
 await check('stream replacement invalidates stale semantics',async()=>{peers[alice.id].streamID='fixture-replaced';clock+=1000;assert.deepEqual(await request(bob,'voice:mode:fetch'),[]);});
 await check('heartbeat after replacement restores only new semantics',async()=>{await request(alice,'voice:mode:set',{...base,seq:14,transmit:'resuming'});clock+=300;assert.equal((await request(bob,'voice:mode:fetch')).at(-1).state.transmit,'resuming');});
 await check('TTL expiry',async()=>{clock+=8001;assert.deepEqual(await request(bob,'voice:mode:fetch'),[]);});
 await check('leave invalidates fetch',async()=>{peers[alice.id].hasJoinedChannel=false;await request(alice,'voice:mode:set',{...base,seq:15});clock+=300;assert.deepEqual(await request(bob,'voice:mode:fetch'),[]);});
 await check('anonymous cannot publish',async()=>{const anonymous=await open('anonymous');assert.equal((await request(anonymous,'voice:mode:set',base)).accepted,false);});
 await check('disconnect cleanup and new socket sequence reset',async()=>{const oldId=alice.id;alice.disconnect();await request(bob,'voice:mode:capabilities');assert.equal(peers[oldId],undefined);const fresh=await open('fixture-alice');assert.equal((await request(fresh,'voice:mode:set',base)).accepted,true);clock+=300;assert.equal((await request(bob,'voice:mode:fetch')).at(-1).clientId,fresh.id);});
 await check('non-callback packet harmless',async()=>{bob.emit('voice:mode:capabilities',{},'not-a-function');assert.equal((await request(bob,'voice:mode:capabilities')).supported,true);});
 writeFileSync('voice-mode-socket-evidence.json',JSON.stringify({checks,transport:'actual Socket.IO websocket on loopback',syntheticIdentities:true,realServerAuthentication:false,databaseOpened:false,realMicrophoneOpened:false,productionConnected:false},null,2));
} finally {for(const client of clients)client.disconnect();await new Promise(resolve=>io.close(resolve));}
