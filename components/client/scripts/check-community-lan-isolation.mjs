import {coordinatorTestDependency} from "./room-coordinator-test-deps.mjs";
/* eslint-env node */
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react'),jsx=require('react/jsx-runtime'),ui=Object.assign({},...await Promise.all(['menu','tooltip','icon-button'].map(name=>import(pathToFileURL(require.resolve('@gryt/ui/'+name).replace(/\.cjs$/, '.js')).href)))),{renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(import.meta.dirname,'..'),quiet=new Proxy({}, {get:()=>()=>{}});
function compile(file,deps,globals={}){const result=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}});assert.equal(result.diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);const exports={};vm.runInNewContext(result.outputText,{exports,console:quiet,setTimeout,clearTimeout,...globals,require:key=>{if(key.endsWith("/roomAccessCooldown")||key.endsWith("/localDiagnostics"))return coordinatorTestDependency(key);assert.ok(Object.hasOwn(deps,key),'Unexpected module '+key);return deps[key];}});return exports;}
const logic=compile('src/lib/easyTierCommunitySubscriptions.ts',{}),cases=[];
async function test(name,fn){await fn();cases.push(name);console.log('PASS '+name);}
const state=(phase,reason=null)=>({serverId:'server-fixture',generation:1,phase,reason,virtualIp:null,lanSnapshot:null});
await test('Missing ET grant is setup status, not a community/voice error',()=>{const a=logic.easyTierCommunityAction(state('activation-required','configuration-required'));assert.equal(a.kind,'unconfigured');assert.equal(a.label,'待开通');assert.equal(a.retryLabel,'刷新配置');assert.ok(a.message.includes('社区语音独立'));});
await test('User disabled is distinct from configuration absence',()=>{const a=logic.easyTierCommunityAction(state('activation-required','configuration-required'),false);assert.equal(a.kind,'disabled');assert.equal(a.retry,false);});
await test('Turning off an alive native session is not falsely labelled stopped',()=>assert.equal(logic.easyTierCommunityAction(state('connected'),false).kind,'pending'));
await test('Cleanup failure remains actionable even after user disables ET',()=>{const a=logic.easyTierCommunityAction(state('error','cleanup-failed'),false);assert.equal(a.kind,'error');assert.equal(a.retryLabel,'重试退出');});
await test('Admin permission tells the user to relaunch elevated, without an in-app UAC retry',()=>{const a=logic.easyTierCommunityAction(state('activation-required','needs-permission'));assert.equal(a.kind,'attention');assert.equal(a.retry,false);assert.ok(a.message.includes('退出应用'));assert.ok(a.message.includes('以管理员身份运行'));assert.ok(!a.message.includes('不会自行提权'));});
await test('Transient failures explain background retry and keep immediate retry optional',()=>{for(const reason of ['connect-failed','operation-timeout','status-unavailable','runtime-exited']){const a=logic.easyTierCommunityAction(state('error',reason));assert.equal(a.kind,'error');assert.equal(a.retry,true);assert.equal(a.retryLabel,'立即重试');assert.match(a.message,/自动重试/);assert.match(a.message,/立即重试/);}});
await test('Unknown failure does not promise automatic recovery',()=>{const a=logic.easyTierCommunityAction(state('error','future-failure'));assert.equal(a.kind,'error');assert.equal(a.retry,true);assert.equal(a.retryLabel,'立即重试');assert.ok(a.message.includes('请稍候'));assert.ok(!a.message.includes('自动重试'));});
await test('Renderer failure presentation is observable for missing or idle state',()=>{
  const missing=logic.presentCommunityLanAction(logic.easyTierCommunityAction(undefined),undefined,{operationFailed:true});
  assert.equal(missing.kind,'error');assert.equal(missing.retry,true);assert.equal(missing.retryLabel,'立即重试');assert.ok(missing.message.includes('未能取得联机接入结果'));assert.ok(!missing.message.includes('自动重试'));
  const idle=logic.presentCommunityLanAction(logic.easyTierCommunityAction(state('disabled')),state('disabled'),{operationFailed:true});
  assert.equal(idle.kind,'error');assert.equal(idle.retry,true);assert.ok(idle.message.includes('未能取得联机接入结果'));
  const setup=logic.presentCommunityLanAction(logic.easyTierCommunityAction(state('activation-required','needs-permission')),state('activation-required','needs-permission'),{operationFailed:true});
  assert.equal(setup.kind,'attention');assert.equal(setup.retry,false);assert.ok(setup.message.includes('以管理员身份运行'));
  const transient=logic.presentCommunityLanAction(logic.easyTierCommunityAction(state('error','connect-failed')),state('error','connect-failed'),{operationFailed:true});
  assert.equal(transient.kind,'error');assert.equal(transient.retryLabel,'立即重试');assert.ok(transient.message.includes('自动重试'));
});
await test('Renderer preparation has no Windows prompt instruction',()=>{const action=logic.presentCommunityLanAction(logic.easyTierCommunityAction(undefined),undefined,{preparing:true});assert.equal(action.label,'准备联机');assert.ok(action.message.includes('请稍候'));assert.ok(!action.message.includes('Windows'));});
const component=compile('src/components/CommunityLanStatusControl.tsx',{'react/jsx-runtime':jsx,'@gryt/ui':ui,'../lib/icons':{PiLinkSimpleBold:p=>React.createElement('svg',p)}}).CommunityLanStatusControl;
await test('Actual compact control SSR has no persistent long paragraph or overlay',()=>{for(const s of [state('activation-required','configuration-required'),state('disabled'),state('error','connect-failed')]){const html=renderToStaticMarkup(React.createElement(component,{action:logic.easyTierCommunityAction(s),enabled:true,preparing:false,communityLabel:'社区服务未连接',channelsReceived:false,onToggle(){},onPrepare(){},onRetry(){}}));assert.ok(html.includes('community-lan-control'));assert.ok(!html.includes('这个社区尚未提供'));assert.ok(!html.includes('position:fixed'));assert.ok(!html.includes('<aside'));assert.ok(html.includes('查看联机详情'));}});
await test('Production shell has exactly one owner and reachable normal/tiny controls',()=>{const app=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8'),rail=fs.readFileSync(path.join(root,'src/components/sidebar.tsx'),'utf8'),main=fs.readFileSync(path.join(root,'src/components/mainApp.tsx'),'utf8');assert.equal((app.match(/<CommunityLanSession>/g)||[]).length,1);assert.ok(app.includes('<CommunityLanSession><MainApp /></CommunityLanSession>'));assert.ok(rail.includes('min-h-0 flex-1')&&rail.includes('overflow-y-auto')&&rail.includes('flex shrink-0 justify-center'));assert.ok(rail.includes('<CommunityLanControls />'));assert.ok(main.includes('{isTiny &&')&&main.includes('<CommunityLanControls />'));});
await test('ET bridge sync throws/rejections are contained and signalled',async()=>{let failed=0;const owner=new logic.EasyTierCommunitySubscriptions({syncMemberships(){throw Error('unavailable');},connect:()=>Promise.reject(Error('unavailable'))},()=>{},()=>failed++);assert.doesNotThrow(()=>owner.reconcile(['server-fixture']));owner.retry('server-fixture');await Promise.resolve();await Promise.resolve();assert.equal(failed,2);owner.dispose();owner.retry('server-fixture');assert.equal(failed,2);});

const translate={t:key=>key},common={getServerWsBase:host=>'wss://'+host,answerChallenge:async()=>({certificate:'fixture-certificate',assertion:'fixture-assertion',tier:'guest'}),clearIdentityCertificate(){}};
const auth={guardSocket:()=>({verified:Promise.resolve()}),describeGap:()=>'',serverProofErrorMessage:()=> 'identity denied'};
const challenges=compile('src/packages/socket/src/utils/challengeHost.ts',{'@/common':{normalizeHost:s=>s.replace(/^https?:\/\//,'').toLowerCase()}});
function fakeSocket({denied=false,badChallenge=false}={}){
 const socket=new EventEmitter();socket.connected=true;socket.id='session-fixture';socket.disconnect=()=>{socket.connected=false;};
 const emitted=[];socket.emit=event=>{emitted.push(event);if(event==='server:join')queueMicrotask(()=>EventEmitter.prototype.emit.call(socket,'server:challenge',{nonce:'fixture-nonce',serverHost:badChallenge?'other.invalid':'community.invalid'}));if(event==='server:verify')queueMicrotask(()=>EventEmitter.prototype.emit.call(socket,denied?'server:error':'server:joined',denied?{error:'forbidden'}:{accessToken:'fixture-only-token',nickname:'fixture'}));return socket;};
 return {socket,emitted};
}
for(const variant of ['missing-grant','disabled','unavailable'])await test('Production join and SFU room grant remain available with ET '+variant,async()=>{
 const f=fakeSocket();const join=compile('src/packages/socket/src/utils/joinServerOnce.ts',{'socket.io-client':{io:()=>{queueMicrotask(()=>EventEmitter.prototype.emit.call(f.socket,'connect'));return f.socket;}},'@/common':common,'@/i18n':{i18n:translate},'./challengeHost':challenges,'./serverAuth':auth}).joinServerOnce;
 const et=new logic.EasyTierCommunitySubscriptions({syncMemberships:()=>variant==='unavailable'?Promise.reject(Error('no ET')):Promise.resolve([state(variant==='disabled'?'disabled':'activation-required',variant==='disabled'?null:'configuration-required')])},()=>{},()=>{});et.reconcile(['server-fixture']);
 const result=await join({host:'community.invalid'});assert.equal(result.ok,true);assert.ok(f.emitted.includes('server:verify'));et.dispose();
 const signal=new EventEmitter();signal.connected=true;signal.id='session-fixture';signal.emit=(event,payload)=>{if(event==='voice:room:request')queueMicrotask(()=>EventEmitter.prototype.emit.call(signal,'voice:room:granted',{room_id:'server-fixture_'+payload,join_token:{fixture:true},sfu_url:'wss://sfu.invalid',timestamp:0}));return signal;};
 const room=compile('src/packages/webRTC/src/adapters/roomCoordinator.ts',{'@/socket/src/utils/rateLimitHandler':{handleRateLimitError(){}}}).createRoomCoordinator(signal,'community.invalid',undefined,'server-fixture');const grant=await room.requestAccess('room-fixture');assert.equal(grant.granted,true);assert.equal(grant.roomId,'server-fixture_room-fixture');
});
await test('ET state never overrides real community permission rejection',async()=>{const f=fakeSocket({denied:true}),join=compile('src/packages/socket/src/utils/joinServerOnce.ts',{'socket.io-client':{io:()=>{queueMicrotask(()=>EventEmitter.prototype.emit.call(f.socket,'connect'));return f.socket;}},'@/common':common,'@/i18n':{i18n:translate},'./challengeHost':challenges,'./serverAuth':auth}).joinServerOnce;const r=await join({host:'community.invalid'});assert.equal(r.ok,false);assert.equal(r.error.error,'forbidden');});
await test('Wrong-host challenge cannot sign identity or be repaired by ET',async()=>{let signed=0;const f=fakeSocket({badChallenge:true}),join=compile('src/packages/socket/src/utils/joinServerOnce.ts',{'socket.io-client':{io:()=>{queueMicrotask(()=>EventEmitter.prototype.emit.call(f.socket,'connect'));return f.socket;}},'@/common':{...common,answerChallenge:async()=>{signed++;return {};}},'@/i18n':{i18n:translate},'./challengeHost':challenges,'./serverAuth':auth}).joinServerOnce;const r=await join({host:'community.invalid'});assert.equal(r.ok,false);assert.equal(signed,0);assert.ok(!f.emitted.includes('server:verify'));});
await test('No stable server identity cannot borrow ET connectivity for a room grant',async()=>{const signal={connected:true,id:'session-fixture',emit(){throw Error('Must not emit');}};const room=compile('src/packages/webRTC/src/adapters/roomCoordinator.ts',{'@/socket/src/utils/rateLimitHandler':{handleRateLimitError(){}}}).createRoomCoordinator(signal,'community.invalid');assert.equal((await room.requestAccess('room-fixture')).granted,false);});
await test('Voice leave, SFU failure, and Hybrid disposal preserve ET lease ownership',async()=>{
  const roomSource=fs.readFileSync(path.join(root,'src/packages/webRTC/src/adapters/roomCoordinator.ts'),'utf8');
  const lifecycleSource=fs.readFileSync(path.join(root,'src/packages/webRTC/src/adapters/useVoiceLifecycle.tsx'),'utf8');
  const bridgeSource=fs.readFileSync(path.join(root,'src/packages/webRTC/src/adapters/HybridVoiceBridge.tsx'),'utf8');
  const sessionSource=fs.readFileSync(path.resolve(root,'..','voice','src/webrtc/hybrid/BrowserHybridVoiceSession.ts'),'utf8');
  const etLeaseApi=/\b(?:easyTierCommunity|reconcileEnrollment|disconnectCommunity|syncMemberships|setAuthenticatedSession|et-community-[a-z-]+)\b/;
  for(const [name,source] of [['room coordinator',roomSource],['voice lifecycle',lifecycleSource],['Hybrid voice bridge',bridgeSource],['Hybrid voice session',sessionSource]])
    assert.doesNotMatch(source,etLeaseApi,`${name} must not own or release the ET community lease`);
  const emitted=[],signal={connected:true,id:'voice-test-socket',emit(event){emitted.push(event);}};
  const room=compile('src/packages/webRTC/src/adapters/roomCoordinator.ts',{'@/socket/src/utils/rateLimitHandler':{handleRateLimitError(){}}}).createRoomCoordinator(signal);
  room.leave();
  assert.deepEqual(emitted,['voice:room:leave'],'room leave must remain a voice-only operation');

  // Execute the production bridge cleanup in a VM with a lease spy. This exercises
  // the actual SFU-failure callback and effect cleanup without a browser, ET core,
  // driver, or network. The fake resolver exposes release methods so accidental
  // ownership transfer is observable rather than hidden by a source-only scan.
  const bridgeCode=ts.transpileModule(bridgeSource,{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});
  assert.equal(bridgeCode.diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);
  const effects=[],sessions=[],registrations=[],lease={releaseCalls:0,disconnectCalls:0,release(){this.releaseCalls++;},disconnectCommunity(){this.disconnectCalls++;}};
  const pc={connectionState:'connected',getConfiguration(){return {iceServers:[]};}};
  const socket={connected:true,id:'local-session'};
  const roster={
    'local-session':{serverUserId:'local-user',voiceChannelId:'room',hasJoinedChannel:true},
    'remote-session':{serverUserId:'remote-user',streamID:'remote-publication',voiceChannelId:'room',hasJoinedChannel:true},
  };
  const source={receiveCleanup:{}};
  const sfu={currentServerConnected:'host',currentChannelConnected:'room',isConnected:true,streamSources:{'remote-publication':source},getPeerConnection:()=>pc,getConnectionEpoch:()=>1};
  const microphone={stop(){throw Error('Hybrid observer must not stop the microphone');}};
  class Session {
    constructor(options){this.options=options;this.disposed=false;sessions.push(this);}
    async update(){}
    async setEnabled(){}
    getState(){return {status:'disabled'};}
    fail(){this.options.onState?.({status:'unsupported',reason:'fixture_sfu_failure',routing:null,physicalDirectVerified:false});}
    dispose(){this.disposed=true;}
  }
  const deps={
    '@gryt/voice':{BrowserHybridVoiceSession:Session,useSFU:()=>sfu,useMicrophone:()=>microphone},
    react:{useRef:value=>({current:value}),useEffect:fn=>effects.push(fn)},
    '@/common':{useUserId:()=> 'account',getServerAccessToken:()=> 'fixture-token'},
    '@/socket':{useSockets:()=>({sockets:{host:socket},serverDetailsList:{host:{server_info:{server_id:'server'}}},clients:{host:roster}})},
    '../../../../lib/communityLanState':{useEasyTierCommunityState:()=>({phase:'connected',reason:null,lease})},
    '../../../../lib/easyTierVoiceUnderlay':{createEasyTierVoiceUnderlayResolver:()=>({resolve:()=>null,release:()=>lease.release(),disconnectCommunity:()=>lease.disconnectCommunity()})},
    '../../../../lib/memberVoiceLocalNetwork':{readVoiceLocalNetwork:()=>undefined},
    '../../../../lib/hybridDiagnostics':{createHybridDiagnosticObserver:()=>({scope(){},state(){},sdk(){}})},
    './MemberVoiceObservationAuthority':{useMemberVoiceObservationAuthority:()=>({update(){},registerSession:(session,binding)=>{const registration={session,binding};registrations.push(registration);return()=>{registration.released=true;};}})},
  };
  const bridgeExports={};
  vm.runInNewContext(bridgeCode.outputText,{exports:bridgeExports,JSON,setTimeout,clearTimeout,require:key=>{assert.ok(Object.hasOwn(deps,key),'Unexpected Hybrid dependency '+key);return deps[key];}});
  const policy={enabled:true,allowNetwork:true,microphoneCodec:{codec:'opus',maxBitrateBps:64000},onState(){}};
  bridgeExports.HybridVoiceBridge({policy,config:{connection:{microphoneCodec:{codec:'opus',maxBitrateBps:64000},maxBitrate:null}},registry:{selectTrack(){}}});
  const cleanups=effects.map(effect=>effect());
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(sessions.length,1,'production bridge should create one session in the fixture');
  const session=sessions[0];
  session.fail();
  assert.equal(lease.releaseCalls,0);assert.equal(lease.disconnectCalls,0,'SFU failure must not release the community lease');
  cleanups.forEach(cleanup=>typeof cleanup==='function'&&cleanup());
  assert.equal(session.disposed,true);assert.equal(lease.releaseCalls,0);assert.equal(lease.disconnectCalls,0,'Hybrid disposal must not release the community lease');
  assert.equal(registrations[0].released,true,'voice observation registration is released independently');
});
console.log(JSON.stringify({checks:cases.length,allPassed:true,scope:'Production source under deterministic fake signaling/identity service and SSR. Guard cryptography is stubbed; no real SFU RTP/device or actual P2P path measured.',realNetworkOrNative:false,rawCredentialsOrProfiles:false}));
