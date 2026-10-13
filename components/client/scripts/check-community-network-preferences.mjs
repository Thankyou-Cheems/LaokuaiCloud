/* eslint-env node */
// Offline settings/import/export checks. No native IPC, user files or network.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import ts from "typescript";

import * as preferences from "../src/lib/communityNetworkPreferences.ts";

const defaults = preferences.DEFAULT_COMMUNITY_NETWORK_PREFERENCES;
assert.deepEqual(defaults, {schemaVersion:1,magicDns:true,latencyFirst:false,ipv6:true,upnp:true,udpHolePunching:true,tcpHolePunching:true,udpBroadcast:false});
assert.deepEqual(preferences.parseCommunityNetworkPreferences(preferences.exportCommunityNetworkPreferences(defaults)), defaults);
for (const invalid of [null, [], {}, {...defaults,schemaVersion:2}, {...defaults,magicDns:"true"}, {...defaults,password:"secret"},
  {...defaults,instanceId:"private"}, {...defaults,privateKey:"secret"}, {...defaults,absolutePath:"C:/private"}, JSON.stringify(defaults)+" ".repeat(8192),
  Object.create(defaults), new Date(), {...defaults,[Symbol("extra")]:true}]) assert.throws(()=>preferences.parseCommunityNetworkPreferences(invalid));
for (const key of preferences.COMMUNITY_NETWORK_BOOLEAN_KEYS) {
  const partial = {...defaults}; delete partial[key]; assert.throws(()=>preferences.parseCommunityNetworkPreferences(partial));
}
let getterReads=0;
const accessor={...defaults};Object.defineProperty(accessor,"magicDns",{enumerable:true,get(){getterReads++;return true;}});
assert.throws(()=>preferences.parseCommunityNetworkPreferences(accessor));assert.equal(getterReads,0);
const candidate={...defaults,magicDns:false,latencyFirst:true};
assert.deepEqual(preferences.communityNetworkPreferenceChanges({...defaults},candidate),["magicDns","latencyFirst"]);

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const locale=JSON.parse(read("src/packages/i18n/locales/zh-CN.json"));
const t=key=>{const value=key.split('.').reduce((next,part)=>next?.[part],locale);assert.equal(typeof value,"string",key);return value;};
const states=[],effects=[],calls=[],downloads=[];let cursor=0;
const api={getNetworkPreferences:async()=>({...defaults}),setNetworkPreferences:async value=>{calls.push(value);return{preferences:value,reconnectRequired:true};}};
const jsx=(type,props)=>({type,props});
// Normalization models structured IPC data while the test component is in a VM realm.
const normalize=value=>preferences.parseCommunityNetworkPreferences(typeof value==="string"?value:JSON.stringify(value));
const prefsDependency={...preferences,parseCommunityNetworkPreferences:normalize,
  exportCommunityNetworkPreferences:value=>preferences.exportCommunityNetworkPreferences(normalize(value)),
  communityNetworkPreferenceChanges:(a,b)=>preferences.communityNetworkPreferenceChanges(normalize(a),normalize(b))};
const dependencies={"react/jsx-runtime":{jsx,jsxs:jsx},"@gryt/ui":{Alert:"Alert",Button:"Button",Switch:"Switch"},
  react:{useState(initial){const index=cursor++;if(!(index in states))states[index]=initial;return[states[index],value=>{states[index]=typeof value==="function"?value(states[index]):value;}];},useEffect(run){if(!effects.length)effects.push(run);}},
  "@/i18n":{useTranslation:()=>({t})},"../../../../lib/communityNetworkPreferences":prefsDependency,"./settingsComponents":{SettingsContainer:"SettingsContainer"},
  "./memberRelaySettings":{MemberRelaySettings:"MemberRelaySettings"}};
const source=ts.transpileModule(read("src/packages/settings/src/components/communityNetworkSettings.tsx"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const exports={};
vm.runInNewContext(source,{exports,window:{easyTierCommunity:api},URL:{createObjectURL(blob){downloads.push({text:blob.parts.join("")});return"blob:fixture";},revokeObjectURL(){}},
  Blob:class{constructor(parts){this.parts=parts;}},document:{createElement(){return{click(){downloads.at(-1).filename=this.download;}};}},
  require:key=>{assert.ok(Object.hasOwn(dependencies,key),key);return dependencies[key];}});
const render=()=>{cursor=0;return exports.CommunityNetworkSettings();};
const collect=tree=>Array.isArray(tree)?tree.flatMap(collect):tree&&typeof tree==='object'?[tree,...collect(tree.props?.children)]:[];
const button=(tree,key)=>collect(tree).find(node=>node.type==="Button"&&node.props.children===t(key));
const flush=async()=>{for(let count=0;count<8;count++)await Promise.resolve();};
let tree=render();effects[0]();await flush();tree=render();
assert.equal(collect(tree).filter(node=>node.type==="Switch").length,7);
assert.ok(collect(tree).filter(node=>node.type==="Switch").every(node=>!node.props.disabled));
const magic=collect(tree).find(node=>node.type==="Switch"&&node.props.id==="community-network-magicDns");magic.props.onCheckedChange(false);
assert.equal(calls.length,0,"editing a preference cannot reconnect or write native settings");
tree=render();assert.equal(button(tree,"communityNetwork.save").props.disabled,false);await button(tree,"communityNetwork.save").props.onClick();await flush();tree=render();
assert.equal(calls.length,1);assert.equal(calls[0].magicDns,false);assert.ok(collect(tree).some(node=>node.type==="Alert"&&node.props.children===t("communityNetwork.saved")));
button(tree,"communityNetwork.export").props.onClick();assert.equal(downloads.length,1);
assert.equal(downloads[0].filename,"laokuai-network-preferences.v1.json");assert.deepEqual(JSON.parse(downloads[0].text),calls[0]);
const input=collect(tree).find(node=>node.type==="input");
input.props.onChange({target:{files:[{size:100,text:async()=>JSON.stringify(candidate)}],value:"fixture"}});await flush();tree=render();
assert.ok(collect(tree).some(node=>node.type==="h4"&&node.props.children===t("communityNetwork.preview")));assert.equal(calls.length,1,"import preview must not save automatically");
assert.equal(button(tree,"communityNetwork.applyImport").props.disabled,false);await button(tree,"communityNetwork.applyImport").props.onClick();await flush();
assert.equal(calls.length,2);assert.deepEqual(calls[1],candidate);
tree=render();const savedCount=calls.length;const nextInput=collect(tree).find(node=>node.type==="input");
nextInput.props.onChange({target:{files:[{size:100,text:async()=>JSON.stringify({...defaults,password:"secret"})}],value:"fixture"}});await flush();tree=render();
assert.equal(calls.length,savedCount);assert.ok(collect(tree).some(node=>node.type==="Alert"&&node.props.children===t("communityNetwork.invalidImport")));
nextInput.props.onChange({target:{files:[{size:8193,text(){throw Error("oversize must not be read");}}],value:"fixture"}});assert.equal(calls.length,savedCount);
assert.match(read("src/components/sidebar.tsx"),/data-gryt="community-network-settings"[\s\S]*?openSettings\("network"\)/);
assert.match(read("src/packages/settings/src/components/settings.tsx"),/value: "network"[\s\S]*?<CommunityNetworkSettings/);
console.log("Community network preferences: strict schema/defaults/size/accessor/secret rejection, staged settings save, safe export, import preview/confirmation and sidebar destination passed; no native calls");
