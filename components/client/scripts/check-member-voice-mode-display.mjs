// Pure VM render of the existing glyph and authenticated store. No DOM/network/native runtime.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import ts from "typescript";
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const jsx = (type, props) => ({ type, props });
const locales = Object.fromEntries(["en", "zh-CN"].map(l => [l, JSON.parse(read(`src/packages/i18n/locales/${l}.json`))]));
let language = "zh-CN", clock = 1000, expiry;
const t = key => {const lookup = l => key.split(".").reduce((v,k) => v?.[k], locales[l]);const value = lookup(language) ?? lookup("en");assert.equal(typeof value,"string",key);return value;};
function compile(path, dependencies) {
  const result = ts.transpileModule(read(path), { reportDiagnostics:true, compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX} });
  assert.deepEqual(result.diagnostics?.filter(d => d.category===ts.DiagnosticCategory.Error),[],path);
  const exports = {};
  vm.runInNewContext(result.outputText, {exports,Date:{now:()=>clock},setInterval:fn=>(expiry=fn,1),clearInterval(){},require:name=>{assert.ok(Object.hasOwn(dependencies,name),name);return dependencies[name];}});
  return exports;
}
const model = compile("src/lib/voiceMode.ts",{});
const store = compile("src/lib/voiceModeStore.ts",{"./voiceMode":model,react:{useSyncExternalStore(subscribe,get){subscribe(()=>{});return get();}}});
const icons = Object.fromEntries(["PiBroadcastFill","PiGameControllerFill","PiKeyboardFill","PiMicrophoneFill","PiMicrophoneSlashFill","PiWarningFill"].map(name=>[name,name]));
const glyph = compile("src/packages/socket/src/components/VoiceModeIcon.tsx",{
  "react/jsx-runtime":{jsx,jsxs:jsx},"@gryt/ui":{Tooltip:"Tooltip"},"@gryt/voice":{},"@/i18n":{useTranslation:()=>({t})},"@/settings":{},
  "../../../../lib/icons":icons,"../../../../lib/squadRuntime":{},"../../../../lib/voiceMode":model,"../../../../lib/voiceModeStore":store,
}).VoiceModeGlyph;
const nodes = tree => Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==="object"?[tree,...nodes(tree.props?.children)]:[];
const text = tree => Array.isArray(tree)?tree.map(text).join(" "):tree&&typeof tree==="object"?text(tree.props?.children):tree??"";
const state = {v:1,seq:1,inputMode:"voice_activity",squad:"off",transmit:"normal"};
let checks=0;const check=(name,fn)=>{fn();checks++;console.log("PASS "+name);};
check("compact Chinese/English renders every state visibly with a focusable full explanation",()=>{
 for(language of ["en","zh-CN"])for(const inputMode of ["voice_activity","push_to_talk"])for(const squad of ["off","standby","armed","suppressed","resuming","unavailable"])for(const transmit of ["normal","manual-muted","server-muted","ptt-idle","squad-suppressed","resuming","pending","suspended","error"]){
  const tree=glyph({compact:true,state:{...state,inputMode,squad,transmit}}),visible=text(tree),root=nodes(tree).find(n=>n.props?.["data-testid"]==="voice-mode-icon");
  assert.ok(visible.includes(t(`voiceMode.${inputMode}`)));assert.ok(visible.includes(t(`voiceMode.compact.transmit.${transmit}`)));if(squad!=="off")assert.ok(visible.includes(t(`voiceMode.compact.squad.${squad}`)));
  assert.equal(root.props.tabIndex,0);assert.ok(root.props["aria-label"].includes(t(`voiceMode.transmit.${transmit}`)));assert.ok(root.props.className.includes("flex-wrap"));
 }
});
check("PTT idle/active, manual mute and confirmed Squad each have distinct glyphs",()=>{
 const render=overrides=>nodes(glyph({compact:true,state:{...state,...overrides}}));
 assert.ok(render({inputMode:"push_to_talk",transmit:"ptt-idle"}).some(n=>n.type==="PiKeyboardFill"));
 assert.ok(render({inputMode:"push_to_talk",transmit:"normal"}).some(n=>n.type==="PiBroadcastFill"));
 assert.ok(render({transmit:"manual-muted"}).some(n=>n.type==="PiMicrophoneSlashFill"));
 assert.ok(render({squad:"suppressed",transmit:"squad-suppressed"}).some(n=>n.props?.["data-testid"]==="squad-pause-glyph"));
 assert.ok(!render({squad:"armed",transmit:"pending"}).some(n=>n.props?.["data-testid"]==="squad-pause-glyph"));
});
check("missing or expired data uses an honest generic explanation in both languages",()=>{
 for(language of ["en","zh-CN"]){const tree=glyph({compact:true,state:null});assert.ok(text(tree).includes(t("voiceMode.compact.unknown")));assert.equal(tree.props.title,t("voiceMode.unknown"));assert.ok(!/old client|旧客户端/.test(tree.props.title));}
});
check("requesting Squad suppression does not claim confirmed mute",()=>{
 const input={inputMode:"voice_activity",pttActive:false,manualMuted:false,serverMuted:false,squadEnabled:true,squadStatus:"ready",gateStatus:"normal",requestedSuppression:true};
 const pending=model.deriveVoiceMode(input);assert.equal(pending.transmit,"pending");assert.equal(pending.squad,"armed");
 const confirmed=model.deriveVoiceMode({...input,gateStatus:"suppressed"});assert.equal(confirmed.transmit,"squad-suppressed");assert.equal(confirmed.squad,"suppressed");
});
check("remote states require current-room identity, increasing sequence and six-second TTL",()=>{
 const roster={c:{serverUserId:"m",hasJoinedChannel:true,voiceChannelId:"r"}};const payload={clientId:"c",serverUserId:"m",state};
 assert.equal(store.acceptVoiceMode("h",payload,roster,"other"),false);assert.equal(store.acceptVoiceMode("h",{...payload,serverUserId:"wrong"},roster,"r"),false);
 assert.equal(store.acceptVoiceMode("h",payload,roster,"r"),true);assert.equal(store.acceptVoiceMode("h",payload,roster,"r"),false);assert.equal(store.useRemoteVoiceMode("h","m").transmit,"normal");
 clock+=6001;expiry();assert.equal(store.useRemoteVoiceMode("h","m"),null);
 assert.equal(store.acceptVoiceMode("h",{...payload,state:{...state,seq:2}},roster,"r"),true);store.pruneVoiceModes("h",{c:{...roster.c,voiceChannelId:"other"}},"r");assert.equal(store.useRemoteVoiceMode("h","m"),null);
});
check("member nickname precedes a single existing mode component outside trailing icon cluster",()=>{
 const source=read("src/packages/socket/src/components/connectedUser.tsx");assert.equal((source.match(/<VoiceModeIcon/g)||[]).length,1);
 assert.ok(source.indexOf('data-gryt="member-name"')<source.indexOf("<VoiceModeIcon"));assert.ok(source.indexOf("<VoiceModeIcon")<source.indexOf('className="flex shrink-0 gap-1 items-center"'));
});
console.log(`${checks} checks passed, including 216 localized state renders. Browser geometry/runtime remains unverified.`);
