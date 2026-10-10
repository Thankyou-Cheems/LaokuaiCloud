/* eslint-env node */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const results=[];
function run(label,args,env={}) {
  console.log(`START ${label}`);
  const result=spawnSync(process.execPath,args,{windowsHide:true,encoding:"utf8",env:{...process.env,...env},maxBuffer:24*1024*1024});
  writeFileSync(`startup-${label}.txt`,result.stdout??""); writeFileSync(`startup-${label}.stderr.txt`,result.stderr??"");
  results.push({label,status:result.status}); writeFileSync("startup-build-results.json",JSON.stringify(results,null,2));
  console.log(`END ${label}: ${result.status}`);
  if(result.status!==0){ console.log(result.stdout,result.stderr); process.exit(1); }
}
if (!process.argv.includes("--resume-ui") && !process.argv.includes("--resume-build")) {
run("typecheck",["node_modules/typescript/bin/tsc","-b"]);
run("lint",["node_modules/eslint/bin/eslint.js",".","--ext","ts,tsx","--report-unused-disable-directives","--max-warnings","0"]);
for (const name of ["check-private-startup","check-private-defaults","check-private-relaunch","check-notification-prefs","check-message-notification","check-uiohook-esm","check-settings-index","check-comment-length","check-i18n",
  "check-squad-mode","check-squad-broker","check-voice-modes","check-output-device","check-laokuai-integration","check-hotkeys","check-screen-audio"]) {
  run(name,[`scripts/${name}.mjs`]);
}
}
if (!process.argv.includes("--resume-build")) {
  run("headless",["node_modules/@playwright/test/cli.js","test","--config=e2e/playwright.i18n.config.ts"],{CHILD_CONCURRENCY:"1",UV_THREADPOOL_SIZE:"2"});
}
run("web-build",["node_modules/vite/bin/vite.js","build"]);
run("desktop-build",["node_modules/vite/bin/vite.js","build"],{ELECTRON:"1"});
run("portable-build",["node_modules/electron-builder/cli.js","--config=electron-builder.laokuai.cjs","--win","portable","--x64","--publish","never"],{
  ELECTRON_BUILDER_CACHE:"C:/Users/cheb2/Documents/Codex/2026-10-10/task-2/tools/electron-builder-cache",UV_THREADPOOL_SIZE:"2",
  CHILD_CONCURRENCY:"1",GOMAXPROCS:"2",RAYON_NUM_THREADS:"2",ELECTRON_BUILDER_COMPRESSION_LEVEL:"1",CSC_IDENTITY_AUTO_DISCOVERY:"false"});
