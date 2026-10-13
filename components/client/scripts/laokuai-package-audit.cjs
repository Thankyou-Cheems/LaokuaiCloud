/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
// Pure file inspection. Never loads an Electron/native module or starts a process.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { gunzipSync } = require("node:zlib");
const { inspectPeImports } = require("./inspect-pe-imports.cjs");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const slash = value => value.replaceAll("\\", "/");
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))
  .flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]);
const describe = bytes => ({ bytes: bytes.length, sha256: sha(bytes) });

// Follow only emitted relative ESM imports from the entry. The admin gate must
// remain separate from the runtime, whose marker checks still apply transitively.
function readMainBundle(read) {
  const visited = new Set(), sources = [];
  function visit(file) {
    assert.ok(file.startsWith("dist-electron/") && !file.includes(".."), "Main chunk escapes bundle");
    if (visited.has(file)) return;
    visited.add(file);
    const source = read(file).toString(); sources.push(source);
    for (const match of source.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)(["'])(\.\.?\/[^"']+\.js)\1/g)) {
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[2])));
    }
  }
  visit("dist-electron/main.js");
  return sources.join("\n");
}

function readTarGz(file) {
  const tar = gunzipSync(fs.readFileSync(file)), files = new Map();
  for (let pos = 0; pos + 512 <= tar.length;) {
    const header = tar.subarray(pos,pos+512);
    if (header.every(byte => byte === 0)) break;
    const field = (start,length) => header.toString("utf8",start,start+length).split("\0")[0];
    const size = parseInt(field(124,12).trim() || "0",8);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && pos+512+size <= tar.length,"Invalid vendor tar entry");
    const prefix = field(345,155), name = (prefix ? `${prefix}/` : "") + field(0,100);
    const type = field(156,1);
    if (type === "0" || type === "") {
      assert.ok(!files.has(name),`Duplicate tar entry ${name}`);
      files.set(name,tar.subarray(pos+512,pos+512+size));
    } else assert.ok(type === "5" || type === "x" || type === "g",`Unsupported tar entry ${name}: ${type}`);
    pos += 512 + Math.ceil(size/512)*512;
  }
  return files;
}

function inspectPe(bytes) {
  assert.equal(bytes.toString("ascii",0,2),"MZ");
  const pe = bytes.readUInt32LE(0x3c);
  assert.equal(bytes.toString("ascii",pe,pe+4),"PE\0\0");
  const optional = pe+24, directory = optional+(bytes.readUInt16LE(optional) === 0x20b ? 112 : 96);
  return { machine: bytes.readUInt16LE(pe+4), certificateBytes: bytes.readUInt32LE(directory+36) };
}

function iconPayloads(bytes) {
  inspectPe(bytes);
  const pe = bytes.readUInt32LE(60), optional = pe+24;
  const directory = optional+(bytes.readUInt16LE(optional) === 0x20b ? 112 : 96);
  const sections = optional+bytes.readUInt16LE(pe+20), ranges = [];
  for (let i=0;i<bytes.readUInt16LE(pe+6);i++) {
    const p=sections+i*40;
    ranges.push({rva:bytes.readUInt32LE(p+12),size:Math.max(bytes.readUInt32LE(p+8),bytes.readUInt32LE(p+16)),raw:bytes.readUInt32LE(p+20)});
  }
  const address = rva => {
    const range = ranges.find(r => rva >= r.rva && rva < r.rva+r.size);
    assert.ok(range,`Unmapped PE resource RVA ${rva}`);return range.raw+rva-range.rva;
  };
  const base = address(bytes.readUInt32LE(directory+16)), hashes = new Set(), visited = new Set();
  const visit = (offset,route) => {
    assert.ok(route.length < 8 && !visited.has(offset),"Invalid PE resource tree");visited.add(offset);
    const p=base+offset,count=bytes.readUInt16LE(p+12)+bytes.readUInt16LE(p+14);
    for(let i=0;i<count;i++) {
      const name=bytes.readUInt32LE(p+16+i*8),target=bytes.readUInt32LE(p+20+i*8),ids=[...route,name];
      if(target & 0x80000000) visit(target & 0x7fffffff,ids);
      else if(ids[0] === 3) {
        const entry=base+target,size=bytes.readUInt32LE(entry+4),start=address(bytes.readUInt32LE(entry));
        assert.ok(start+size <= bytes.length);hashes.add(sha(bytes.subarray(start,start+size)));
      }
    }
  };
  visit(0,[]);return [...hashes].sort();
}
function verifyPortable(file,manifest) {
  const bytes=fs.readFileSync(file),pe=inspectPe(bytes);
  assert.ok([0x14c,0x8664].includes(pe.machine),"Portable wrapper must be x86/AMD64");
  assert.equal(pe.certificateBytes,0,"Private portable wrapper must be unsigned");
  const icons=iconPayloads(bytes);
  for(const hash of manifest.appIconPayloads) assert.ok(icons.includes(hash),"Portable wrapper misses approved brand ICO payload");
  return {...describe(bytes),machine:pe.machine,iconPayloads:icons};
}

const squadInputs = ["native/squad-scope/main.cpp","native/squad-scope/build.bat"];
function writeSquadReceipt(root) {
  const binary = fs.readFileSync(path.join(root,"build/squad/squad-scope.exe"));
  assert.equal(inspectPe(binary).machine,0x8664,"Squad helper must be AMD64");
  const receipt = { schema: 1, binary: describe(binary), inputs: Object.fromEntries(squadInputs
    .map(file => [file,describe(fs.readFileSync(path.join(root,file)))])) };
  fs.writeFileSync(path.join(root,"build/squad/build-receipt.json"),JSON.stringify(receipt,null,2)+"\n");
  return receipt;
}
function checkSquadReceipt(root) {
  const file = path.join(root,"build/squad/build-receipt.json");
  assert.ok(fs.existsSync(file),"Rebuild native\\squad-scope\\build.bat: missing helper build receipt (old EXE cannot prove dynamic-key source)");
  const receipt = JSON.parse(fs.readFileSync(file,"utf8"));
  assert.equal(receipt.schema,1);
  assert.deepEqual(receipt.binary,describe(fs.readFileSync(path.join(root,"build/squad/squad-scope.exe"))),"Stale Squad helper binary");
  assert.deepEqual(receipt.inputs,Object.fromEntries(squadInputs.map(file => [file,describe(fs.readFileSync(path.join(root,file)))])),"Rebuild Squad helper after source/build changes");
  return receipt;
}

function assertPackedFileScope(files) {
  const expected = ["dist/**/*","dist-electron/**/*"];
  let filters = files;
  if (Array.isArray(files) && files.length === 1 && files[0] !== null && typeof files[0] === "object" && !Array.isArray(files[0])) {
    assert.deepEqual(Object.keys(files[0]),["filter"],"Normalized package scope must not redirect source/destination or add fields");
    filters = files[0].filter;
  }
  assert.deepEqual(filters,expected,"Package files must retain the exact two approved renderer/main patterns");
  return [...expected];
}

function inventory(root,config,{ sourceOnly = false } = {}) {
  const extraResources = [...config.extraResources, ...(config.win.extraResources || [])];
  const read = file => fs.readFileSync(path.join(root,file));
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.name,"gryt-chat","Keep original source package identity");
  assert.equal(config.appId,"local.laokuai.chat");
  assert.equal(config.productName,"唠蒯云");
  assert.equal(config.extraMetadata.name,"laokuai-chat","Keep established private package identity");
  assert.equal(config.publish,null); assert.deepEqual(config.protocols,[]);
  assert.equal(config.extraMetadata.grytI18nTest,true); assert.equal(config.extraMetadata.grytLaokuai,true);
  for (const locale of ["en-US","en-GB","zh-CN"]) assert.ok(config.electronLanguages.includes(locale));
  const packedFileScope = assertPackedFileScope(config.files);
  assert.ok(!config.extraResources.some(e => /build\/(helper|embedded-)/.test(e.from)));
  for (const file of ["squad/squad-scope.exe","legal/PRIVATE-PROFILE-REUSE.md","legal/SQUAD-KEY-LIST.md"]) {
    assert.ok(config.extraResources.some(e => e.to === file),`Missing package resource ${file}`);
  }
  const voicePath = pkg.devDependencies["@gryt/voice"].replace(/^file:/,"");
  assert.ok(voicePath.startsWith("vendor/"));
  const tar = readTarGz(path.join(root,voicePath));
  const voice = JSON.parse(tar.get("package/package.json").toString());
  assert.ok(read("yarn.lock").toString().includes(`@gryt/voice@file:${voicePath}`),"Lock must select current vendor SDK");
  const voiceFiles = Object.fromEntries([...tar].filter(([file]) => /\/(dist\/|third-party\/.*LICENSE|third-party\/receive-rnn\/licenses\/)|\/LICENSE$|\/package.json$/.test(file))
    .map(([file,bytes]) => [file.slice(8),describe(bytes)]));
  if (!sourceOnly) for (const [file,expected] of Object.entries(voiceFiles)) {
    assert.deepEqual(describe(read(`node_modules/@gryt/voice/${file}`)),expected,`Installed Voice differs from vendor: ${file}`);
  }
  const sources = {};
  const brokerSource = "native/community-lan-broker/Program.cs";
  sources[brokerSource] = describe(read(brokerSource));
  const dnsBrokerSource = "native/community-lan-broker/CommunityDnsPolicy.cs";
  sources[dnsBrokerSource] = describe(read(dnsBrokerSource));
  sources["scripts/build-community-broker.ps1"] = describe(read("scripts/build-community-broker.ps1"));
  for (const item of ["package.json","yarn.lock","electron-builder.yml","electron-builder.config.cjs","electron-builder.i18n-test.cjs","electron-builder.laokuai.cjs","vite.config.ts",
    "electron","src","native/squad-scope","private-brand","public/laokuai-icon.png","scripts/laokuai-package-audit.cjs","scripts/community-easytier-resources.cjs","scripts/check-easytier-patched-payload.cjs","scripts/check-laokuai-package.mjs"]) {
    for (const file of fs.statSync(path.join(root,item)).isDirectory() ? walk(path.join(root,item)) : [path.join(root,item)]) {
      sources[slash(path.relative(root,file))] = describe(fs.readFileSync(file));
    }
  }
  const iconSource = JSON.parse(read("private-brand/ICON-SOURCE.json"));
  assert.ok(typeof iconSource.sourceName==="string"&&/^[A-Za-z0-9_-]+\.png$/.test(iconSource.sourceName),"Unsafe brand source name");
  assert.equal(sha(read(`private-brand/${iconSource.sourceName}`)),iconSource.sourceSha256,"Approved original brand source changed");
  assert.equal(sha(read("public/laokuai-icon.png")),sha(read("private-brand/icon-256.png")));
  const trays = config.extraResources.filter(e => /^tray.*\.png$/.test(e.to));
  assert.equal(trays.length,11);
  for (const e of trays) assert.equal(e.from,`private-brand/icon-${e.to.includes("@3x") ? 48 : e.to.includes("@2x") ? 32 : 16}.png`);
  const manifest = { schema:1, version:pkg.version, productName:config.productName, appId:config.appId,
    sourcePackage:pkg.name, packagedName:config.extraMetadata.name, executable:config.win.executableName+".exe",
    voice:{ name:voice.name,version:voice.version,vendor:voicePath,...describe(read(voicePath)),files:voiceFiles },
    config:{ files:packedFileScope,locales:config.electronLanguages,extraResources },sources,
    sourceOnly, applicationExecuted:false, realProfileRead:false, p2pAccepted:false };
  manifest.installedVersions={};
  for(const name of ["electron","electron-builder","vite","typescript","@gryt/ui","@shiguredo/rnnoise-wasm","@mediapipe/tasks-vision","uiohook-napi"]) {
    const file=path.join(root,"node_modules",name,"package.json");
    manifest.installedVersions[name]=fs.existsSync(file) ? {version:JSON.parse(fs.readFileSync(file,"utf8")).version,...describe(fs.readFileSync(file))} : null;
  }
  const ico=read(config.win.icon);assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);
  manifest.appIconPayloads=[];
  for(let i=0;i<ico.readUInt16LE(4);i++) {
    const p=6+i*16,size=ico.readUInt32LE(p+8),start=ico.readUInt32LE(p+12);
    assert.ok(start+size <= ico.length);manifest.appIconPayloads.push(sha(ico.subarray(start,start+size)));
  }
  if (sourceOnly) {
    // Observations are useful for spotting an old package, but are never a build receipt.
    manifest.observedBuildFiles = {};
    for (const folder of ["dist","dist-electron","build/native","build/squad"]) {
      if (fs.existsSync(path.join(root,folder))) for (const file of walk(path.join(root,folder))) {
        manifest.observedBuildFiles[slash(path.relative(root,file))] = describe(fs.readFileSync(file));
      }
    }
    return manifest;
  }
  manifest.packedFiles = {};
  for (const folder of ["dist","dist-electron"]) for (const file of walk(path.join(root,folder))) {
    manifest.packedFiles[slash(path.relative(root,file))] = describe(fs.readFileSync(file));
  }
  for (const file of ["dist-electron/main.js","dist-electron/preload.cjs","dist/index.html","dist/laokuai-icon.png"]) assert.ok(manifest.packedFiles[file],file);
  const main=readMainBundle(read);
  for(const marker of ["local.laokuai.chat","laokuai-chat-data","grytI18nTest","squad-scope.exe","persist:laokuai-official-auth"]) assert.ok(main.includes(marker),`Main bundle misses ${marker}`);
  const renderer = walk(path.join(root,"dist/assets")).filter(file => file.endsWith(".js")).map(file => fs.readFileSync(file,"utf8")).join("\n");
  assert.ok(renderer.includes(pkg.version),"Renderer must include current app version");
  for (const marker of ["rnnoise-processor","gryt-receive-level-v2","transmitSuppressionEnabled","squadConfig","gryt.ui.language","privateUpdateSafety","publicationAcknowledged","prepareMove"]) {
    assert.ok(renderer.includes(marker),`Renderer misses ${marker}`);
  }
  const analyzerSource = tar.get("package/dist/audio/processors/receiveAnalyzerAsset.js").toString();
  const analyzer = analyzerSource.match(/RECEIVE_ANALYZER_BASE64\s*=\s*["']([^"']+)["']/)?.[1];
  assert.ok(analyzer && renderer.includes(analyzer),"Renderer misses exact SDK embedded receive analyzer WASM");
  const workers = Object.keys(manifest.packedFiles).filter(file => /\/rnnoiseWorker-[^/]+\.js$/.test(file));
  assert.equal(workers.length,1,"Need exactly one emitted RNNoise worker");
  assert.ok(renderer.includes(path.basename(workers[0])),"RNNoise worker must be referenced by renderer");
  const worker = read(workers[0]).toString();
  assert.ok(worker.includes("rnnoise-invalid-probability") && worker.includes("AGFzb"),"RNNoise worker/model WASM missing");
  manifest.audioAssets = { rnnoiseWorker:workers[0],receiveAnalyzerWasm:describe(Buffer.from(analyzer,"base64")),
    worklets:"SDK worklet code and receive WASM embedded in renderer; RNNoise model WASM embedded in worker" };
  manifest.resources = {};
  manifest.rootFiles = {};
  for (const entry of config.extraFiles || []) {
    assert.ok(typeof entry.from === "string" && typeof entry.to === "string" && !/[\\/]/.test(entry.to), "Root extras must be explicit files");
    manifest.rootFiles[entry.to] = {source:entry.from,...describe(read(entry.from))};
  }
  for (const e of extraResources) {
    const input = path.join(root,e.from);
    assert.ok(fs.existsSync(input),`Missing resource ${e.from}`);
    assert.ok(!e.filter || JSON.stringify(e.filter) === '["**/*"]',`Unsupported resource filter ${e.from}`);
    for (const file of fs.statSync(input).isDirectory() ? walk(input) : [input]) {
      const output = slash(fs.statSync(input).isDirectory() ? path.join(e.to,path.relative(input,file)) : e.to);
      assert.ok(!manifest.resources[output],`Duplicate resource destination ${output}`);
      manifest.resources[output] = { source:slash(path.relative(root,file)),...describe(fs.readFileSync(file)) };
    }
  }
  manifest.squadReceipt = checkSquadReceipt(root);
  const brokerReceipt = JSON.parse(read("build/community-lan-helper/broker-build.json"));
  assert.equal(brokerReceipt.schemaVersion, 1);
  assert.equal(brokerReceipt.sourceSha256, sources[brokerSource].sha256, "Rebuild the community broker after source changes");
  assert.equal(brokerReceipt.dnsSourceSha256, sources[dnsBrokerSource].sha256, "Rebuild the community broker after DNS policy source changes");
  assert.deepEqual({bytes:brokerReceipt.bytes,sha256:brokerReceipt.sha256}, describe(read("build/community-lan-helper/laokuai-community-broker.exe")));
  manifest.brokerReceipt = brokerReceipt;
  return manifest;
}

function readAsar(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.readUInt32LE(0),4,"Invalid ASAR pickle header");
  const length = bytes.readUInt32LE(12), base = 8+bytes.readUInt32LE(4);
  assert.ok(length <= base-16 && base <= bytes.length,"Invalid ASAR header length");
  const tree = JSON.parse(bytes.toString("utf8",16,16+length)), files = new Map();
  const visit = (entry,prefix = "") => { for (const [name,info] of Object.entries(entry.files)) {
    assert.ok(name !== "." && name !== ".." && !/[/:\\]/.test(name),"Unsafe ASAR name");
    const key = prefix+name;
    if (info.files) visit(info,key+"/"); else files.set(key,info);
  } }; visit(tree);
  const read = name => {
    const info = files.get(name); assert.ok(info,`Missing packed file ${name}`); assert.ok(!info.link,`Unexpected link ${name}`);
    if (info.unpacked) return fs.readFileSync(path.join(file+".unpacked",name));
    const start = base+Number(info.offset);
    assert.ok(Number.isSafeInteger(start) && start >= base && start+info.size <= bytes.length,`Invalid ASAR range ${name}`);
    return bytes.subarray(start,start+info.size);
  };
  return { files,read,sha256:sha(bytes) };
}

function verifyPayload(payload,manifest) {
  assert.equal(manifest.schema,1,"Unsupported package manifest schema");
  assert.equal(manifest.sourceOnly,false,"A source-only inventory cannot validate a final archive");
  assert.ok(Array.isArray(manifest.appIconPayloads) && manifest.appIconPayloads.length > 0,"Missing approved app icon hashes");
  const resources = path.join(payload,"resources"), archive = readAsar(path.join(resources,"app.asar"));
  const meta = JSON.parse(archive.read("package.json"));
  for (const [key,expected] of Object.entries({ name:manifest.packagedName,productName:manifest.productName,version:manifest.version,
    grytI18nTest:true,grytLaokuai:true,license:"AGPL-3.0-or-later" })) assert.equal(meta[key],expected,`Packed metadata ${key}`);
  const built = [...archive.files.keys()].filter(file => /^(dist|dist-electron)\//.test(file));
  assert.deepEqual(built.sort(),Object.keys(manifest.packedFiles).sort(),"Packed renderer/main file set differs from final build");
  for (const [file,expected] of Object.entries(manifest.packedFiles)) assert.deepEqual(describe(archive.read(file)),expected,file);
  for (const [file,expected] of Object.entries(manifest.resources)) assert.deepEqual(describe(fs.readFileSync(path.join(resources,file))),
    {bytes:expected.bytes,sha256:expected.sha256},file);
  for (const [file,expected] of Object.entries(manifest.rootFiles || {})) assert.deepEqual(describe(fs.readFileSync(path.join(payload,file))),
    {bytes:expected.bytes,sha256:expected.sha256},file);
  for (const locale of ["en-US","en-GB","zh-CN"]) assert.ok(fs.existsSync(path.join(payload,"locales",locale+".pak")),locale);
  assert.ok(!fs.existsSync(path.join(resources,"app-update.yml")));
  assert.ok(!fs.existsSync(path.join(resources,"helper")));
  assert.ok(!walk(resources).some(file => path.basename(file).startsWith("embedded-")));
  assert.ok(!walk(resources).some(file => /^(packet|wpcap)\.dll$/i.test(path.basename(file))),"No-Npcap package contains a capture DLL");
  for(const name of ["easytier-core.exe","easytier-cli.exe"]) {
    const file = path.join(resources,"community-lan/product/2.7.0-laokuai",name);
    assert.equal(inspectPeImports(fs.readFileSync(file)).noCaptureDllNormalOrDelayImports,true,"Final core/CLI import a capture DLL");
  }
  const hook = "node_modules/uiohook-napi/prebuilds/win32-x64/node.napi.node";
  assert.equal(inspectPe(archive.read(hook)).machine,0x8664);
  for (const file of ["native/audio-capture.exe","native/screen-capture.exe","squad/squad-scope.exe","community-lan-helper/laokuai-community-broker.exe"]) {
    assert.equal(inspectPe(fs.readFileSync(path.join(resources,file))).machine,0x8664,file);
  }
  const pe = inspectPe(fs.readFileSync(path.join(payload,manifest.executable)));
  assert.equal(pe.machine,0x8664); assert.equal(pe.certificateBytes,0,"Private EXE must remain unsigned");
  const icons=iconPayloads(fs.readFileSync(path.join(payload,manifest.executable)));
  for(const hash of manifest.appIconPayloads) assert.ok(icons.includes(hash),"App EXE misses approved brand ICO payload");
  return { status:"passed",version:manifest.version,voiceVersion:manifest.voice.version,appAsarSha256:archive.sha256,
    payloadFiles:Object.fromEntries(walk(payload).map(file => [slash(path.relative(payload,file)),describe(fs.readFileSync(file))])),
    applicationExecuted:false,realProfileRead:false,scope:"Exact final build files/resources and extracted portable archive; no runtime acceptance" };
}
module.exports = { sha,describe,readTarGz,readAsar,inventory,assertPackedFileScope,verifyPayload,verifyPortable,iconPayloads,writeSquadReceipt,checkSquadReceipt,readMainBundle };
