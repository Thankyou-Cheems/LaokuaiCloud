/* eslint-env node */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import os from "node:os";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"..");
const profile=fs.mkdtempSync(path.join(os.tmpdir(),"laokuai-default-relaunch-fixture-"));
const source=stripTypeScriptTypes(fs.readFileSync(path.join(root,"electron/userStore.ts"),"utf8"));
const url=`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const saved={compressorEnabled:true,messageSoundEnabled:true,cameraQuality:"native",screenShareQuality:"native",screenShareGamingMode:true,
  receiveLevelingEnabled:false,micVolume:0,customMessageSoundFile:null,outputDeviceID:""};
const results=[];
for(const stage of ["save","load"]) {
  const script=`import * as store from ${JSON.stringify(url)};store.initUserStore(${JSON.stringify(profile)});
    ${stage==="save"?`store.saveUser('SYNTHETIC_RELAUNCH',${JSON.stringify(saved)});store.flushUserStore();`:""}
    console.log(JSON.stringify(store.loadUser('SYNTHETIC_RELAUNCH')));`;
  const result=spawnSync(path.join(root,"node_modules/electron/dist/electron.exe"),["--input-type=module","-e",script],{
    windowsHide:true,encoding:"utf8",timeout:20000,env:{...process.env,ELECTRON_RUN_AS_NODE:"1"}});
  assert.equal(result.status,0,result.stderr); const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.deepEqual(data,saved);results.push({stage,actualElectronUserStore:true,preserved:true});
}
fs.writeFileSync(path.join(root,"startup-private-relaunch.json"),JSON.stringify({status:"passed",isolatedTemporaryProfile:true,
  twoIndependentElectronProcesses:true,realIdentityOrMediaOpened:false,results},null,2));
console.log("PASS actual userStore save/flush/load across two separate Electron processes; synthetic Temp profile only");
