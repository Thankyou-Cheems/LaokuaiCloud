import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const root=path.resolve(process.argv[2]??new URL('../../../',import.meta.url).pathname);
const source=rel=>fs.readFileSync(path.join(root,'components/voice',rel),'utf8');
const quiet=new Proxy({}, {get:()=>()=>{}});
function compileText(text,deps={},globals={}) {
 const result=ts.transpileModule(text,{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
 assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 const exports={};vm.runInNewContext(result.outputText,{exports,console:quiet,...globals,require:key=>{assert.ok(Object.hasOwn(deps,key),`Unexpected dependency ${key}`);return deps[key];}});return exports;
}
const compile=(rel,deps,globals)=>compileText(source(rel),deps,globals);
function callback(name){const tree=ts.createSourceFile('useSFU.ts',source('src/webrtc/hooks/useSFU.ts'),ts.ScriptTarget.Latest,true);let found;const visit=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(tree)===name)found=n.initializer.arguments[0].getText(tree);ts.forEachChild(n,visit);};visit(tree);assert.ok(found);return found;}
function effect(marker){const tree=ts.createSourceFile('useSFU.ts',source('src/webrtc/hooks/useSFU.ts'),ts.ScriptTarget.Latest,true);let found;const visit=n=>{if(ts.isCallExpression(n)&&n.expression.getText(tree)==='useEffect'&&n.arguments[0].getText(tree).includes(marker))found=n.arguments[0].getText(tree);ts.forEachChild(n,visit);};visit(tree);assert.ok(found);return found;}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function harness({realSocket=false}={}){
 let now=0,nextTimer=0;const timers=new Map(),peers=[],sockets=[],pendingSockets=[];let socketHold=false;
 const setTimeout=(fn,ms=0)=>{const id=++nextTimer;timers.set(id,{fn,at:now+ms});return id;};
 const clearTimeout=id=>timers.delete(id);
 const advance=async ms=>{const end=now+ms;await flush();for(;;){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;timers.delete(due[0]);now=due[1].at;due[1].fn();await flush();}now=end;};
 const track=(id,kind='audio')=>({id,kind,readyState:'live',enabled:true,stop(){this.readyState='ended';},end(){this.readyState='ended';this.onended?.();}});
 const stream=(id,tracks=[track(id+'-track')])=>({id,getTracks:()=>tracks,getAudioTracks:()=>tracks.filter(t=>t.kind==='audio'),getVideoTracks:()=>tracks.filter(t=>t.kind==='video')});
 class FakeSocket { static OPEN=1;static CONNECTING=0;constructor(){this.readyState=1;this.sent=[];sockets.push(this);}send(x){this.sent.push(x);}close(){this.readyState=3;} }
 const globals={setTimeout,clearTimeout,setInterval:setTimeout,clearInterval:clearTimeout,WebSocket:FakeSocket,MediaStream:class {constructor(tracks){Object.assign(this,stream('wrapped',tracks));}}};
 const types=compile('src/webrtc/types/SFU.ts',{},globals), progress=compile('src/webrtc/hooks/connectionProgress.ts',{'../types/SFU':types},globals), flowTypes=compile('src/webrtc/hooks/sfuTypes.ts',{},globals);
 const platform={createPeerConnection(){const pc={connectionState:'new',signalingState:'stable',iceConnectionState:'new',remoteDescription:null,senders:[],getStats:()=>Promise.resolve(new Map()),createDataChannel:()=>({}),restartIce(){},close(){this.connectionState='closed';this.signalingState='closed';},removeTrack(){},addTrack(track){const sender={track,getParameters:()=>({}),setParameters:()=>Promise.resolve()};this.senders.push(sender);return sender;}};peers.push(pc);return pc;}};
 const realConnector=compile('src/webrtc/hooks/sfuConnection.ts',{'../../shared/mediaPolicy':{isAudioOnly:()=>false,restrictMediaSdp:x=>x,applyPeerMediaPolicy(){}},'./videoDemand':{parseVideoWanted:()=>null},'./voiceLogger':{voiceLog:quiet},'./microphoneCodec':{}},globals);
 const flow=compile('src/webrtc/hooks/sfuConnectFlow.ts',{
  '../../shared/mediaPolicy':{isAudioOnly:()=>false,microphoneReceiveAllowed:()=>true},'../../platform':{getVoicePlatform:()=>platform},'../types/SFU':types,'./connectionProgress':progress,
  './selectBestSfuUrl':{getCachedSfuUrl:()=> 'wss://test.invalid',selectBestSfuUrl:async()=> 'wss://test.invalid'},
  './sfuConnection':realSocket?realConnector:{connectToSfuWebSocket:()=>{const socket=new FakeSocket();if(socketHold){const d=deferred();pendingSockets.push({...d,socket});return d.promise;}return Promise.resolve(socket);}},
  './sfuTypes':flowTypes,'./voiceLogger':{voiceLog:quiet},'./microphoneCodec':{snapshotMicrophoneCodec:x=>x,applyMicrophoneCodec:async()=>({})}
 },globals);
 const cleanup=compile('src/webrtc/hooks/sfuCleanup.ts',{'./voiceLogger':{voiceLog:quiet}},globals);
 const ref=current=>({current});const refs={peerConnectionRef:ref(null),sfuWebSocketRef:ref(null),sfuDisposeRef:ref(null),registeredTracksRef:ref([]),reconnectAttemptRef:ref(null),connectionTimeoutRef:ref(null),isDisconnectingRef:ref(false),isConnectingRef:ref(false),previousRemoteStreamsRef:ref(new Set()),announcedStreamIdRef:ref(null),microphoneBufferRef:ref({processedStream:stream('local')}),micAcquiringRef:ref(false),activeSfuUrlRef:ref(null)};
 let state={state:'disconnected',roomId:null,serverId:null,error:null,callAloneTimeoutSeconds:null}, streams={},sources={};const announcements=[],accesses=[],recoveries=[];let grantHold=true,reconnected;
 const room={onReconnected(fn){reconnected=fn;return ()=>reconnected=null;},requestAccess(channel){const d=deferred();accesses.push({channel,...d});return grantHold?d.promise:Promise.resolve({granted:true,roomId:channel,sfuUrls:['wss://test.invalid'],joinToken:'fake'});},setLocalStream:id=>announcements.push(['stream',id]),announceJoined:joined=>announcements.push(['joined',joined]),leave:()=>announcements.push(['leave'])};
 const setConnectionState=x=>state=typeof x==='function'?x(state):x,setStreams=x=>streams=typeof x==='function'?x(streams):x,setStreamSources=x=>sources=typeof x==='function'?x(sources):x;
 const performCleanup=skip=>cleanup.performSfuCleanup(refs,{room,setStreams,setStreamSources},skip);
 const connectSeqRef=ref(0), intentionalDisconnectRef=ref(false), reconnectTimerRef=ref(null), reconnectAttemptsRef=ref(0), moveControllerRef=ref(null);
 const {tearDown}=compileText('exports.tearDown = '+callback('tearDown'),{}, {...globals,...refs,connectSeqRef,intentionalDisconnectRef,reconnectTimerRef,reconnectAttemptsRef,moveControllerRef,setConnectionState,setStreamSources,performCleanup,SFUConnectionState:types.SFUConnectionState});
  const globalsForHook={...globals,...refs,room,connectSeqRef,intentionalDisconnectRef,reconnectTimerRef,reconnectAttemptsRef,moveControllerRef,setConnectionState,setStreamSources,performCleanup,SFUConnectionState:types.SFUConnectionState,REANNOUNCE_BACKOFF_MS:[0,2000,5000]};
 const {reannouncePresence}=compileText('exports.reannouncePresence = '+callback('reannouncePresence'),{},globalsForHook);
 const lastChannelIdRef=ref('room-a'),activeCallRef=ref({target:{id:'host',room},stunHosts:['stun:test.invalid']}),lastChannelSettingsRef=ref({});
 const connectionStateRef={get current(){return state;}},connectRef=ref(async(channel)=>{recoveries.push(channel);connectSeqRef.current++;});
 const {installRecovery}=compileText('exports.installRecovery = '+effect('const handleServerReconnected'),{}, {...globalsForHook,lastChannelIdRef,activeCallRef,lastChannelSettingsRef,connectionStateRef,connectRef,tearDownRef:ref(tearDown),reannouncePresence});
 const {installUnmount}=compileText('exports.installUnmount = '+effect('performUnmountCleanup(cleanupRefs)'),{}, {...globalsForHook,cleanupRefs:refs,setTransmitConnected(){},performUnmountCleanup:cleanup.performUnmountCleanup});
 const unmount=installUnmount();
 const connect=(channel='room-a')=>flow.sfuConnect({channelID:channel,connectSeq:++connectSeqRef.current,connectSeqRef,refs,connectionState:state,isConnected:state.state==='connected',targetId:'host',stunHosts:['stun:test.invalid'],room,sfuConnectionRefs:refs,setConnectionState,setStreams,performCleanup});
 const setup=()=>flow.setupPeerConnection([], {sfuWebSocketRef:refs.sfuWebSocketRef,connectionTimeoutRef:refs.connectionTimeoutRef,isDisconnectingRef:refs.isDisconnectingRef,setStreams,setConnectionState,performCleanup});
 const deliver=(pc,s,mid='0')=>pc.ontrack({track:s.getTracks()[0],streams:[s],transceiver:{mid},receiver:{}});
 return {advance,flush,track,stream,unmount,reannouncePresence,installRecovery,reconnect:()=>reconnected?.(),recoveries,setConnectionState,lastChannelIdRef,peers,sockets,pendingSockets,refs,room,accesses,announcements,connect,tearDown,setup,deliver,setStreams,connectSeqRef,get state(){return state;},get streams(){return streams;},set grantHold(v){grantHold=v;},set socketHold(v){socketHold=v;},get timerCount(){return timers.size;}};
}
const tests=[];const test=(name,fn)=>tests.push({name,fn});
test('Disconnect while room access is pending cannot revive the call',async()=>{
 const h=harness();const joining=h.connect();await h.flush();assert.equal(h.accesses.length,1);await h.tearDown(false);await h.advance(100);
 h.accesses[0].resolve({granted:true,roomId:'room-a',sfuUrls:['wss://test.invalid'],joinToken:'fake'});await h.flush();await h.advance(100);await joining;
 assert.equal(h.peers.length,0,'late grant created a new PC after Leave');assert.equal(h.state.state,'disconnected');assert.ok(!h.announcements.some(x=>x[0]==='joined'&&x[1]));
});
test('Disconnect in final announcement delay cannot announce joined or restore CONNECTING',async()=>{
 const h=harness();h.grantHold=false;const joining=h.connect();await h.flush();assert.equal(h.peers.length,1);assert.ok(h.announcements.some(x=>x[0]==='stream'&&x[1]==='local'));
 await h.tearDown(false);await h.advance(100);await joining;assert.equal(h.state.state,'disconnected','late final write revived CONNECTING');assert.ok(!h.announcements.some(x=>x[0]==='joined'&&x[1]),'late joined=true escaped after Leave');
});
test('Transport failure during the final announcement delay cannot revive the failed call',async()=>{
 const h=harness();h.grantHold=false;const joining=h.connect();await h.flush();const pc=h.peers[0];pc.connectionState='failed';pc.onconnectionstatechange();await h.advance(100);await joining;assert.equal(h.state.state,'failed','final write revived a failed transport');assert.ok(!h.announcements.some(x=>x[0]==='joined'&&x[1]),'failed transport announced joined');
});
test('Old socket completion cannot erase a newer room PC or socket',async()=>{
 const h=harness();h.grantHold=false;h.socketHold=true;const old=h.connect('room-a');await h.flush();assert.equal(h.pendingSockets.length,1);
 const newer=h.connect('room-b');await h.advance(100);assert.equal(h.pendingSockets.length,2);h.pendingSockets[1].resolve(h.pendingSockets[1].socket);await h.flush();await h.advance(100);await newer;
 const pc=h.refs.peerConnectionRef.current,ws=h.refs.sfuWebSocketRef.current;assert.equal(pc,h.peers[1]);assert.equal(ws,h.pendingSockets[1].socket);
 h.pendingSockets[0].resolve(h.pendingSockets[0].socket);await h.flush();await old;assert.equal(h.refs.peerConnectionRef.current,pc,'stale completion cleared active PC');assert.equal(h.refs.sfuWebSocketRef.current,ws,'stale completion cleared active socket');assert.equal(ws.readyState,1);assert.equal(h.state.roomId,'room-b');
});
test('Disconnect disposes an in-flight actual SDK socket before a late open can join',async()=>{
 const h=harness({realSocket:true});h.grantHold=false;const joining=h.connect();await h.flush();assert.equal(h.sockets.length,1);const ws=h.sockets[0];
 await h.tearDown(false);await h.advance(100);ws.onopen?.();await h.flush();
 assert.equal(ws.readyState,3,'pending socket remains open after Leave');assert.equal(ws.sent.length,0,'pending socket sent client_join after Leave');
 await h.advance(15001);await joining;
});
test('Retired track ending cannot remove its replacement alias',async()=>{
 const h=harness(),pc=h.setup(),a=h.stream('published'),b=h.stream('renegotiated');h.deliver(pc,a);h.deliver(pc,b);assert.equal(h.streams.published.stream,b);a.getTracks()[0].end();assert.equal(h.streams.published?.stream,b,'old ended callback removed live replacement alias');assert.equal(h.streams.renegotiated.stream,b);
});
test('Old room track ending cannot remove a new room stream reusing its ID',async()=>{
 const h=harness(),a=h.stream('same-id'),b=h.stream('same-id');h.deliver(h.setup(),a);h.setStreams({});h.deliver(h.setup(),b);a.getTracks()[0].end();assert.equal(h.streams['same-id']?.stream,b,'old room callback removed new room media');
});
test('Current track ending removes only its own current stream and aliases',async()=>{
 const h=harness(),pc=h.setup(),a=h.stream('published'),b=h.stream('renegotiated'),other=h.stream('unrelated');h.deliver(pc,a);h.deliver(pc,b);h.deliver(pc,other,'1');b.getTracks()[0].end();assert.equal(h.streams.published,undefined);assert.equal(h.streams.renegotiated,undefined);assert.equal(h.streams.unrelated.stream,other);
});
test('A replaced track ending inside the same MediaStream retains the live new track',async()=>{
 const h=harness(),pc=h.setup(),old=h.track('old'),tracks=[old],s=h.stream('same-object',tracks);h.deliver(pc,s);
 const newer=h.track('new');tracks.push(newer);old.end();assert.equal(h.streams['same-object']?.stream,s,'old ended callback removed the live track in the reused stream');
});
test('Unmount retires an in-flight grant before cleanup',async()=>{
 const h=harness();const joining=h.connect();await h.flush();h.unmount();h.accesses[0].resolve({granted:true,roomId:'room-a',sfuUrls:['wss://test.invalid'],joinToken:'fake'});await h.flush();await h.advance(100);await joining;assert.equal(h.peers.length,0,'unmounted flow created a new PC');
});
for(const action of ['leave','switch','return-to-same-room']) test('Reannounce grant is fenced after '+action,async()=>{
 const h=harness();h.refs.announcedStreamIdRef.current='old-publication';const reannouncing=h.reannouncePresence('room-a');await h.flush();
 if(action==='leave'){await h.tearDown(false);await h.advance(100);}else h.connectSeqRef.current+=action==='switch'?1:2;
 h.accesses[0].resolve({granted:true});await h.flush();await h.advance(100);await reannouncing;
 assert.ok(!h.announcements.some(x=>x[0]==='stream'&&x[1]==='old-publication'),'stale reannounce published old stream');assert.ok(!h.announcements.some(x=>x[0]==='joined'&&x[1]),'stale reannounce sent joined=true');
});
test('Reannounce final delay respects Leave',async()=>{
 const h=harness();h.grantHold=false;h.refs.announcedStreamIdRef.current='old-publication';const reannouncing=h.reannouncePresence('room-a');await h.flush();await h.tearDown(false);await h.advance(100);await reannouncing;assert.ok(!h.announcements.some(x=>x[0]==='joined'&&x[1]));
});
test('Stale reannounce failure cannot tear down a newer room via fallback',async()=>{
 const h=harness();h.refs.announcedStreamIdRef.current='old-publication';const pc=h.setup();pc.connectionState='connected';h.refs.peerConnectionRef.current=pc;h.refs.sfuWebSocketRef.current={readyState:1,close(){}};h.setConnectionState({state:'connected',roomId:'room-a',serverId:'host'});h.installRecovery();h.reconnect();await h.flush();assert.equal(h.accesses.length,1);
 h.connectSeqRef.current++;h.lastChannelIdRef.current='room-b';h.setConnectionState({state:'connected',roomId:'room-b',serverId:'host'});h.accesses[0].resolve({granted:false,reason:'old room deleted'});await h.flush();await h.advance(1000);
 assert.equal(h.state.roomId,'room-b');assert.equal(h.state.state,'connected');assert.deepEqual(h.recoveries,[],'old refusal queued a recovery against the old room');assert.equal(pc.connectionState,'connected','old failure closed the current PC');
});
test('Recovery delay is retired by a newer explicit connect',async()=>{
 const h=harness();h.setConnectionState({state:'reconnecting',roomId:'room-a',serverId:'host'});h.installRecovery();h.reconnect();h.connectSeqRef.current++;h.lastChannelIdRef.current='room-b';await h.advance(600);assert.deepEqual(h.recoveries,[],'old recovery timer rejoined room A');
});
test('Ordinary disconnected transport recovery still runs once',async()=>{
 const h=harness();h.setConnectionState({state:'connected',roomId:'room-a',serverId:'host'});h.installRecovery();h.reconnect();await h.advance(1000);assert.deepEqual(h.recoveries,['room-a']);
});
const results=[];for(const {name,fn}of tests){try{await fn();console.log('PASS '+name);results.push({name,pass:true});}catch(error){console.log('FAIL '+name+': '+error.message);results.push({name,pass:false,error:error.message});}}
console.log(JSON.stringify({sourceRoot:root,checks:results.length,passed:results.filter(x=>x.pass).length,results},null,2));if(results.some(x=>!x.pass))process.exitCode=1;
