/* eslint-env node */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require=createRequire(import.meta.url);
const asar=require("@electron/asar");
const unpacked=path.join(root,"release-laokuai-squad/win-unpacked");
const extracted=path.resolve(root,process.argv[2] || "../tools/squad-static-check");
const sha=(bytes)=>createHash("sha256").update(bytes).digest("hex");
const walk=(dir)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap((entry)=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);
const hashes={};
for (const file of walk(extracted)) {
  const rel=path.relative(extracted,file);
  assert.ok(fs.existsSync(path.join(unpacked,rel)),`Unexpected portable payload: ${rel}`);
  const bytes=fs.readFileSync(file);
  hashes[rel.replaceAll("\\","/")]=sha(bytes);
  assert.equal(hashes[rel.replaceAll("\\","/")],sha(fs.readFileSync(path.join(unpacked,rel))),rel);
}
assert.equal(Object.keys(hashes).length,walk(unpacked).length,"Portable payload file count mismatch");
const resources=path.join(extracted,"resources");
const archive=path.join(resources,"app.asar");
const readPacked=(file)=>asar.extractFile(archive,file.replaceAll("/",path.sep));
const meta=JSON.parse(readPacked("package.json").toString());
assert.equal(meta.name,"laokuai-chat");
assert.equal(meta.productName,"老蒯聊");
assert.equal(meta.grytI18nTest,true);
assert.equal(meta.grytLaokuai,true);
assert.equal(meta.license,"AGPL-3.0-or-later");
assert.ok(!fs.existsSync(path.join(resources,"app-update.yml")));
assert.ok(!fs.existsSync(path.join(resources,"helper")));
assert.ok(!walk(resources).some((file)=>path.basename(file).startsWith("embedded-")));
for (const locale of ["en-US.pak","en-GB.pak","zh-CN.pak"]) assert.ok(fs.existsSync(path.join(extracted,"locales",locale)),locale);
for (const [source,packed] of [["node_modules/@gryt/voice/LICENSE","legal/VOICE-AGPL-3.0.txt"],["node_modules/@gryt/voice/third-party/Signalsmith-LICENSE.txt","legal/Signalsmith-LICENSE.txt"],["node_modules/@gryt/voice/third-party/Signalsmith-DSP-LICENSE.txt","legal/Signalsmith-DSP-LICENSE.txt"],["LICENSE","legal/CLIENT-AGPL-3.0.txt"],["node_modules/@gryt/ui/LICENSE","legal/UI-MIT.txt"],["LAOKUAI-SELF-USE.md","legal/LAOKUAI-SELF-USE.md"],["build/legal/THIRD-PARTY-NOTICES.txt","legal/THIRD-PARTY-NOTICES.txt"]]) {
  assert.equal(sha(fs.readFileSync(path.join(root,source))),sha(fs.readFileSync(path.join(resources,packed))),packed);
}
const main=readPacked("dist-electron/main.js");
assert.equal(sha(main),sha(fs.readFileSync(path.join(root,"dist-electron/main.js"))));
assert.ok(main.toString().includes("laokuai-chat-data"));
assert.ok(main.toString().includes("grytI18nTest"));
const files=asar.listPackage(archive).map((file)=>file.replaceAll("\\","/"));
const renderer=files.filter((file)=>file.startsWith("/dist/assets/") && file.endsWith(".js")).map((file)=>readPacked(file.slice(1)).toString()).join("\n");
assert.ok(renderer.includes("gryt.ui.language"));
assert.ok(renderer.includes("zh-CN"));
assert.ok(renderer.includes("receiveLevelingEnabled"));
assert.ok(renderer.includes("processorerror"));
assert.equal(sha(fs.readFileSync(path.join(resources,"icon.png"))),sha(fs.readFileSync(path.join(root,"private-brand/icon.png"))));
assert.ok(main.toString().includes("persist:laokuai-official-auth"));
assert.ok(main.toString().includes("laokuai-chat-data"));
const pe=(file)=>{
  const b=fs.readFileSync(file);
  assert.equal(b.toString("ascii",0,2),"MZ",file);
  const offset=b.readUInt32LE(0x3c);
  assert.equal(b.toString("ascii",offset,offset+4),"PE\0\0",file);
  const optional=offset+24;
  const certificate=optional+(b.readUInt16LE(optional)===0x20b?112:96)+32;
  return {machine:b.readUInt16LE(offset+4),certificateBytes:b.readUInt32LE(certificate+4)};
};
const exe=path.join(extracted,"LaoKuai-Chat.exe");
assert.equal(pe(exe).machine,0x8664);
assert.equal(pe(exe).certificateBytes,0,"Local test EXE must remain unsigned");
for (const file of ["audio-capture.exe","screen-capture.exe"]) {
  const packed=path.join(resources,"native",file);
  assert.equal(pe(packed).machine,0x8664);
  assert.equal(sha(fs.readFileSync(packed)),sha(fs.readFileSync(path.join(root,"build/native",file))));
}
const hook="node_modules/uiohook-napi/prebuilds/win32-x64/node.napi.node";
assert.equal(sha(readPacked(hook)),sha(fs.readFileSync(path.join(root,"node_modules/uiohook-napi/prebuilds/win32-x64/node.napi.node"))));
assert.equal(meta.version,"1.13.22-laokuai.squad.1");
assert.ok(renderer.includes("transmitSuppressionEnabled"));
assert.ok(renderer.includes("awaiting-suppression-ack"));
assert.ok(renderer.includes("voice:mode:capabilities"));
assert.ok(renderer.includes("squadConfig"));
assert.ok(main.toString().includes("system-suspended"));
const helper=path.join(resources,"squad/squad-scope.exe");
assert.equal(pe(helper).machine,0x8664);
assert.equal(sha(fs.readFileSync(helper)),sha(fs.readFileSync(path.join(root,"build/squad/squad-scope.exe"))));
for (const license of ["VOICE-AGPL-3.0.txt","Signalsmith-LICENSE.txt","Signalsmith-DSP-LICENSE.txt","SQUAD-MODE.md"]) assert.ok(fs.existsSync(path.join(resources,"legal",license)));
const installed=JSON.parse(fs.readFileSync(path.join(root,"node_modules/@gryt/voice/package.json")));
assert.equal(installed.version,"0.6.2-laokuai.squad.1");
const report={metadata:meta,payloadFileCount:Object.keys(hashes).length,payloadSha256:hashes,appAsarSha256:sha(fs.readFileSync(archive)),nativePEMachine:"AMD64",signed:false,mediaOrElectronExecuted:false,checked:["portable payload equals unpacked tree","independent immutable metadata","AGPL/MIT/dependency notices","Chinese and English native resources","source bundle/native helper correspondence","N-API prebuild presence","no updater feed/helper/embedded server"]};
fs.writeFileSync(path.resolve(root,"squad-static-verification.json"),JSON.stringify(report,null,2));
console.log(`Verified ${report.payloadFileCount} portable payload files; metadata, licenses, AMD64 helpers and hashes match. No executable or native addon was run.`);
