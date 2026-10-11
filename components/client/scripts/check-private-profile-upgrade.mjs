/* eslint-env node */
// Execute only Node and actual userStore code with synthetic files under build/.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
const read = file => fs.readFileSync(new URL(`../${file}`,import.meta.url),"utf8");
const moduleUrl = file => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(read(file))).toString("base64")}`;
const { privateProfilePaths } = await import(moduleUrl("electron/privateProfile.ts"));
const fixtureRoot = path.resolve(import.meta.dirname,"../build");
fs.mkdirSync(fixtureRoot,{recursive:true});
const temp = fs.mkdtempSync(path.join(fixtureRoot,"profile-upgrade-synthetic-"));
try {
  const profile = path.join(temp,"gryt-chat");
  fs.mkdirSync(path.join(profile,"IndexedDB"),{recursive:true});
  const global = '{"synthetic":true,"gryt.ui.language":"en","closeToTray":false}';
  const identity = "SYNTHETIC INDEXEDDB SENTINEL; no account/credential data";
  fs.writeFileSync(path.join(profile,"gryt-global.json"),global);
  fs.writeFileSync(path.join(profile,"IndexedDB","synthetic-only.txt"),identity);
  const saved = { nickname:"SYNTHETIC ADMIN",servers:{synthetic:{nickname:"Server-specific"}},
    compressorEnabled:true,rnnoiseEnabled:false,receiveLevelingEnabled:false,micVolume:0,outputVolume:37,
    outputDeviceID:"",customMessageSoundFile:null,squadConfig:{enabled:false,processDetection:true,processTarget:"synthetic",keys:[]},
    voiceTransportPreset:{mode:"custom",sfuBitrate:48000,p2pBitrate:64000,frameDurationMs:20},hasSeenWelcome:false };
  const selected = privateProfilePaths(true,[`--user-data-dir=${profile}`],temp);
  assert.deepEqual(selected,{data:profile,sessions:profile,reuseExisting:true});
  for (const phase of ["save","load"]) {
    const body = `import * as store from ${JSON.stringify(moduleUrl("electron/userStore.ts"))};
      store.initUserStore(${JSON.stringify(selected.data)});
      ${phase === "save" ? `store.saveUser('SYNTHETIC_ADMIN',${JSON.stringify(saved)});store.flushUserStore();` : ""}
      console.log('RESULT '+JSON.stringify(store.loadUser('SYNTHETIC_ADMIN')));`;
    const result = spawnSync(process.execPath,["--input-type=module","-e",body],{windowsHide:true,encoding:"utf8",timeout:10000});
    assert.equal(result.status,0,result.stderr);
    const output = result.stdout.split(/\r?\n/).find(line => line.startsWith("RESULT "));
    assert.deepEqual(JSON.parse(output.slice(7)),saved,phase);
  }
  assert.equal(fs.readFileSync(path.join(profile,"gryt-global.json"),"utf8"),global);
  assert.equal(fs.readFileSync(path.join(profile,"IndexedDB","synthetic-only.txt"),"utf8"),identity);
  assert.deepEqual(fs.readdirSync(temp),["gryt-chat"],"No profile copy/renaming on upgrade");
  const variant = read("electron/i18nTestVariant.ts"), settings = read("src/packages/settings/src/hooks/useSettings.ts");
  assert.ok(variant.includes('app.setPath("userData", data)') && variant.includes('app.setPath("sessionData", sessions)'));
  assert.ok(read("electron/main.ts").includes("const AUTH_ORIGIN_PORT = 15738"));
  const load = settings.slice(settings.indexOf("await loadForUser(userId)"),settings.indexOf("setSettingsLoaded(true)"));
  assert.ok(load.indexOf("setNickname(name)") < load.indexOf("setHasSeenWelcome(true)"));
  assert.ok(!load.includes('setUserValue("hasSeenWelcome"') && !load.includes('setUserValue("hasSeenTour"'));
  console.log("PASS synthetic old gryt-chat profile: in-place user/session selection, two Node saves/reloads, explicit settings and empty Squad keys retained, identity/global sentinels untouched; Electron IndexedDB opening untested");
} finally {
  assert.ok(temp.startsWith(fixtureRoot+path.sep));
  fs.rmSync(temp,{recursive:true,force:true});
}
