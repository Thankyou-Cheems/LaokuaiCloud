// Conformance against the integration owner's actual normalized model, not an invented SDK API.
// Optional path lets a feature owner check a frozen read-only model before integration.
import assert from "node:assert/strict";
import fs from "node:fs";
import process from "node:process";
import vm from "node:vm";

import ts from "typescript";
const root=new URL("../",import.meta.url),read=p=>fs.readFileSync(new URL(p,root),"utf8");
const jsx=(type,props)=>({type,props});let language="zh-CN";
const locales=Object.fromEntries(["en","zh-CN"].map(l=>[l,JSON.parse(read(`src/packages/i18n/locales/${l}.json`))]));
const t=(key,values={})=>{const lookup=l=>key.split(".").reduce((v,k)=>v?.[k],locales[l]);const value=lookup(language)??lookup("en");assert.equal(typeof value,"string",key);return value.replace(/\{\{(\w+)\}\}/g,(_,k)=>String(values[k]??""));};
function compile(source,dependencies={}){const result=ts.transpileModule(source,{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});assert.deepEqual(result.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error),[]);const exports={};vm.runInNewContext(result.outputText,{exports,require:name=>{assert.ok(Object.hasOwn(dependencies,name),name);return dependencies[name];}});return exports;}
const model=compile(process.argv[2]?fs.readFileSync(process.argv[2],"utf8"):read("src/lib/memberVoiceMediaPath.ts"));
const presentation=compile(read("src/packages/socket/src/components/connectionDetailsModel.ts"));
const status=compile(read("src/packages/socket/src/components/MemberVoiceMediaStatus.tsx"),{"react/jsx-runtime":{jsx,jsxs:jsx},"@gryt/ui":{Tooltip:"Tooltip"},"@/i18n":{useTranslation:()=>({t})},"@/webRTC/src/components/MemberVoiceMediaPathAdapter":{},"../../../../components/ConnectionTopologyIcon":{ConnectionTopologyIcon:"TopologyIcon"}}).MemberVoiceMediaStatusView;
const text=tree=>Array.isArray(tree)?tree.map(text).join(" "):tree&&typeof tree==="object"?text(tree.props?.children):tree??"";
const scope={authority:"authenticated-connection",accountId:"a",serverScope:"h",roomId:"r",roomGeneration:1,localServerUserId:"local",localSessionId:"local-session",localPublicationId:null,remoteServerUserId:"m",remoteSessionId:"remote-session",remotePublicationId:"microphone",connectionGeneration:1};
const selection={source:"sdk-selected-receive-media",observedAtMs:10000,selected:"sfu",availability:"usable",transition:"stable",mediaRouteId:"route",routeGeneration:1,selectionRevision:1,selectedTrackId:"audio-track",mediaProof:{source:"sdk-decoded-receive-media",observedAtMs:10000,windowStartedAtMs:9000,decodedFramesDelta:4,mediaRouteId:"route",routeGeneration:1,selectionRevision:1,selectedTrackId:"audio-track"},metrics:{source:"selected-media-stats",observedAtMs:10000,mediaRouteId:"route",routeGeneration:1,selectionRevision:1,scope:"sfu-transport",rttMs:42,loss:{packetsLost:0,packetsReceived:100,windowMs:1000}}};
const readPath=(receive=selection,nowMs=10050,currentScope=scope)=>model.readMemberVoiceMediaPath({scope:currentScope,nowMs,evidence:{schemaVersion:1,source:"authenticated-sdk-media-selection",scope,observedAtMs:10000,receive,send:{...receive,source:"authenticated-selected-send-media",mediaProof:{...receive.mediaProof,source:"authenticated-remote-decoded-media"}}}});
let checks=0;const check=(name,fn)=>{fn();checks++;console.log("PASS "+name);};
check("receive-only ordinary SFU maps the actual provider boolean/four-state transition and preserves SFU RTT",()=>{
 const path=readPath();assert.equal(path.receive.mediaAvailable,true);assert.equal(path.receive.transition,"stable");assert.equal(path.receive.label,"server-relay");assert.equal(path.send.selected,"unknown");
 for(language of ["en","zh-CN"]){const rows=presentation.connectionDetailsDirectionRows(path.receive,t);assert.equal(rows[1].value,t("connectionDetails.availability.usable"));assert.equal(rows[2].value,t("connectionDetails.transition.stable"));assert.equal(rows.find(r=>r.label===t("memberVoicePath.sfuRtt")).value,"42 ms");assert.equal(path.receive.metricsAgeMs,50);assert.equal(path.receive.lossWindowMs,1000);assert.equal(rows.find(r=>r.label===t("connectionDetails.metricsAge")).value,t("memberVoicePath.age",{seconds:"0.1"}));}
});
check("selected usable P2P is visible in compact row while unauthenticated send evidence stays receive-only",()=>{
 const path=readPath({...selection,selected:"peer",metrics:{...selection.metrics,scope:"peer-transport"}});assert.equal(path.receive.mediaAvailable,true);assert.equal(path.receive.label,"path-pending");assert.equal(path.send.label,"path-pending");
 for(language of ["en","zh-CN"]){const tree=status({path});assert.ok(text(tree).includes(t("memberVoicePath.p2pUnderlayPending")));assert.ok(text(tree).includes(t("memberVoicePath.receive")));assert.ok(!text(tree).includes(t("memberVoicePath.sendShort")));assert.ok(tree.props.title.includes(t("connectionDetails.sendNotReported")));assert.ok(tree.props.title.includes(t("memberVoicePath.peerRtt")));}
});
check("no decode proof, mismatched track and no positive delta never become confirmed usable or failed",()=>{
 for(const override of [{mediaProof:undefined},{mediaProof:{...selection.mediaProof,selectedTrackId:"old-track"}},{mediaProof:{...selection.mediaProof,decodedFramesDelta:0}},{mediaProof:{...selection.mediaProof,observedAtMs:20000}}]){const path=readPath({...selection,selected:"peer",...override});assert.equal(path.receive.mediaAvailable,false);assert.equal(presentation.connectionDetailsDirectionRows(path.receive,t)[1].value,t("connectionDetails.availability.unknown"));assert.ok(!text(status({path})).includes(t("memberVoicePath.p2pUnderlayPending")));}
});
check("switching and confirmed failure follow provider states while never refreshing metric proof",()=>{
 const switching=readPath({...selection,transition:"confirmed-switching"});assert.equal(presentation.connectionDetailsDirectionRows(switching.receive,t)[2].value,t("connectionDetails.transition.confirmed-switching"));assert.equal(switching.receive.rttMs,null);
 const failed=readPath({...selection,transition:"confirmed-failed",availability:"unavailable"});assert.equal(presentation.connectionDetailsDirectionRows(failed.receive,t)[1].value,t("connectionDetails.availability.unavailable"));assert.equal(failed.receive.rttMs,null);
});
check("TTL and independent account scope clear selection, media, compact P2P and metrics",()=>{
 for(const path of [readPath(selection,16001),readPath(selection,10050,{...scope,accountId:"other"})]){assert.equal(path.receive.selected,"unknown");assert.equal(path.receive.rttMs,null);assert.ok(!text(status({path})).includes(t("memberVoicePath.p2pUnderlayPending")));assert.equal(presentation.connectionDetailsDirectionRows(path.receive,t)[1].value,t("connectionDetails.availability.unknown"));}
});
console.log(`${checks} actual normalized Provider/UI conformance scenarios passed; SDK subscription signatures/epoch translator are integration-owner responsibilities.`);
