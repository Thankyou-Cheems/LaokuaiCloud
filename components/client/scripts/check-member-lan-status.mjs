// Offline presentation tests. Synthetic records only; no ET, SDK, DOM, listeners or sockets.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import ts from "typescript";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = (path, dependencies = {}, extra = "") => {
  const result = ts.transpileModule(read(path) + extra, { reportDiagnostics: true, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } });
  assert.deepEqual(result.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error), [], path);
  const exports = {};
  vm.runInNewContext(result.outputText, { exports, require(name) {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency ${name}`); return dependencies[name];
  } });
  return exports;
};
const model = compile("src/lib/memberLanStatus.ts");
const now = 1_800_000_000_000;
const binding = (user, peer) => ({ authenticatedUserId: user, peerId: peer, confidence: "verified", source: "authenticated-community", observedAtMs: now });
const enrollment = state => ({ state, source: "authenticated-community", observedAtMs: now });
const rtt = { scope: "peer", source: "easytier-local", communityId: "community-fixture", fromPeerId: "peer-local", toPeerId: "peer-remote", observedAtMs: now, ms: 24.4 };
const path = { kind: "direct", source: "easytier-local", communityId: "community-fixture", fromPeerId: "peer-local", toPeerId: "peer-remote", observedAtMs: now, rtt };
const fixture = () => ({ schemaVersion: 1, serverScope: "server-fixture", communityId: "community-fixture", source: "authenticated-community", observedAtMs: now,
  observer: binding("user-local", "peer-local"), members: [
    { binding: binding("user-local", "peer-local"), enrollment: enrollment("joined") },
    { binding: binding("user-remote", "peer-remote"), enrollment: enrollment("joined"), path: structuredClone(path) },
  ] });
const input = snapshot => ({ serverScope: "server-fixture", authenticatedUserId: "user-remote", observerAuthenticatedUserId: "user-local", snapshot, nowMs: now });
const evaluate = snapshot => model.readMemberLanStatus(input(snapshot));
const remote = snapshot => snapshot.members[1];
let checks = 0;
const check = (name, run) => { run(); checks++; console.log(`PASS ${name}`); };
check("unwired adapter is explicitly unavailable; online and nickname never imply membership", () => {
  assert.equal(model.readMemberLanStatus(input(undefined)).enrollment, "unavailable");
  const snapshot = fixture(); snapshot.members = [{ nickname: "user-remote", status: "online", enrollment: enrollment("joined") }];
  const result = evaluate(snapshot); assert.equal(result.enrollment, "unknown"); assert.equal(result.path, "unknown"); assert.equal(result.rttMs, null);
});
check("each enrollment maps independently; unjoined states discard path and RTT", () => {
  for (const state of ["off", "not-joined", "joining", "joined", "error"]) {
    const snapshot = fixture(); remote(snapshot).enrollment.state = state;
    const result = evaluate(snapshot); assert.equal(result.enrollment, state);
    if (state !== "joined") { assert.equal(result.path, "unknown"); assert.equal(result.rttMs, null); }
  }
  const snapshot = fixture(); remote(snapshot).binding.peerId = null;
  assert.equal(evaluate(snapshot).enrollment, "unknown");
  remote(snapshot).enrollment.state = "not-joined"; assert.equal(evaluate(snapshot).enrollment, "not-joined");
});
check("authenticated binding, exact server scope and non-ambiguous peer mapping are required", () => {
  for (const confidence of ["unverified", "ambiguous"]) {
    const snapshot = fixture(); remote(snapshot).binding.confidence = confidence;
    assert.equal(evaluate(snapshot).enrollment, "unknown");
  }
  for (const change of [snapshot => snapshot.serverScope = "other-server", snapshot => snapshot.source = "online-presence",
    snapshot => remote(snapshot).binding.source = "nickname-match", snapshot => snapshot.members.push(structuredClone(remote(snapshot))),
    snapshot => snapshot.members.push({ binding: binding("another-user", "peer-remote"), enrollment: enrollment("joined") })]) {
    const snapshot = fixture(); change(snapshot); assert.equal(evaluate(snapshot).enrollment, "unknown");
  }
});
check("snapshot, binding and membership expiry remove the joined claim", () => {
  for (const field of [snapshot => snapshot, snapshot => remote(snapshot).binding, snapshot => remote(snapshot).enrollment]) {
    const snapshot = fixture(); field(snapshot).observedAtMs = now - model.MEMBER_LAN_MAX_AGE_MS - 1;
    assert.equal(evaluate(snapshot).enrollment, "stale");
  }
  const snapshot = fixture(); snapshot.observedAtMs = now - model.MEMBER_LAN_MAX_AGE_MS;
  assert.equal(evaluate(snapshot).enrollment, "joined");
  assert.equal(model.readMemberLanStatus({ ...input(snapshot), nowMs: now + 1 }).enrollment, "stale");
  for (const timestamp of [NaN, Infinity, -1, now + 1]) {
    const invalid = fixture(); invalid.observedAtMs = timestamp; assert.equal(evaluate(invalid).enrollment, "unknown");
  }
  assert.equal(model.readMemberLanStatus({ ...input(fixture()), nowMs: undefined }).enrollment, "unknown");
});
check("direct, member relay and server relay require fresh local ET route evidence", () => {
  for (const kind of ["direct", "member-relay", "server-relay", "unknown"]) {
    const snapshot = fixture(); remote(snapshot).path.kind = kind;
    assert.equal(evaluate(snapshot).path, kind); assert.equal(evaluate(snapshot).rttMs, 24.4);
  }
  for (const changes of [{source:"ice-host-candidate"},{communityId:"another-community"},{fromPeerId:"someone-else"},{toPeerId:"wrong-peer"},{kind:"host"},
    {observedAtMs:now-10_001},{observedAtMs:now+1}]) {
    const snapshot=fixture(); Object.assign(remote(snapshot).path, changes);
    assert.equal(evaluate(snapshot).path,"unknown"); assert.equal(evaluate(snapshot).rttMs,null);
  }
});
check("local observer must match this authenticated account and be joined with a verified binding", () => {
  for (const change of [snapshot => snapshot.observer.confidence="unverified", snapshot => snapshot.observer.authenticatedUserId="other-account",
    snapshot => snapshot.members[0].enrollment.state="off", snapshot => snapshot.members[0].binding.peerId="other-peer",
    snapshot => snapshot.members[0].enrollment.observedAtMs=now-10_001, snapshot => snapshot.members.shift()]) {
    const snapshot=fixture();change(snapshot); assert.equal(evaluate(snapshot).path,"unknown"); assert.equal(evaluate(snapshot).rttMs,null);
  }
  assert.equal(model.readMemberLanStatus({...input(fixture()),observerAuthenticatedUserId:undefined}).path,"unknown");
  const self=model.readMemberLanStatus({...input(fixture()),authenticatedUserId:"user-local"});
  assert.equal(self.pathReason,"self");assert.equal(self.rttMs,null);
});
check("RTT has independent freshness, source, peer scope and endpoint checks; SFU RTT is rejected", () => {
  for(const changes of [{scope:"sfu"},{source:"voice-stats"},{communityId:"other-community"},{fromPeerId:"other-peer"},{toPeerId:"other-peer"},
    {ms:NaN},{ms:Infinity},{ms:-1},{ms:60_001},{observedAtMs:now+1},{observedAtMs:now-10_001}]) {
    const snapshot=fixture();Object.assign(remote(snapshot).path.rtt,changes);
    const result=evaluate(snapshot);assert.equal(result.path,"direct");assert.equal(result.rttMs,null);
  }
  const snapshot=fixture();remote(snapshot).path.rtt.ms=0;assert.equal(evaluate(snapshot).rttMs,0);
  delete remote(snapshot).path.rtt;assert.equal(evaluate(snapshot).rttMs,null);
});
const locales=Object.fromEntries(["en","zh-CN"].map(language=>[language,JSON.parse(read(`src/packages/i18n/locales/${language}.json`))]));
let language="zh-CN";
const lookup=(value,key)=>key.split('.').reduce((next,part)=>next?.[part],value);
const t=key=>{const value=lookup(locales[language],key)??lookup(locales.en,key);assert.equal(typeof value,"string",key);return value;};
const jsx=(type,props)=>({type,props});
const {MemberLanStatus}=compile("src/packages/socket/src/components/MemberLanStatus.tsx",{
  "react/jsx-runtime":{jsx,jsxs:jsx},"@gryt/ui":{Tooltip:"Tooltip"},"@/i18n":{useTranslation:()=>({t})},"../../../../lib/memberLanStatus":model,
  "../../../../components/ConnectionTopologyIcon":{ConnectionTopologyIcon:"TopologyIcon"},
});
check("compact presentation preserves full keyboard/screenreader detail while truncating only visual text",()=>{
  const tree=MemberLanStatus(input(fixture()));const span=tree.props.children;
  assert.equal(span.props.tabIndex,0);assert.equal(span.props.role,"img");assert.equal(span.props['aria-label'],tree.props.title);
  assert.equal(span.props.title,tree.props.title);assert.match(span.props.className,/min-w-0 max-w-full/);
  assert.match(span.props.children[1].props.className,/truncate/);assert.equal(span.props.children[1].props['aria-hidden'],"true");
  assert.match(span.props['aria-label'],/成员 RTT/);assert.match(span.props['aria-label'],/社区联机与语音媒体路径独立/);
  assert.doesNotMatch(span.props['aria-label'],/尚未接入/);
  assert.doesNotMatch(span.props['aria-label'],/peer-local|peer-remote|user-remote|community-fixture|server-fixture/);
  let stopped=0;span.props.onKeyDown({key:"Enter",stopPropagation(){stopped++;}});span.props.onKeyDown({key:" ",stopPropagation(){stopped++;}});
  span.props.onKeyDown({key:"Tab",stopPropagation(){stopped++;}});assert.equal(stopped,2);
});
check("the local member uses the verified self reading instead of a member path",()=>{
  for(language of ["zh-CN","en"]){
    const tree=MemberLanStatus({...input(fixture()),authenticatedUserId:"user-local"});const span=tree.props.children;
    const label=span.props.children[1].props.children;
    assert.equal(label,`${t("memberLan.enrollment.joined")} · ${t("memberLan.path.self")}`);
    assert.equal(span.props.children[0].props.kind,"local");
    assert.doesNotMatch(span.props["aria-label"],/成员 RTT|Measured peer RTT|未知|Unknown/);
  }
  const unverified=fixture();unverified.members[0].binding.confidence="unverified";
  const missing=MemberLanStatus({...input(unverified),authenticatedUserId:"user-local"});
  assert.equal(missing.props.children.props["data-enrollment"],"unknown");
  assert.equal(missing.props.children.props.children[0].props.kind,"unknown");
  assert.doesNotMatch(missing.props.children.props.children[1].props.children,/本机|This device/);
  language="zh-CN";
});
check("green is reserved for fresh verified membership; expired RTT remains explicit",()=>{
  for(const state of ['off','not-joined','joining','error']){
    const snapshot=fixture();remote(snapshot).enrollment.state=state;
    assert.doesNotMatch(MemberLanStatus(input(snapshot)).props.children.props.style.color,/success/);
  }
  assert.doesNotMatch(MemberLanStatus(input(undefined)).props.children.props.style.color,/success/);
  const stale=fixture();stale.observedAtMs=now-10_001;assert.doesNotMatch(MemberLanStatus(input(stale)).props.children.props.style.color,/success/);
  const snapshot=fixture();remote(snapshot).path.rtt.observedAtMs=now-10_001;
  const span=MemberLanStatus(input(snapshot)).props.children;assert.match(span.props.style.color,/success/);assert.match(span.props.children[1].props.children,/已过期/);
  remote(snapshot).path.observedAtMs=now-10_001;assert.match(MemberLanStatus(input(snapshot)).props.children.props.children[1].props.children,/路径过期/);
});
check("LAN icon geometry follows proven route or enrollment; unknown/stale never borrow direct",()=>{
  for(const path of ['direct','member-relay','server-relay','unknown']){
    const snapshot=fixture();remote(snapshot).path.kind=path;
    assert.equal(MemberLanStatus(input(snapshot)).props.children.props.children[0].props.kind,path);
  }
  for(const [state,icon]of [['joining','connecting'],['off','disconnected'],['not-joined','disconnected'],['error','disconnected']]){
    const snapshot=fixture();remote(snapshot).enrollment.state=state;
    assert.equal(MemberLanStatus(input(snapshot)).props.children.props.children[0].props.kind,icon);
  }
  const stale=fixture();stale.observedAtMs=now-10_001;
  assert.equal(MemberLanStatus(input(stale)).props.children.props.children[0].props.kind,'unknown');
});
check("EN/ZH mappings cover every state/reason and route; no arbitrary errors, IPs or keys are rendered",()=>{
  function compare(a,b){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort());for(const key of Object.keys(a))typeof a[key]==='object'?compare(a[key],b[key]):assert.ok(a[key]&&b[key]);}
  compare(locales.en.memberLan,locales['zh-CN'].memberLan);
  const snapshot=fixture();snapshot.publicIP="198.51.100.1";remote(snapshot).secretKey="fixture-secret";remote(snapshot).enrollment.error="unsafe diagnostic";
  assert.doesNotMatch(MemberLanStatus(input(snapshot)).props.title,/198\.51|fixture-secret|unsafe diagnostic/);
  language='en';assert.match(MemberLanStatus(input(undefined)).props.title,/No EasyTier adapter/);
});
check("member row integration retains nickname width and does not derive LAN evidence from voice state",()=>{
  const source=read("src/packages/socket/src/components/MemberSidebar.tsx");
  assert.match(source,/<div className="flex min-w-0 items-center gap-1">/);
  assert.ok(source.indexOf('<MemberLanStatus')>source.indexOf('{member.nickname}'));
  assert.match(source,/authenticatedUserId=\{member.serverUserId\}/);assert.match(source,/observerAuthenticatedUserId=\{currentServerUserId\}/);
  assert.match(source,/snapshot=\{lanSnapshot\} nowMs=\{lanNowMs\}/);assert.match(source,/lanSnapshot=\{lanSnapshot\}/);
  assert.doesNotMatch(read('src/lib/memberLanStatus.ts')+read('src/packages/socket/src/components/MemberLanStatus.tsx'),/useSFU|useSockets|useMicrophone|Date\.now\(|setInterval\(|fetch\(/);
  for(const path of ['src/packages/socket/src/components/MemberSidebar.tsx','src/packages/socket/src/components/MemberSidebarPanel.tsx']){
    const result=ts.transpileModule(read(path),{reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}});
    assert.deepEqual(result.diagnostics.filter(item=>item.category===ts.DiagnosticCategory.Error),[]);
  }
});
check("actual member list passes scope, local identity and telemetry through without using the voice room",()=>{
  const popover=Object.fromEntries(['Root','Trigger','Portal','Positioner','Popup'].map(name=>[name,'Popover.'+name]));
  const components={BotTag:'BotTag',GameIcon:'GameIcon',MemberIdentityCard:'MemberIdentityCard',NameTag:'NameTag',PluginPanels:'PluginPanels',UnreadIndicator:'UnreadIndicator',UserContextMenu:'UserContextMenu'};
  const dependencies={
    'react/jsx-runtime':{jsx,jsxs:jsx},'@gryt/ui':{Avatar:'Avatar',IconButton:'IconButton',Popover:popover,Tooltip:'Tooltip'},
    react:{useCallback:fn=>fn,useMemo:fn=>fn(),useState:value=>[value,()=>{}]},
    '@/common':{resolveAvatarSrc:()=>undefined,getUploadsFileUrl(){throw Error('no real uploads');},useTheme:()=>({resolvedAppearance:'light'})},
    '@/i18n':{i18n:{t},useTranslation:()=>({t})},
    '../../../../lib/icons':{PiPushPinFill:'Pin',PiPushPinSlashFill:'Unpin'},
    '../../../lib/nameTags':{nameTags:()=>new Map()},'../hooks/dmDirectory':{useDirectory:()=>[]},
    '../hooks/useDirectoryUnread':{useDirectoryUnread:()=>({countFor:()=>0})},'../hooks/usePermissions':{useServerPermissions:()=>({roles:[]})},
    './memberCard/memberCardContext':{MEMBER_CARD_POPUP:'popup'},'./memberGroups':{groupMembersByRole:members=>[{key:'all',title:'Members',members}],readableRoleColor:()=>undefined},
    './MemberLanStatus':{MemberLanStatus},'./MemberVoiceMediaStatus':{MemberVoiceMediaStatus:'VoiceMediaStatus'},'./memberStatus':{statusConfig:{online:{label:'Online',color:'gray'}}},
  };
  for(const [name,value]of Object.entries(components))dependencies['./'+name]={[name]:value};
  const {MemberSidebar,MemberItem}=compile('src/packages/socket/src/components/MemberSidebar.tsx',dependencies,'\nexport { MemberItem };\n');
  const collect=tree=>Array.isArray(tree)?tree.flatMap(collect):tree&&typeof tree==='object'?[tree,...collect(tree.props?.children)]:[];
  const nickname='很长的昵称'.repeat(50),snapshot=fixture();
  const props={members:[{serverUserId:'user-remote',nickname,status:'online',hasJoinedChannel:false,color:'gray'}],serverHost:'server-fixture',currentServerUserId:'user-local',lanSnapshot:snapshot,lanNowMs:now};
  for(const currentServerConnected of [null,'unrelated-voice-server']){
    const list=MemberSidebar({...props,currentServerConnected});
    const member=collect(list).find(node=>node.type===MemberItem);assert.equal(member.props.lanSnapshot,snapshot);assert.equal(member.props.lanNowMs,now);
    const row=MemberItem(member.props),badge=collect(row).find(node=>node.type===MemberLanStatus);
    assert.equal(badge.props.authenticatedUserId,'user-remote');assert.equal(badge.props.observerAuthenticatedUserId,'user-local');assert.equal(badge.props.serverScope,'server-fixture');
    assert.equal(model.readMemberLanStatus(badge.props).path,'direct');
    const name=collect(row).find(node=>node.type==='span'&&node.props.children===nickname);
    assert.equal(name.props.style.minWidth,0);assert.equal(name.props.style.textOverflow,'ellipsis');
    const nameContainer=collect(row).find(node=>node.props?.style?.flex===1);assert.equal(nameContainer.props.style.minWidth,0);
    assert.ok(collect(nameContainer).some(node=>node.type===MemberLanStatus),'LAN status stays beneath the nickname in its existing flexible column');
  }
});
console.log(`${checks} LAN model/component/source scenarios passed. Geometry, actual ET connection and voice media paths are untested.`);
