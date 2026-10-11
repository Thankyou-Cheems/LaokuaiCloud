import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const results=[];
function run(label,args){console.log(`START ${label}`);const r=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,maxBuffer:30*1024*1024});writeFileSync(`server-${label}.txt`,r.stdout??'');writeFileSync(`server-${label}.stderr.txt`,r.stderr??'');results.push({label,status:r.status});writeFileSync('server-checks.json',JSON.stringify(results,null,2));console.log(`END ${label}: ${r.status}`);if(r.status!==0){console.log(r.stdout,r.stderr);process.exit(1);}}
if (!process.argv.includes('--resume')) run('typecheck',['node_modules/typescript/bin/tsc']);
if (!process.argv.includes('--resume')) run('socket',['scripts/check-voice-mode-socket.mjs']);
run('voice-regression',['--test','--test-concurrency=1','--require','ts-node/register','--require','./scripts/windows-voice-test-cleanup.cjs','src/socket/voiceRecovery.test.ts','src/socket/handlers/voiceChannelSwitch.test.ts','src/socket/handlers/voiceJoinAnnounce.test.ts','src/socket/handlers/voiceRoomAccess.test.ts','src/socket/handlers/voiceSpeakCapability.test.ts','src/socket/utils/voiceCapabilities.test.ts','src/socket/utils/voiceStash.test.ts']);
run('lint',['node_modules/eslint/bin/eslint.js','src/socket/handlers/voiceMode.ts','src/socket/handlers/voice.ts','scripts/check-voice-mode-socket.mjs']);
run('comments',['scripts/check-comment-length.mjs']);
run('bundle',['node_modules/esbuild/bin/esbuild','dist/index.js','--bundle','--platform=node','--target=node22','--format=cjs','--outfile=dist/bundle.js','--external:sharp','--external:jsdom']);
