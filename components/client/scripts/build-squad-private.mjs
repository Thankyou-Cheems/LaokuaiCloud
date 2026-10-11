import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const results=[];
function run(label,args,env={}) {
 console.log(`START ${label}`);
 const result=spawnSync(process.execPath,args,{windowsHide:true,encoding:'utf8',env:{...process.env,...env},maxBuffer:24*1024*1024});
 writeFileSync(`squad-${label}.txt`,result.stdout??'');writeFileSync(`squad-${label}.stderr.txt`,result.stderr??'');
 results.push({label,status:result.status});writeFileSync('squad-build-results.json',JSON.stringify(results,null,2));
 console.log(`END ${label}: ${result.status}`);
 if(result.status!==0){console.log(result.stdout,result.stderr);process.exit(1);}
}
if (!process.argv.includes('--resume')) run('frozen-install',[process.env.YARN_CLI_PATH ?? 'node_modules/yarn/bin/yarn.js','install','--frozen-lockfile','--offline','--ignore-scripts','--network-concurrency','1','--cache-folder',process.env.YARN_CACHE_FOLDER ?? resolve('.cache/yarn')]);
if (!process.argv.includes('--resume')) run('typecheck-final',['node_modules/typescript/bin/tsc','-b']);
for(const name of ['check-squad-mode','check-squad-broker','check-voice-modes','check-i18n','check-output-device','check-laokuai-integration','check-hotkeys','check-screen-audio','check-voice-presence','check-voice-state-reassert','check-settings-index','check-comment-length']) {
 if(process.argv.includes('--resume') && !['check-settings-index','check-comment-length'].includes(name)) continue;
 run(name,['scripts/'+name+'.mjs']);
}
run('web-build',['node_modules/vite/bin/vite.js','build']);
run('desktop-build',['node_modules/vite/bin/vite.js','build'],{ELECTRON:'1'});
run('portable-build',['node_modules/electron-builder/cli.js','--config=electron-builder.laokuai.cjs','--win','portable','--x64','--publish','never'],{ELECTRON_BUILDER_CACHE:process.env.ELECTRON_BUILDER_CACHE ?? resolve('.cache/electron-builder'),UV_THREADPOOL_SIZE:'2',CHILD_CONCURRENCY:'1',GOMAXPROCS:'2',RAYON_NUM_THREADS:'2',ELECTRON_BUILDER_COMPRESSION_LEVEL:'1',CSC_IDENTITY_AUTO_DISCOVERY:'false'});
