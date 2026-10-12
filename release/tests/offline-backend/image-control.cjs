'use strict';
// Exact backend bundle + exact SFU ELF, one network=none container. No RTP/PC/media.
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const jose=require('/app/node_modules/jose'),jwt=require('/app/node_modules/jsonwebtoken'),WS=require('/app/node_modules/ws');
const checks=[],children=[],sockets=new Set(),links=new Set(),dropped=[],frames=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const check=(name,fn)=>{fn();checks.push(name);};
let dropHybrid=false,proxy;
function product(file,args,env,kind){
  const child=spawn(file,args,{env:{PATH:process.env.PATH,...env},cwd:'/app',stdio:['ignore','pipe','pipe']});
  let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{logs=(logs+data).slice(-8192);});
  child.kind=kind;child.done=new Promise(resolve=>{child.once('exit',(code,signal)=>resolve({kind,code,signal}));child.once('error',error=>{child.spawnError=error.code;resolve({kind,code:null,signal:null,spawnError:error.code});});});
  child.logCategory=()=>({fatal:logs.includes('FATAL'),panic:logs.includes('panic:')});children.push(child);return child;
}
async function health(port,child){const end=Date.now()+15000;while(Date.now()<end){
  if(child.spawnError)throw Error(child.kind+' spawn failed: '+child.spawnError);
  if(child.exitCode!==null||child.signalCode)throw Error(child.kind+' exited before health');
  try{const r=await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(500)});if(r.ok&&(await r.json()).status==='healthy')return;}catch{}
  await delay(100);
}throw Error('health timeout '+child.kind);}
async function until(work,message,ms=5000){const end=Date.now()+ms;while(Date.now()<end){const result=work();if(result)return result;await delay(10);}throw Error(message);}
async function control(){
  const socket=new WS('ws://127.0.0.1:9092/server'),events=[];sockets.add(socket);socket.on('error',()=>{});
  socket.on('message',data=>events.push(JSON.parse(data.toString())));
  await until(()=>socket.readyState===WS.OPEN,'control open');
  return{socket,events,send(event,data){socket.send(JSON.stringify({event,data:JSON.stringify(data)}));},
    wait(event,from=0){return until(()=>events.slice(from).find(frame=>frame.event===event),'control '+event);}};
}
async function app(){
  const socket=new WS('ws://127.0.0.1:5000/socket.io/?EIO=4&transport=websocket'),events=[],acks=new Map();
  sockets.add(socket);let sid,sequence=0;socket.on('error',()=>{});
  socket.on('message',data=>{const packet=data.toString();if(packet[0]==='0')socket.send('40');else if(packet==='2')socket.send('3');
    else if(packet.startsWith('40'))sid=JSON.parse(packet.slice(2)).sid;
    else if(packet.startsWith('42')){const [event,payload]=JSON.parse(packet.slice(2));events.push({event,payload});}
    else if(packet.startsWith('43')){const match=/^43(\d+)(\[.*)$/s.exec(packet);if(match)acks.set(Number(match[1]),JSON.parse(match[2])[0]);}});
  await until(()=>sid,'app open');
  return{socket,events,sid,send(event,payload){socket.send('42'+JSON.stringify([event,payload]));},
    wait(event,from=0){return until(()=>events.slice(from).find(row=>row.event===event)?.payload,'app '+event);},
    async call(event,payload){const id=++sequence;socket.send('42'+id+JSON.stringify([event,payload]));return until(()=>acks.get(id),'app ack '+event,8000);}};
}
async function cleanup(){
  for(const link of links){link.front.close();link.up.close();}
  for(const socket of sockets)socket.close();
  if(proxy){for(const client of proxy.clients)client.terminate();await new Promise(resolve=>proxy.close(resolve));}
  const exits=[];
  for(const child of [...children].reverse()){
    if(child.exitCode===null&&!child.signalCode&&!child.spawnError)child.kill('SIGTERM');
    const exit=await Promise.race([child.done,delay(5000).then(()=>{throw Error('Owned '+child.kind+' shutdown timeout');})]);exits.push(exit);
  }
  return exits;
}
async function main(){
  assert.equal(process.getuid(),1001);assert.deepEqual(fs.readdirSync('/data'),[]);
  assert.equal(sha('/app/bundle.js'),'8181b0834bcb93937b567939f69b26e8719a15e2785f9fd5ea3be955dade3fe5');
  assert.equal(sha('/fixturebin/sfu'),'47378f28e35a4a9a95aced3c3d4f21f028e13e6552721e1a814ed7492203afb2');
  const sfu=product('/fixturebin/sfu',[],{DISABLE_STUN:'true',SFU_METRICS_PORT:'0',SFU_CONTROL_HOST:'127.0.0.1',SFU_CONTROL_PORT:'9092',SFU_PORT:'5005',SFU_REQUIRE_CLIENT_TOKEN:'true',SFU_AUDIO_ONLY:'true',SFU_HYBRID_ENABLED:'true',GOMAXPROCS:'1'},'sfu');
  await health(5005,sfu);checks.push('Exact SFU binary STUN-disabled localhost health');
  proxy=new WS.Server({host:'127.0.0.1',port:9093});
  await new Promise(resolve=>proxy.once('listening',resolve));
  proxy.on('connection',front=>{
    const up=new WS('ws://127.0.0.1:9092/server'),link={front,up},queued=[];links.add(link);up.on('error',()=>{});front.on('error',()=>{});
    front.on('message',bytes=>{const frame=JSON.parse(bytes.toString());frames.push({event:frame.event,phase:frame.event==='hybrid_command'?JSON.parse(frame.data).phase:undefined});if(up.readyState===WS.OPEN)up.send(bytes);else queued.push(bytes);});
    up.on('open',()=>queued.splice(0).forEach(bytes=>up.send(bytes)));
    up.on('message',bytes=>{const frame=JSON.parse(bytes.toString());if(frame.event==='hybrid_result'&&dropHybrid)dropped.push({front,bytes});else if(front.readyState===WS.OPEN)front.send(bytes);});
    front.on('close',()=>{up.close();links.delete(link);});up.on('close',()=>{front.close();links.delete(link);});
  });
  const secret=crypto.randomBytes(32).toString('hex');
  const backend=product(process.execPath,['/app/bundle.js'],{NODE_ENV:'production',JWT_SECRET:secret,DATA_DIR:'/data',HOST:'127.0.0.1',PORT:'5000',METRICS_PORT:'0',DISABLE_S3:'true',SERVER_DISCOVERABLE:'false',SERVER_NAME:'SYNTHETIC-CONTROL',SERVER_INSTANCE_ID:'synthetic',GRYT_IDENTITY_TIERS:'account,local',SFU_WS_HOST:'ws://127.0.0.1:9093',SFU_PUBLIC_HOST:'ws://127.0.0.1:5005',VOICE_HYBRID_ENABLED:'true',UV_THREADPOOL_SIZE:'2'},'backend');
  await health(5000,backend);
  const db=new DatabaseSync('/data/gryt.db'),now=new Date().toISOString();
  db.prepare('UPDATE server_config SET owner_gryt_user_id=?,is_configured=1,discoverable=0').run('synthetic-owner');
  for(const id of ['room-a','room-b'])db.prepare('INSERT INTO channels (channel_id,name,type,created_at,updated_at) VALUES (?,?,?,?,?)').run(id,id,'voice',now,now);
  async function member(index,room){
    const keys=await jose.generateKeyPair('ES256',{extractable:true}),jwk=await jose.exportJWK(keys.publicKey),id='key:'+await jose.calculateJwkThumbprint(jwk,'sha256');
    const user='synthetic-user-'+index,publication='synthetic-publication-'+index;
    db.prepare('INSERT INTO users (gryt_user_id,server_user_id,nickname,created_at,last_seen) VALUES (?,?,?,?,?)').run(id,user,user,now,now);
    db.prepare('INSERT INTO roles (server_user_id,role,created_at,updated_at) VALUES (?,?,?,?)').run(user,'member',now,now);
    const client=await app();client.send('server:join',{nickname:user});const challenge=await client.wait('server:challenge');
    const certificate=await new jose.SignJWT({jwk}).setProtectedHeader({alg:'ES256'}).setIssuer('gryt:self').setSubject('ignored').setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
    const assertion=await new jose.SignJWT({nonce:challenge.nonce}).setProtectedHeader({alg:'ES256'}).setSubject(id).setAudience(challenge.serverHost).setIssuedAt().setExpirationTime('60s').sign(keys.privateKey);
    client.send('server:verify',{certificate,assertion});const joined=await client.wait('server:joined');
    client.send('voice:room:request',room);const grant=await client.wait('voice:room:granted');
    check('Legacy member '+index+' gets SFU grant without Hybrid declaration',()=>{assert.ok(grant.join_token.user_token);assert.equal(grant.join_token.user_id,user);});
    client.send('voice:stream:set',publication);client.send('voice:channel:joined',true);client.send('voice:peer:connected',publication);await delay(100);
    return{...client,user,publication,token:joined.accessToken,refreshToken:joined.refreshToken,grant};
  }
  const a=await member(1,'room-a'),b=await member(2,'room-a'),c=await member(3,'room-b');
  const hybrid=(member,event,data={})=>member.call('voice:hybrid:'+event,{...data,accessToken:member.token});
  const sa=await hybrid(a,'scope'),sb=await hybrid(b,'scope');
  check('Actual backend SFUClient probe receives real supported ACK',()=>{assert.equal(sa.status,'supported');assert.equal(sb.status,'supported');assert.ok(frames.some(frame=>frame.phase==='probe'));});
  const badIdentity=await b.call('voice:hybrid:scope',{accessToken:a.token});check('Wrong member identity rejected',()=>assert.equal(badIdentity.error,'hybrid_unauthenticated'));
  for(const field of ['serverInstanceId','roomGeneration','localSessionId','roomId']){
    const value=await hybrid(a,'lease',{scope:{...sa.scope,[field]:'wrong'},participant:sa.participants.find(p=>p.sessionId===b.sid)});
    check('Wrong '+field+' rejected before SFU forwarding',()=>assert.equal(value.error,'hybrid_scope_stale'));
  }
  const cross=await hybrid(a,'lease',{scope:sa.scope,participant:{participantId:c.user,sessionId:c.sid,publicationId:c.publication}});
  check('Cross-channel authenticated member rejected',()=>assert.equal(cross.error,'hybrid_cross_room_or_generation'));
  const lease=await hybrid(b,'lease',{scope:sb.scope,participant:sb.participants.find(p=>p.sessionId===a.sid)});
  assert.equal(lease.status,'leased');
  const request={scope:sb.scope,pairConnectionId:lease.lease.connectionId,sourceParticipantId:a.user,sourceSessionId:a.sid,sourcePublicationId:a.publication,destinationSessionId:b.sid,routeGeneration:1,operationId:'1:1',enabled:false,pauseLeaseMs:1000};
  const wrongPublication=await hybrid(b,'forwarding',{request:{...request,sourcePublicationId:'old-publication'}});
  check('Old publication rejected',()=>assert.equal(wrongPublication.error,'hybrid_cross_room_or_generation'));
  const invalidOperation=await hybrid(b,'forwarding',{request:{...request,operationId:'2:1'}});
  check('Mismatched operation epoch rejected',()=>assert.equal(invalidOperation.error,'hybrid_operation_invalid'));
  const pause=await hybrid(b,'forwarding',{request});check('Real SFU rejects pause without physical connected peers; backend no applied ACK',()=>{assert.equal(pause.error,'hybrid_sfu_ack_failed');assert.equal(pause.ack,undefined);});
  const resume=await hybrid(b,'forwarding',{request:{...request,enabled:true,pauseLeaseMs:0,routeGeneration:2,operationId:'2:1'}});
  check('Real SFU rejects resume without physical peers; backend no applied ACK',()=>assert.equal(resume.error,'hybrid_sfu_ack_failed'));
  dropHybrid=true;const started=Date.now();const timeout=await hybrid(b,'forwarding',{request:{...request,routeGeneration:3,operationId:'3:1'}});const elapsed=Date.now()-started;dropHybrid=false;
  check('Real backend pending control ACK times out fail-closed',()=>{assert.equal(timeout.error,'hybrid_sfu_ack_timeout');assert.ok(elapsed>=4800&&elapsed<8000);assert.equal(timeout.ack,undefined);assert.ok(dropped.length);});
  for(const delayed of dropped.splice(0))if(delayed.front.readyState===WS.OPEN)delayed.front.send(delayed.bytes);
  const afterTimeout=await hybrid(a,'scope');check('Late old ACK does not settle replacement probe',()=>assert.equal(afterTimeout.status,'supported'));
  const raw=await control(),server='synthetic-control-raw',password='synthetic-control-only-key',room='synthetic-control-room';
  let command=0;
  async function sendCommand(client,change={}){const id='synthetic-command-'+(++command),from=client.events.length;client.send('hybrid_command',{command_id:id,phase:'probe',server_id:server,server_password:password,...change});
    const frame=await until(()=>client.events.slice(from).find(row=>row.event==='hybrid_result'&&JSON.parse(row.data).command_id===id),'raw hybrid ACK');return JSON.parse(frame.data);}
  const unregistered=await sendCommand(raw);check('Unregistered control socket cannot probe',()=>assert.equal(unregistered.error,'unauthorized_server'));
  raw.send('server_register',{server_id:server,server_password:password,room_id:room});await raw.wait('room_joined');
  const supported=await sendCommand(raw);check('Registered raw control probe has correlated supported ACK',()=>assert.equal(supported.status,'supported'));
  const wrongPassword=await sendCommand(raw,{server_password:'wrong'});check('Wrong SFU server password rejected',()=>assert.equal(wrongPassword.error,'unauthorized_server'));
  const wrongServer=await sendCommand(raw,{server_id:'wrong'});check('Wrong SFU server identity rejected',()=>assert.equal(wrongServer.error,'unauthorized_server'));
  const impostor=await control(),wrongConnection=await sendCommand(impostor);check('Correct credentials on unregistered connection rejected',()=>assert.equal(wrongConnection.error,'unauthorized_server'));
  const forwarding={phase:'forwarding',room_id:room,authority_generation:'synthetic-epoch',pair_connection_id:'synthetic-pair',source_user_id:'source',source_session_id:'source-session',source_publication_id:'publication',receiver_user_id:'receiver',receiver_session_id:'receiver-session',revision:1,enabled:false,pause_ms:1000};
  for(const [name,change,error] of [['wrong-room',{room_id:'other-room'},'invalid_hybrid_command'],['empty-epoch',{authority_generation:''},'invalid_hybrid_command'],['bad-pause',{pause_ms:1},'invalid_hybrid_command'],['missing-source-session',{source_session_id:''},'invalid_hybrid_command'],['old-physical-session',{source_session_id:'retired'},'peer_generation_changed']]){
    const value=await sendCommand(raw,{...forwarding,...change});check('Actual SFU '+name+' rejection',()=>{assert.equal(value.status,'failed');assert.equal(value.error,error);assert.equal(value.snapshot,undefined);});
  }
  for(const link of [...links]){link.up.close();link.front.close();}
  await delay(300);const unavailable=await hybrid(a,'scope');check('Disconnected actual SFU falls back to unsupported, no success ACK',()=>assert.equal(unavailable.error,'hybrid_unsupported'));
  const refreshFrom=a.events.length;a.send('token:refresh',{refreshToken:a.refreshToken});const afterControlFailure=await a.wait('token:refreshed',refreshFrom);
  check('Ordinary legacy session remains refreshable after control failure',()=>assert.equal(jwt.verify(afterControlFailure.accessToken,secret).serverUserId,a.user));
  db.close();const exits=await cleanup();check('Actual backend terminates exit0',()=>assert.equal(exits.find(exit=>exit.kind==='backend').code,0));
  console.log(JSON.stringify({passed:true,checks,actualBackendAndSfu:true,backendBundleSha256:sha('/app/bundle.js'),sfuElfSha256:sha('/fixturebin/sfu'),controlFrames:frames.length,timeoutMs:elapsed,exits,
    realPauseResumeSuccessAck:false,realConnectedPeerOrRtp:false,syntheticApplicationVoiceAnnouncements:true,legacyClientWireOnly:true,
    faultInjection:'Drop/delay real hybrid_result frames on in-container loopback proxy; no fabricated positive ACK',hostPortBindings:false,externalNetwork:false,realAccountOrCredentials:false,sfuGracefulExitAccepted:false}));
}
const watchdog=setTimeout(()=>{for(const child of children)child.kill('SIGTERM');console.error('control_fixture_watchdog');process.exit(2);},90000);
main().catch(async error=>{console.error(JSON.stringify({passed:false,error:error.message,stack:error.stack?.split('\n').slice(0,5),checks}));try{await cleanup();}catch{for(const child of children)child.kill('SIGKILL');}process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
