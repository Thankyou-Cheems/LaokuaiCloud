// Actual TS/TSX in pure VMs. No DOM, network, getStats, native process or profile.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import ts from "typescript";
const base="src/packages/socket/src/components/";
const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const locales=Object.fromEntries(["en","zh-CN"].map(l=>[l,JSON.parse(read(`src/packages/i18n/locales/${l}.json`))]));let language="zh-CN";
const t=(key,values={})=>{const lookup=l=>key.split(".").reduce((v,k)=>v?.[k],locales[l]);const s=lookup(language)??lookup("en");assert.equal(typeof s,"string",`translation ${key}`);return s.replace(/\{\{(\w+)\}\}/g,(_,k)=>String(values[k]??""));};
const jsx=(type,props)=>({type,props});let slots=[],cursor=0,effects=[];
const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==="function"?initial():initial;return[slots[i],v=>slots[i]=typeof v==="function"?v(slots[i]):v];},useRef(initial){return slots[cursor++]??={current:initial};},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,n)=>v!==old[n]))effects.push(fn);slots[i]=deps;}};
const reset=()=>{slots=[];cursor=0;effects=[];};const render=(component,props)=>{cursor=0;const tree=component(props);effects.splice(0).forEach(fn=>fn());return tree;};
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==="object"?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(" "):tree&&typeof tree==="object"?text(tree.props?.children):tree??"";
const ui=Object.fromEntries(["ContextMenu","Dialog"].map(name=>[name,Object.fromEntries(["Root","Trigger","Portal","Backdrop","Positioner","Popup","Item","Group","GroupLabel","Separator","SubmenuRoot","SubmenuTrigger","Title","Description","Footer","Close"].map(part=>[part,`${name}.${part}`]))]));ui.Button="Button";ui.Slider="Slider";
const eventDocument={fullscreenElement:null,addEventListener(){},removeEventListener(){}};
function compile(file,dependencies){const r=ts.transpileModule(read(file),{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});assert.deepEqual(r.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error),[],file);const exports={};vm.runInNewContext(r.outputText,{exports,document:eventDocument,HTMLElement:class{},MouseEvent:class{constructor(type,options){this.type=type;Object.assign(this,options);}},require:name=>{assert.ok(Object.hasOwn(dependencies,name),`${file}: ${name}`);return dependencies[name];}});return exports;}
const model=compile(base+"connectionDetailsModel.ts",{});
const pathModel=compile("src/lib/memberVoiceMediaPath.ts",{}),lanModel=compile("src/lib/memberLanStatus.ts",{"./communityDnsNames":compile("src/lib/communityDnsNames.ts",{})});
const emptyPath=pathModel.readMemberVoiceMediaPath({});
const emptyLan=lanModel.readMemberLanStatus({serverScope:"h",authenticatedUserId:"m"});
const selfLan={enrollment:"joined",path:"unknown",pathReason:"self",rttMs:null,rttReason:"self",source:"authenticated-community",observedAtMs:1000};
let clients={c:{serverUserId:"m",hasJoinedChannel:true,voiceChannelId:"r",isConnectedToVoice:true,streamID:"audio"}},sfu={currentServerConnected:"h",currentChannelConnected:"r",isConnected:true};
let requested,community={phase:"connected",reason:null},lanSnapshot,cacheClears=0,muteChanges=[],volumeChanges=[];
const sockets={sockets:{},get clients(){return {h:clients};},serverDetailsList:{h:{server_info:{server_id:"community"},channels:[]}}};
const deps={"react/jsx-runtime":{jsx,jsxs:jsx},react,"@gryt/ui":ui,"@gryt/voice":{useSFU:()=>sfu},"@/i18n":{useTranslation:()=>({t}),i18n:{t}},
"@/webRTC/src/adapters/MemberVoiceObservationAuthority":{useMemberVoiceObservationAuthority:()=>null},
"@/common":{getOwnServerUserId:()=>"self"},"@/settings":{useSettings:()=>({userVolumes:{},updateUserVolume:(id,value)=>volumeChanges.push([id,value]),resetUserVolume(){},openSettings(){}})},
"@/webRTC/src/components/MemberVoiceMediaPathAdapter":{useMemberVoiceMediaPath:(...args)=>{requested=args;return emptyPath;}},
"../../../../lib/communityLanState":{useEasyTierCommunityState:()=>community,useEasyTierMemberSnapshot:()=>({snapshot:lanSnapshot,nowMs:1000})},
"../../../../lib/memberLanStatus":lanModel,"./connectionDetailsModel":model,
"../hooks/useServerManagement":{useServerManagement:()=>({servers:{h:{serverId:"community"}}})},"../hooks/useSockets":{useSockets:()=>sockets}};
deps["@/i18n"].useTranslation=()=>({t});
const dialog=compile(base+"ConnectionDetailsDialog.tsx",deps);
const icons=Object.fromEntries(["PiAtFill","PiChatCircleFill","PiCheckBold","PiCopyFill","PiFlagFill","PiProhibitFill","PiUserPlusFill"].map(n=>[n,n]));
const menu=compile(base+"UserContextMenu.tsx",{...deps,"react-hot-toast":{default:{}},"../../../../lib/icons":icons,"@/webRTC/src/components/ReceivePriorAdapter":{useReceivePriors:()=>({available:true,clearMember:()=>cacheClears++})},"../hooks/friendsStore":{useFriendState:()=>"none",friendAction:()=>{throw Error("unexpected remote action");}},"../hooks/usePermissions":{useServerPermissions:()=>({has:()=>true,can:()=>true,roles:[{id:"owner",rank:3},{id:"member",rank:1}]})},"../lib/memberFacts":{makeRankOf:roles=>id=>roles.find(r=>r.id===id)?.rank??0},"../utils/requestVoiceMove":{requestVoiceMove:()=>{throw Error("unexpected network move");}},"./ConnectionDetailsDialog":{MemberConnectionDetailsDialog:"MemberConnectionDetailsDialog"}}).UserContextMenu;
let checks=0;const check=(label,fn)=>{fn();checks++;console.log("PASS "+label);};
check("publication resolution rejects cross-room/server, stale membership, aliases and screens",()=>{
 const input={host:"h",member:"m",currentHost:"h",currentRoom:"r",connected:true,roster:clients};assert.equal(model.connectionDetailsPublication(input),"audio");
 for(const override of [{currentHost:"other"},{currentRoom:"other"},{connected:false},{member:"other"},{roster:{c:{...clients.c,isConnectedToVoice:false}}},{roster:{c:clients.c,duplicate:clients.c}},{roster:{c:clients.c,screen:{screenShareAudioStreamID:"audio"}}}])assert.equal(model.connectionDetailsPublication({...input,...override}),undefined);
});
check("SFU RTT and peer RTT remain explicitly scoped, missing measurements are not zero",()=>{
 for(language of ["en","zh-CN"]){const d={...emptyPath.receive,selected:"sfu",label:"server-relay",reason:undefined,metricsReason:"measured",metricsScope:"sfu-transport",rttMs:71,lossPercent:0,ageMs:100};const rows=model.connectionDetailsDirectionRows(d,t);
 assert.equal(rows.find(r=>r.label===t("memberVoicePath.sfuRtt")).value,"71 ms");assert.equal(rows.find(r=>r.label===t("memberVoicePath.loss")).value,"0.0%");assert.equal(rows.find(r=>r.label===t("connectionDetails.metricsAge")).value,t("connectionDetails.notMeasured"));
 const peer=model.connectionDetailsDirectionRows({...d,metricsScope:"peer-transport",selected:"peer",rttMs:null,lossPercent:null},t);assert.equal(peer.find(r=>r.label===t("memberVoicePath.peerRtt")).value,t("connectionDetails.notMeasured"));
 for(const invalid of [{metricsReason:"expired"},{metricsReason:"invalid"},{rttMs:NaN,lossPercent:NaN},{rttMs:-1,lossPercent:101}]){const bad=model.connectionDetailsDirectionRows({...d,...invalid},t);assert.equal(bad.find(r=>r.label===t("memberVoicePath.sfuRtt")).value,t("connectionDetails.notMeasured"));assert.equal(bad.find(r=>r.label===t("memberVoicePath.loss")).value,t("connectionDetails.notMeasured"));}
 }
});
check("known logical P2P is shown while physical path and send proof remain pending",()=>{
 const d={...emptyPath.receive,selected:"peer",mediaAvailable:true,reason:"underlay-unproven",ageMs:50};const rows=model.connectionDetailsDirectionRows(d,t);assert.equal(rows[0].value,t("memberVoicePath.selected.peer"));assert.equal(rows[1].value,t("connectionDetails.availability.usable"));assert.equal(rows[3].value,t("memberVoicePath.labels.path-pending"));assert.equal(model.connectionDetailsDirectionRows(emptyPath.send,t)[0].value,t("memberVoicePath.selected.unknown"));
 const switching=model.connectionDetailsDirectionRows({...d,transition:"confirmed-switching",mediaAvailable:false,metricsAgeMs:null},t);assert.equal(switching[2].value,t("connectionDetails.transition.confirmed-switching"));assert.equal(switching[1].value,t("connectionDetails.availability.unknown"));
 const legacy=model.connectionDetailsDirectionRows({...d,mediaAvailable:undefined},t);assert.equal(legacy[1].value,t("connectionDetails.availability.unknown"));
});
check("transport summary is shown without upgrading non-TURN to direct and empty send details stay concise",()=>{
 const d={...emptyPath.receive,selected:"peer",mediaAvailable:true,label:"webrtc-non-turn",transportPath:"webrtc-non-turn",reason:undefined,ageMs:50};
 const rows=model.connectionDetailsDirectionRows(d,t);assert.equal(rows.find(r=>r.label===t("connectionDetails.transportPath")).value,t("memberVoicePath.labels.webrtc-non-turn"));assert.doesNotMatch(rows.find(r=>r.label===t("connectionDetails.physicalPath")).value,/direct|直连/i);
 const emptySend={...emptyPath.send,reason:"missing",selected:"unknown",label:"path-pending"};const send=model.connectionDetailsDirectionRows(emptySend,t,"send");assert.equal(send.length,1);assert.equal(send[0].label,t("connectionDetails.sendEvidence"));assert.equal(send[0].value,t("connectionDetails.sendNotReported"));
});
check("route status makes recovery and cooldown visible without exposing raw controller reasons",()=>{
 const d={...emptyPath.receive,selected:"peer",mediaAvailable:true,label:"webrtc-non-turn",transportPath:"webrtc-non-turn",routeStatus:"recovering",reason:undefined,ageMs:50};
 const rows=model.connectionDetailsDirectionRows(d,t);assert.equal(rows.find(r=>r.label===t("connectionDetails.routeStatus")).value,t("memberVoicePath.routeStates.recovering"));assert.doesNotMatch(rows.map(r=>r.value).join(" "),/fixture|controller/);
 const queued=model.connectionDetailsDirectionRows({...d,routeStatus:"queued"},t);assert.equal(queued.find(r=>r.label===t("connectionDetails.routeStatus")).value,t("memberVoicePath.routeStates.queued"));
});
check("voice selection copy names P2P and SFU without SDK jargon",()=>{
 for(language of ["en","zh-CN"]){assert.equal(t("memberVoicePath.selected.peer"),language==="zh-CN"?"P2P 语音通道":"P2P voice channel");assert.equal(t("memberVoicePath.selected.sfu"),language==="zh-CN"?"SFU 服务器转发":"SFU server forwarding");assert.match(t("memberVoicePath.selected.none"),language==="zh-CN"?/语音/:/voice/i);assert.match(t("memberVoicePath.selected.unknown"),language==="zh-CN"?/语音/:/voice/i);}
 language="zh-CN";
});
check("view renders both directions and independent local LAN with focus, fullscreen and bounded scroll",()=>{
 for(language of ["en","zh-CN"]){reset();const focus={current:{}},tree=render(dialog.ConnectionDetailsDialog,{open:true,onOpenChange(){},nickname:"Teammate",path:emptyPath,lan:emptyLan,community,returnFocus:focus});const all=nodes(tree),popup=all.find(n=>n.type==="Dialog.Popup");
 assert.ok(all.some(n=>n.props?.["data-gryt"]==="connection-details-receive"));assert.ok(all.some(n=>n.props?.["data-gryt"]==="connection-details-send"));assert.ok(all.some(n=>n.props?.["data-gryt"]==="connection-details-lan"));assert.equal(popup.props.finalFocus,focus);assert.equal(popup.props.initialFocus.current,null);assert.match(popup.props.style.maxHeight,/100dvh - 220px/);assert.match(popup.props.className,/overflow-y-auto/);assert.ok(all.some(n=>n.type==="Dialog.Close"));assert.ok(text(tree).includes(t("connectionDetails.communityPhase.connected")));assert.ok(text(tree).includes(t("connectionDetails.sendBoundary")));assert.ok(text(tree).includes(t("connectionDetails.transportBoundary")));}
  for(language of ["en","zh-CN"]){reset();const tree=render(dialog.ConnectionDetailsDialog,{open:true,onOpenChange(){},nickname:"Me",isSelf:true,path:emptyPath,lan:selfLan,community,lanAgeMs:1200});const all=nodes(tree),rendered=text(tree);
   assert.ok(!all.some(n=>n.props?.["data-gryt"]==="connection-details-receive"));assert.ok(!all.some(n=>n.props?.["data-gryt"]==="connection-details-send"));assert.ok(rendered.includes(t("connectionDetails.selfBoundary")));assert.ok(rendered.includes(t("memberLan.path.self")));assert.ok(!rendered.includes(t("memberLan.path.unknown")));assert.ok(!rendered.includes(t("memberLan.rttTitle")));assert.ok(!rendered.includes(t("memberLan.reason.self")));assert.ok(rendered.includes(t("memberLan.age",{seconds:"1.2"})));assert.ok(!rendered.includes(t("memberVoicePath.age",{seconds:"1.2"})));assert.equal(t("memberLan.age",{seconds:"1.2"}),language==="zh-CN"?"1.2 秒":"1.2 seconds");}
  const unverifiedSelf={enrollment:"unknown",enrollmentReason:"unverified",path:"unknown",pathReason:"unverified",rttMs:null,rttReason:"unverified"};reset();const unknownTree=render(dialog.ConnectionDetailsDialog,{open:true,onOpenChange(){},nickname:"Me",isSelf:true,path:emptyPath,lan:unverifiedSelf,community,lanAgeMs:null});const unknownText=text(unknownTree);assert.ok(unknownText.includes(t("memberLan.enrollment.unknown")));assert.ok(unknownText.includes(t("memberLan.reason.unverified")));assert.ok(!unknownText.includes(t("memberLan.path.unknown")));assert.ok(!unknownText.includes(t("memberLan.reason.self")));
  language="zh-CN";
});
check("container reads existing hooks, refuses cross-room media, and never requests a new connection",()=>{
 reset();let view=render(dialog.MemberConnectionDetailsDialog,{open:true,onOpenChange(){},nickname:"m",serverHost:"h",serverUserId:"m"});assert.deepEqual(requested,["h","m","audio"]);assert.equal(view.props.path,emptyPath);assert.equal(view.props.lan.enrollment,"unavailable");
 sfu={...sfu,currentChannelConnected:"other"};render(dialog.MemberConnectionDetailsDialog,{open:true,onOpenChange(){},nickname:"m",serverHost:"h",serverUserId:"m"});assert.equal(requested[2],undefined);
 sfu={...sfu,currentChannelConnected:"r"};render(dialog.MemberConnectionDetailsDialog,{open:true,onOpenChange(){},nickname:"self",serverHost:"h",serverUserId:"self",isSelf:true});assert.equal(requested[2],undefined);
});
check("LAN uses independently authenticated community ID rather than media host or telemetry scope",()=>{
 const binding=(id,peer)=>({authenticatedUserId:id,peerId:peer,confidence:"verified",source:"authenticated-community",observedAtMs:1000});
 const member=(id,peer)=>({binding:binding(id,peer),enrollment:{state:"joined",source:"authenticated-community",observedAtMs:1000}});
 lanSnapshot={schemaVersion:1,serverScope:"community",communityId:"network",source:"authenticated-community",observedAtMs:1000,observer:binding("self","local"),members:[member("self","local"),member("m","remote")]};
 reset();let view=render(dialog.MemberConnectionDetailsDialog,{open:true,onOpenChange(){},nickname:"m",serverHost:"h",serverUserId:"m"});assert.equal(view.props.lan.enrollment,"joined");assert.equal(view.props.lan.path,"unknown");
 lanSnapshot={...lanSnapshot,serverScope:"spoof"};view=render(dialog.MemberConnectionDetailsDialog,{open:true,onOpenChange(){},nickname:"m",serverHost:"h",serverUserId:"m"});assert.equal(view.props.lan.enrollmentReason,"scope-mismatch");lanSnapshot=undefined;
});
const props={children:"member row",serverHost:"h",serverUserId:"m",nickname:"m",isInVoice:true,role:"owner",targetRole:"member",onServerMute:v=>muteChanges.push(v),onKick(){},onBan(){},onToggleRole(){}};
check("remote context-menu action and visible more button open the real dialog without moderator or volume side effects",()=>{
 reset();let tree=render(menu,props),all=nodes(tree);assert.ok(all.some(n=>n.props?.["data-gryt"]==="connection-details-more"));const item=all.find(n=>n.props?.["data-gryt"]==="connection-details-menu-item");assert.ok(item);item.props.onClick();tree=render(menu,props);all=nodes(tree);assert.ok(all.some(n=>n.type==="MemberConnectionDetailsDialog"));assert.equal(all.find(n=>n.type==="ContextMenu.Popup").props.finalFocus,false);assert.deepEqual(muteChanges,[]);assert.deepEqual(volumeChanges,[]);assert.equal(cacheClears,0);
 const popup=all.find(n=>n.type==="MemberConnectionDetailsDialog");popup.props.onOpenChange(false);tree=render(menu,props);const more=nodes(tree).find(n=>n.props?.["data-gryt"]==="connection-details-more");const button={};more.props.onPointerDown({stopPropagation(){}});more.props.onClick({currentTarget:button,stopPropagation(){}});tree=render(menu,props);assert.equal(nodes(tree).find(n=>n.type==="MemberConnectionDetailsDialog").props.returnFocus.current,button);
});
check("self menu retains profile action; non-voice menus do not acquire a floating more button",()=>{
 reset();let tree=render(menu,{...props,isSelf:true}),all=nodes(tree);assert.ok(all.some(n=>n.props?.["data-gryt"]==="connection-details-menu-item"));assert.ok(text(tree).includes(t("socketFull.userContextMenu_45016325c7")));
 reset();tree=render(menu,{...props,isInVoice:false});assert.ok(!nodes(tree).some(n=>n.props?.["data-gryt"]==="connection-details-more"));assert.ok(nodes(tree).some(n=>n.props?.["data-gryt"]==="connection-details-menu-item"));
});
check("keyboard menu keys dispatch only on the focused row, preserving child key actions",()=>{
 reset();const tree=render(menu,props),root=nodes(tree).find(n=>n.props?.["data-gryt"]==="member-context-actions"),trigger=nodes(tree).find(n=>n.type==="ContextMenu.Trigger");const events=[];trigger.props.ref.current={dispatchEvent:e=>events.push(e)};const row={getBoundingClientRect:()=>({left:10,top:20})};let prevented=0;
 for(const key of ["ContextMenu","F10"])root.props.onKeyDown({target:row,currentTarget:row,key,shiftKey:key==="F10",preventDefault(){prevented++;},stopPropagation(){}});
 assert.equal(events.length,2);assert.equal(events[0].type,"contextmenu");assert.equal(events[0].clientX,18);assert.equal(prevented,2);root.props.onKeyDown({target:{},currentTarget:row,key:"F10",shiftKey:true});assert.equal(events.length,2);
});
check("existing volume, moderator and prior-cache callbacks remain reachable and unchanged",()=>{
 reset();const tree=render(menu,props),all=nodes(tree);const slider=all.find(n=>n.type==="Slider");assert.equal(slider.props.max,200);slider.props.onValueChange(62);assert.deepEqual(volumeChanges.at(-1),["m",62]);
 const mute=all.find(n=>n.type==="ContextMenu.Item"&&n.props.children===t("socketFull.userContextMenu_c1f034cad5"));assert.ok(mute);mute.props.onClick();assert.equal(muteChanges.at(-1),true);
 all.find(n=>n.type==="ContextMenu.Item"&&n.props.children===t("pureVoice.priorClearMember")).props.onClick();assert.equal(cacheClears,1);
});
check("production files contain no collector, fabricated history, raw endpoints or audio/profile writes",()=>{
 const source=read(base+"ConnectionDetailsDialog.tsx")+read(base+"connectionDetailsModel.ts");assert.doesNotMatch(source,/getStats\(|new RTCPeerConnection|fetch\(|\.emit\(|localStorage|sessionStorage|<polyline|bytesReceived|bytesSent|setInterval\(/);assert.ok(!source.includes("virtualIp"));
});
console.log(`${checks} production connection-details VM/model scenarios passed; DOM geometry, actual SDK/ET providers and RTP remain untested.`);
