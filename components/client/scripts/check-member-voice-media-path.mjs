// Pure VM/TSX tests only. Synthetic data; no browser, SDK, listeners, audio or network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

import ts from 'typescript';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const compile=(p,deps={},extra='')=>{
 const out=ts.transpileModule(read(p)+extra,{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}});
 assert.deepEqual(out.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error),[],p);
 const exports={};vm.runInNewContext(out.outputText,{exports,require(name){assert.ok(Object.hasOwn(deps,name),'unexpected dependency '+name);return deps[name];}});return exports;
};
const model=compile('src/lib/memberVoiceMediaPath.ts'),now=1_800_000_000_000;
const scope={serverScope:'server-fixture',serverInstanceId:'instance-1',roomId:'room-1',roomGeneration:1,localServerUserId:'local-user',localSessionId:'local-session',localPublicationId:'local-pub',remoteServerUserId:'remote-user',remoteSessionId:'remote-session',remotePublicationId:'remote-pub',connectionGeneration:1};
const route={mediaRouteId:'selected-route',routeGeneration:1,selectionRevision:2};
const media=(kind='receive',selected='peer',underlay='direct')=>({
 source:kind==='receive'?'sdk-selected-receive-media':'authenticated-selected-send-media',observedAtMs:now,selected,availability:'usable',transition:'stable',...route,selectedTrackId:'track-'+kind,selectedIcePairId:'actual-selected-pair',
 mediaProof:{source:kind==='receive'?'sdk-decoded-receive-media':'authenticated-remote-decoded-media',observedAtMs:now,windowStartedAtMs:now-1000,decodedFramesDelta:30,...route,selectedTrackId:'track-'+kind},
 underlay:{source:'authenticated-selected-media-underlay',observedAtMs:now,...route,selectedIcePairId:'actual-selected-pair',kind:underlay,association:'verified',coverage:'complete-path',fromServerUserId:kind==='receive'?'remote-user':'local-user',toServerUserId:kind==='receive'?'local-user':'remote-user'},
 metrics:{source:'selected-media-stats',observedAtMs:now,...route,scope:selected==='peer'?'peer-transport':'sfu-transport',rttMs:24.4,loss:{packetsLost:1,packetsReceived:249,windowMs:1000}}
});
const fixture=()=>({schemaVersion:1,source:'authenticated-sdk-media-selection',scope:{...scope},observedAtMs:now,receive:media(),send:media('send')});
const evaluate=(evidence,extras={})=>model.readMemberVoiceMediaPath({scope,evidence,nowMs:now,...extras});
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
check('unwired and missing directions stay unknown, never claim direct from presence or PC',()=>{
 assert.equal(evaluate(undefined).receive.reason,'not-integrated');
 const e=fixture();delete e.send;e.online=true;e.peerConnection={};e.easytierDirect=true;
 assert.equal(evaluate(e).send.reason,'missing');
 delete e.receive;assert.equal(evaluate(e).receive.label,'path-pending');
});
check('authenticated server instance, room, account, sessions, publications and generations isolate evidence',()=>{
 for(const key of Object.keys(scope)){
  const e=fixture();e.scope[key]=typeof scope[key]==='number'?scope[key]+1:scope[key]+'-old';
  assert.equal(evaluate(e).receive.reason,'scope-mismatch',key);
 }
 for(const change of [e=>e.source='online-presence',e=>e.schemaVersion=2,e=>e.scope=null]){
  const e=fixture();change(e);assert.equal(evaluate(e).receive.label,'path-pending');
 }
 for(const s of [{...scope,roomGeneration:0},{...scope,remoteSessionId:scope.localSessionId},{...scope,remotePublicationId:''}])assert.equal(evaluate(fixture(),{scope:s}).receive.reason,'invalid');
});
check('snapshot and direction freshness, future timestamps and adapter clock govern claims',()=>{
 for(const at of [now-5001,now+1,NaN,Infinity,-1])for(const target of ['snapshot','receive']){
  const e=fixture();(target==='snapshot'?e:e.receive).observedAtMs=at;
  assert.equal(evaluate(e).receive.label,'path-pending');
 }
 const e=fixture();e.observedAtMs=now-5000;e.receive.observedAtMs=now-5000;
 assert.equal(evaluate(e).receive.label,'direct');assert.equal(evaluate(e,{nowMs:now+1}).receive.label,'path-pending');
 assert.equal(evaluate(fixture(),{nowMs:undefined}).receive.reason,'invalid');
});
check('only selected stable usable decoded media is known; ICE or outbound bytes are insufficient',()=>{
 for(const mutate of [e=>delete e.mediaProof,e=>e.mediaProof.source='ice-connected',e=>e.mediaProof.decodedFramesDelta=0,
  e=>e.mediaProof.decodedFramesDelta=NaN,e=>e.mediaProof.observedAtMs=now-5001,e=>e.mediaProof.windowStartedAtMs=now,
  e=>e.mediaProof.selectedTrackId='old-track',e=>e.mediaProof.selectionRevision++,e=>e.availability='unknown',e=>e.transition='unknown']){
  const f=fixture();mutate(f.receive);assert.equal(evaluate(f).receive.label,'path-pending');
 }
 const e=fixture();e.send.mediaProof.source='sdk-decoded-receive-media';assert.equal(evaluate(e).send.label,'path-pending');
});
check('SDK none/usable and failure/usable inconsistencies are not patched by UI',()=>{
 for(const changes of [{selected:'none'},{transition:'confirmed-failed'},{selected:'none',transition:'confirmed-failed'}]){
  const e=fixture();Object.assign(e.receive,changes);const r=evaluate(e).receive;
  assert.equal(r.reason,'inconsistent');assert.equal(r.label,'path-pending');assert.equal(r.rttMs,null);
 }
});
check('confirmed switching/failure clear prior direct and metrics, without guessing fallback',()=>{
 const e=fixture();e.receive.transition='confirmed-switching';assert.equal(evaluate(e).receive.label,'switching');assert.equal(evaluate(e).receive.rttMs,null);
 e.receive.transition='confirmed-failed';e.receive.availability='unavailable';assert.equal(evaluate(e).receive.label,'error');
 e.receive.transition='stable';assert.equal(evaluate(e).receive.label,'path-pending');
 e.receive.selected='none';assert.equal(evaluate(e).receive.label,'pending');
});
check('SFU usable selection is server relay; peer selected media needs complete correlated underlay',()=>{
 for(const kind of ['direct','member-relay','server-relay']){
  const e=fixture();e.receive.underlay.kind=kind;assert.equal(evaluate(e).receive.label,kind);
 }
 const e=fixture();e.receive=media('receive','sfu');delete e.receive.underlay;delete e.receive.selectedIcePairId;
 assert.equal(evaluate(e).receive.label,'server-relay');assert.equal(evaluate(e).receive.metricsScope,'sfu-transport');
});
check('first member hop never proves a member-only path; ET cost is not rendered as bandwidth',()=>{
 const e=fixture();e.receive.underlay.coverage='first-hop-only';e.receive.underlay.kind='member-relay';e.receive.underlay.nextHop='member';e.receive.underlay.cost=1;
 assert.equal(evaluate(e).receive.label,'path-pending');assert.equal(evaluate(e).receive.nextHop,'member');
 e.receive.underlay.coverage='unknown';assert.equal(evaluate(e).receive.label,'path-pending');
});
check('ICE pair, route revision, exact direction and all-hop association must agree',()=>{
 for(const mutate of [e=>delete e.underlay,e=>delete e.selectedIcePairId,e=>e.underlay.selectedIcePairId='candidate-pair',
  e=>e.underlay.source='easytier-list-routes',e=>e.underlay.association='ambiguous',e=>e.underlay.association='unverified',
  e=>e.underlay.observedAtMs=now-5001,e=>e.underlay.observedAtMs=now+1,e=>e.underlay.mediaRouteId='another-route',
  e=>e.underlay.selectionRevision++,e=>e.underlay.routeGeneration++,e=>e.underlay.fromServerUserId='local-user',e=>e.underlay.kind='unknown']){
  const f=fixture();mutate(f.receive);assert.equal(evaluate(f).receive.label,'path-pending');
 }
});
check('metrics expire independently, belong to selection and preserve missing values instead of zero',()=>{
 const e=fixture();assert.equal(evaluate(e).receive.rttMs,24.4);assert.equal(evaluate(e).receive.lossPercent,0.4);
 for(const mutate of [m=>m.scope='sfu-transport',m=>m.source='lan-route-stats',m=>m.selectionRevision++,m=>m.observedAtMs=now-5001,m=>m.observedAtMs=now+1]){
  const f=fixture();mutate(f.receive.metrics);const r=evaluate(f).receive;assert.equal(r.label,'direct');assert.equal(r.rttMs,null);assert.equal(r.lossPercent,null);
 }
 for(const value of [NaN,Infinity,-1,60001,null,undefined]){const f=fixture();f.receive.metrics.rttMs=value;assert.equal(evaluate(f).receive.rttMs,null);}
 e.receive.metrics.rttMs=0;assert.equal(evaluate(e).receive.rttMs,0);delete e.receive.metrics.loss;assert.equal(evaluate(e).receive.lossPercent,null);
 delete e.receive.metrics;assert.equal(evaluate(e).receive.rttMs,null);
});
check('loss windows require valid progress and cannot fabricate zeros from empty counters',()=>{
 for(const loss of [{packetsLost:0,packetsReceived:0,windowMs:1000},{packetsLost:-1,packetsReceived:1,windowMs:1000},{packetsLost:1,packetsReceived:1,windowMs:0},{packetsLost:1,packetsReceived:1,windowMs:Infinity}]){
  const e=fixture();e.receive.metrics.loss=loss;assert.equal(evaluate(e).receive.lossPercent,null);
 }
});
const jsx=(type,props)=>({type,props});let snapshot;
const adapter=compile('src/packages/webRTC/src/components/MemberVoiceMediaPathAdapter.tsx',{
 react:{createContext:()=>({Provider:'Provider'}),useContext:()=>snapshot},'../../../../lib/memberVoiceMediaPath':model,
});
check('passive adapter rejects wrong or ambiguous roster matches and advances freshness without a second store',()=>{
 snapshot={nowMs:now,entries:[{scope,evidence:fixture()}]};
 assert.equal(adapter.useMemberVoiceMediaPath('server-fixture','remote-user','remote-pub').receive.label,'direct');
 assert.equal(adapter.useMemberVoiceMediaPath('server-fixture','remote-user','old-pub').receive.label,'path-pending');
 snapshot.entries.push(snapshot.entries[0]);assert.equal(adapter.useMemberVoiceMediaPath('server-fixture','remote-user','remote-pub').receive.label,'path-pending');
 snapshot.entries.pop();snapshot.nowMs+=5001;assert.equal(adapter.useMemberVoiceMediaPath('server-fixture','remote-user','remote-pub').receive.reason,'expired');snapshot=undefined;
});
const locales=Object.fromEntries(['en','zh-CN'].map(language=>[language,JSON.parse(read('src/packages/i18n/locales/'+language+'.json'))]));let language='zh-CN';
const lookup=(o,key)=>key.split('.').reduce((next,p)=>next?.[p],o);
const t=(key,values={})=>{let value=lookup(locales[language],key)??lookup(locales.en,key);assert.equal(typeof value,'string',key);for(const[k,v]of Object.entries(values))value=value.replaceAll('{{'+k+'}}',v);return value;};
const view=compile('src/packages/socket/src/components/MemberVoiceMediaStatus.tsx',{
 'react/jsx-runtime':{jsx,jsxs:jsx},'@gryt/ui':{Tooltip:'Tooltip'},'@/i18n':{useTranslation:()=>({t})},'@/webRTC/src/components/MemberVoiceMediaPathAdapter':adapter,
 '../../../../components/ConnectionTopologyIcon':{ConnectionTopologyIcon:'TopologyIcon'},
}).MemberVoiceMediaStatusView;
check('bidirectional text does not conceal a relayed or unknown send path; accessible detail stays focusable',()=>{
 const e=fixture();e.send=media('send','sfu');const tree=view({path:evaluate(e)}),span=tree.props.children;
 assert.match(span.props.children[1].props.children,/收：语音直连.*发：服务器中转/);assert.doesNotMatch(span.props.children[1].props.className,/truncate/);
 assert.equal(span.props.tabIndex,0);assert.equal(span.props.role,'img');assert.equal(span.props['aria-label'],tree.props.title);assert.equal(span.props.title,tree.props.title);
 assert.match(span.props['aria-label'],/与你的语音路径.*接收.*发送.*服务器传输 RTT/);assert.doesNotMatch(span.props['aria-label'],/selected-route|local-user|server-fixture|track-receive/);
 delete e.send;assert.match(view({path:evaluate(e)}).props.children.props.children[1].props.children,/发：路径待确认/);
 let stopped=0;for(const key of ['Enter',' ','Tab'])span.props.onKeyDown({key,stopPropagation(){stopped++;}});assert.equal(stopped,2);
});
check('full path caveat, independent metric expiry and SDK contradiction are explicit in detail',()=>{
 const e=fixture();e.receive.underlay.coverage='first-hop-only';e.receive.underlay.nextHop='member';
 assert.match(view({path:evaluate(e)}).props.title,/完整底层路径未确认.*已知下一跳：某成员/);
 e.receive.metrics.observedAtMs=now-5001;assert.match(view({path:evaluate(e)}).props.title,/指标已过期/);
 e.receive.transition='confirmed-failed';assert.match(view({path:evaluate(e)}).props.title,/事实不一致/);
 assert.match(view({path:evaluate(undefined)}).props.title,/尚未接入权威语音路径观测/);assert.doesNotMatch(view({path:evaluate(undefined)}).props.title,/0 ms|0.0%/);
});
check('Chinese/English parity and English fallback cover every displayed reason/state',()=>{
 const compare=(a,b)=>{assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort());for(const k of Object.keys(a))typeof a[k]==='object'?compare(a[k],b[k]):assert.ok(a[k]&&b[k]);};compare(locales.en.memberVoicePath,locales['zh-CN'].memberVoicePath);
 for(const lang of ['zh-CN','en']){language=lang;for(const label of ['direct','member-relay','server-relay','path-pending','switching','error','pending']){
  const r=evaluate(undefined);r.receive.label=label;view({path:r});
 }}
 language='missing-language';assert.match(view({path:evaluate(undefined)}).props.title,/Voice path with you/);language='zh-CN';
});
check('actual connected member component passes exact member/publication and excludes the self relation',()=>{
 const components={MemberVoiceQuality:'VoiceQuality',MemberVoiceMediaStatus:'VoiceMediaStatus',RemoteReceiveCorrection:'ReceiveCorrection',SpeakingHalo:'SpeakingHalo',UserContextMenu:'UserContextMenu',VoiceModeIcon:'VoiceModeIcon'};
 const deps={'react/jsx-runtime':{jsx,jsxs:jsx},'@gryt/ui':{Avatar:'Avatar',Skeleton:'Skeleton'},'motion/react':{motion:{div:'motion.div'}},
  '@/i18n':{i18n:{t},useTranslation:()=>({t})},'@/webRTC/src/components/TransmitSpeechAdapter':{useTransmitSpeech:()=>false},
  '../../../../lib/icons':{PiMicrophoneSlashFill:'MicSlash',PiSpeakerSlashFill:'SpeakerSlash'},'./speakingIndicator':{tileHue:()=>120,speakingRingStyle:()=>({})}};
 for(const[name,value]of Object.entries(components))deps['./'+name]={[name]:value};
 const {ConnectedUser}=compile('src/packages/socket/src/components/connectedUser.tsx',deps);
 const collect=tree=>Array.isArray(tree)?tree.flatMap(collect):tree&&typeof tree==='object'?[tree,...collect(tree.props?.children)]:[];
 const nickname='很长的昵称'.repeat(30),props={nickname,isSpeaking:true,isMuted:false,isDeafened:false,isAFK:false,serverHost:'server-fixture',serverUserId:'remote-user',streamId:'remote-pub'};
 const nodes=collect(ConnectedUser({...props,isSelf:false,showVoiceMediaPath:true}));const badge=nodes.find(n=>n.type==='VoiceMediaStatus');
 assert.deepEqual({...badge.props},{compact:true,host:'server-fixture',member:'remote-user',publicationId:'remote-pub'});
 const name=nodes.find(n=>n.props?.['data-gryt']==='member-name');assert.equal(name.props.title,nickname);assert.match(name.props.className,/min-w-0/);assert.match(name.props.className,/truncate/);
 assert.ok(nodes.find(n=>n.type==='SpeakingHalo').props.active);assert.equal(collect(ConnectedUser({...props,isSelf:true,showVoiceMediaPath:true})).find(n=>n.type==='VoiceMediaStatus'),undefined);
 assert.equal(collect(ConnectedUser({...props,isSelf:false})).find(n=>n.type==='VoiceMediaStatus'),undefined);
});
check('single-line nickname, actual speaking halo, quality and separate LAN rows remain intact',()=>{
 const connected=read('src/packages/socket/src/components/connectedUser.tsx'),sidebar=read('src/packages/socket/src/components/MemberSidebar.tsx');
 assert.ok(connected.indexOf('<MemberVoiceMediaStatus')>connected.indexOf('data-gryt="member-name"'));
 assert.match(connected,/publicationId=\{streamId\}/);assert.match(connected,/<SpeakingHalo/);assert.match(connected,/<MemberVoiceQuality/);
 assert.doesNotMatch(sidebar,/<MemberVoiceMediaStatus/);assert.match(sidebar,/<MemberLanStatus/);
 const channels=read('src/packages/socket/src/components/ChannelList.tsx');
 assert.match(channels,/clients\[id\]\.hasJoinedChannel && clients\[id\]\.voiceChannelId === channelId/);
 assert.match(channels,/showVoiceMediaPath=\{serverHost === currentServerConnected && channelId === currentChannelId && clients\[id\]\.isConnectedToVoice === true && !!clients\[id\]\.streamID\}/);
 for(const p of ['src/lib/memberVoiceMediaPath.ts','src/packages/webRTC/src/components/MemberVoiceMediaPathAdapter.tsx','src/packages/socket/src/components/MemberVoiceMediaStatus.tsx'])assert.doesNotMatch(read(p),/useSFU|useSockets|useMicrophone|Date\.now\(|setInterval\(|fetch\(|new RTCPeerConnection/);
});
console.log(`${checks} voice model/component/adapter scenarios passed. Actual SDK authority, full ET route, browser geometry, reader, real RTP and packaging are untested.`);
