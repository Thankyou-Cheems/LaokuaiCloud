/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { describe,readAsar,verifyPayload,verifyPortable,iconPayloads,writeSquadReceipt,checkSquadReceipt,readTarGz,assertPackedFileScope } = require("./laokuai-package-audit.cjs");
const fixtureRoot = path.resolve(import.meta.dirname,"../build");
fs.mkdirSync(fixtureRoot,{recursive:true});
const temp = fs.mkdtempSync(path.join(fixtureRoot,"package-audit-synthetic-"));
let cases = 0;
const check = (name,fn) => { fn(); cases++; console.log(`PASS ${name}`); };
const write = (file,bytes) => { const dest = path.join(temp,file); fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes); };
// Header-only synthetic PE: no machine code, cannot run.
const pe = Buffer.alloc(512); pe.write("MZ");pe.writeUInt32LE(128,60);pe.write("PE\0\0",128);pe.writeUInt16LE(0x8664,132);pe.writeUInt16LE(0x20b,152);
pe.writeUInt16LE(1,134);pe.writeUInt16LE(240,148);pe.writeUInt32LE(512,212);pe.writeUInt32LE(16,260);
pe.writeUInt32LE(1,400);pe.writeUInt32LE(0x1000,404);pe.writeUInt32LE(512,412);
const image = Buffer.from("synthetic ICO image payload"), iconPe=Buffer.alloc(2048);pe.copy(iconPe);
iconPe.writeUInt16LE(1,134);iconPe.writeUInt16LE(240,148);iconPe.writeUInt32LE(0x1000,280);
iconPe.writeUInt32LE(1024,400);iconPe.writeUInt32LE(0x1000,404);iconPe.writeUInt32LE(1024,408);iconPe.writeUInt32LE(512,412);
for(const [offset,id,target] of [[0,3,0x80000018],[24,1,0x80000030],[48,1033,72]]) {
  iconPe.writeUInt16LE(1,512+offset+14);iconPe.writeUInt32LE(id,512+offset+16);iconPe.writeUInt32LE(target,512+offset+20);
}
iconPe.writeUInt32LE(0x1000+88,584);iconPe.writeUInt32LE(image.length,588);image.copy(iconPe,600);
function asar(entries) {
  const header = {files:{}}, chunks = []; let offset = 0;
  for (const [file,value] of Object.entries(entries)) {
    const bytes = Buffer.from(value);let node = header;
    const parts = file.split("/"); for (const part of parts.slice(0,-1)) node = node.files[part] ||= {files:{}};
    node.files[parts.at(-1)] = {size:bytes.length,offset:String(offset)};chunks.push(bytes);offset+=bytes.length;
  }
  const json = Buffer.from(JSON.stringify(header)), headerSize = 8+Math.ceil(json.length/4)*4;
  const first = Buffer.alloc(8+headerSize);first.writeUInt32LE(4,0);first.writeUInt32LE(headerSize,4);first.writeUInt32LE(headerSize-4,8);first.writeUInt32LE(json.length,12);json.copy(first,16);
  return Buffer.concat([first,...chunks]);
}
try {
  check("raw and electron-builder normalized scopes preserve exact patterns",()=>{
    const patterns=["dist/**/*","dist-electron/**/*"];
    assert.deepEqual(assertPackedFileScope(patterns),patterns);
    assert.deepEqual(assertPackedFileScope([{filter:patterns}]),patterns);
  });
  check("normalized scope cannot broaden or redirect",()=>{
    assert.throws(()=>assertPackedFileScope([{filter:["dist/**/*","dist-electron/**/*","**/*"]}]));
    assert.throws(()=>assertPackedFileScope([{from:"..",filter:["dist/**/*","dist-electron/**/*"]}]));
    assert.throws(()=>assertPackedFileScope([{to:"other",filter:["dist/**/*","dist-electron/**/*"]}]));
  });
  check("mixed or multiple FileSets are rejected",()=>{
    assert.throws(()=>assertPackedFileScope(["dist/**/*",{filter:["dist-electron/**/*"]}]));
    assert.throws(()=>assertPackedFileScope([{filter:["dist/**/*"]},{filter:["dist-electron/**/*"]}]));
  });
  check("missing duplicate or reordered patterns are rejected",()=>{
    assert.throws(()=>assertPackedFileScope([{filter:["dist/**/*"]}]));
    assert.throws(()=>assertPackedFileScope([{filter:["dist/**/*","dist/**/*"]}]));
    assert.throws(()=>assertPackedFileScope([{filter:["dist-electron/**/*","dist/**/*"]}]));
  });
  write("native/squad-scope/main.cpp","synthetic dynamic key source");write("native/squad-scope/build.bat","synthetic compile command");write("build/squad/squad-scope.exe",pe);
  check("old helper without receipt is rejected",()=>assert.throws(()=>checkSquadReceipt(temp),/missing helper build receipt/));
  check("matching synthetic helper receipt is accepted",()=>{writeSquadReceipt(temp);checkSquadReceipt(temp);});
  check("changed helper source is rejected",()=>{write("native/squad-scope/main.cpp","changed");assert.throws(()=>checkSquadReceipt(temp),/source\/build changes/);write("native/squad-scope/main.cpp","synthetic dynamic key source");});
  check("changed helper binary is rejected",()=>{const changed=Buffer.from(pe);changed[400]^=1;write("build/squad/squad-scope.exe",changed);assert.throws(()=>checkSquadReceipt(temp),/Stale Squad/);});
  const manifest = {schema:1,sourceOnly:false,version:"synthetic-version",voice:{version:"synthetic-alias"},productName:"唠蒯云",packagedName:"laokuai-chat",executable:"唠蒯云.exe",
    appIconPayloads:[describe(image).sha256],packedFiles:{"dist/index.html":describe(Buffer.from("synthetic renderer")),"dist-electron/main.js":describe(Buffer.from("synthetic main"))},resources:{}};
  const entries = {"package.json":JSON.stringify({name:manifest.packagedName,version:manifest.version,productName:manifest.productName,grytI18nTest:true,grytLaokuai:true,license:"AGPL-3.0-or-later"}),
    "dist/index.html":"synthetic renderer","dist-electron/main.js":"synthetic main","node_modules/uiohook-napi/prebuilds/win32-x64/node.napi.node":pe};
  const packed = file => write("payload/resources/app.asar",asar(file));
  packed(entries);write("payload/唠蒯云.exe",iconPe);
  for (const file of ["native/audio-capture.exe","native/screen-capture.exe","squad/squad-scope.exe"]) {
    write(`payload/resources/${file}`,pe);manifest.resources[file]={...describe(pe),source:"synthetic"};
  }
  for (const name of ["easytier-core.exe","easytier-cli.exe"]) {
    const file=`community-lan/product/2.7.0-laokuai/${name}`;
    write(`payload/resources/${file}`,pe);manifest.resources[file]={...describe(pe),source:"synthetic-non-executable-PE-header"};
  }
  for (const locale of ["en-US","en-GB","zh-CN"]) write(`payload/locales/${locale}.pak`,"synthetic");
  const payload = path.join(temp,"payload");
  check("minimal synthetic archive metadata/resources pass",()=>assert.equal(verifyPayload(payload,manifest).status,"passed"));
  check("PE icon tree payload matches authorized hashes",()=>{assert.deepEqual(iconPayloads(iconPe),manifest.appIconPayloads);assert.equal(verifyPortable(path.join(payload,"唠蒯云.exe"),manifest).iconPayloads.length,1);});
  check("replaced PE icon is rejected",()=>{const changed=Buffer.from(iconPe);changed[600]=0;write("payload/唠蒯云.exe",changed);assert.throws(()=>verifyPayload(payload,manifest),/approved brand ICO/);write("payload/唠蒯云.exe",iconPe);});
  check("changed renderer bytes are rejected",()=>{packed({...entries,"dist/index.html":"old renderer"});assert.throws(()=>verifyPayload(payload,manifest),/dist\/index.html/);packed(entries);});
  check("missing resource is rejected",()=>{fs.unlinkSync(path.join(payload,"resources/squad/squad-scope.exe"));assert.throws(()=>verifyPayload(payload,manifest),/ENOENT/);write("payload/resources/squad/squad-scope.exe",pe);});
  check("official updater feed is rejected",()=>{write("payload/resources/app-update.yml","provider: github");assert.throws(()=>verifyPayload(payload,manifest));fs.unlinkSync(path.join(payload,"resources/app-update.yml"));});
  check("capture DLL cannot be added to final payload",()=>{write("payload/resources/Packet.dll",pe);assert.throws(()=>verifyPayload(payload,manifest),/capture DLL/);fs.unlinkSync(path.join(payload,"resources/Packet.dll"));});
  check("source-only inventory cannot approve archive",()=>assert.throws(()=>verifyPayload(payload,{...manifest,sourceOnly:true}),/source-only/));
  check("malformed ASAR header is rejected",()=>{write("bad.asar",Buffer.alloc(32));assert.throws(()=>readAsar(path.join(temp,"bad.asar")),/pickle header/);});
  check("locked real vendor tar is read without loading SDK",()=>{
    const pkg=JSON.parse(fs.readFileSync(new URL("../package.json",import.meta.url)));
    const dependency=pkg.devDependencies["@gryt/voice"];
    assert.ok(dependency.startsWith("file:vendor/"));
    const archive=readTarGz(path.resolve(import.meta.dirname,"..",dependency.slice(5)));
    const sdk=JSON.parse(archive.get("package/package.json"));
    assert.equal(sdk.name,"@gryt/voice");
    assert.equal(path.basename(dependency),`gryt-voice-${sdk.version}.tgz`);
    const lock=fs.readFileSync(new URL("../yarn.lock",import.meta.url),"utf8");
    const header=`"@gryt/voice@${dependency}":`;
    const start=lock.indexOf(header);assert.ok(start>=0);
    const entry=lock.slice(start,lock.indexOf("\n\n",start));
    assert.ok(entry.includes(`version "${sdk.version}"`));
    assert.ok(entry.includes(`resolved "${dependency}#`));
  });
  console.log(`${cases} pure file scenarios passed; synthetic PE bytes were never executed`);
} finally { assert.ok(temp.startsWith(fixtureRoot+path.sep));fs.rmSync(temp,{recursive:true,force:true}); }
