import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import os from 'node:os';
try{os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
const pkg=JSON.parse(readFileSync('package.json','utf8'));
const output=resolve(process.env.VOICE_REGRESSION_DIR??'local-regression-results');mkdirSync(output,{recursive:true});
const candidates=Object.entries(pkg.scripts).filter(([name,cmd])=>(name.startsWith('check-')||name==='test:comment-length')&&cmd.startsWith('node scripts/'));
const jobs=candidates.filter(([name])=>!name.endsWith('headless'));
if(!jobs.some(([name])=>name==='check-receive-prior'))jobs.push(['check-receive-prior','node scripts/check-receive-prior.mjs']);
const results=[];
for(const [name,command]of jobs){
  let status='passed',log='';const started=performance.now();
  try{log=execFileSync(process.execPath,command.slice(5).split(' '),{encoding:'utf8',maxBuffer:8e6,stdio:['ignore','pipe','pipe'],
    env:{...process.env,RECEIVE_RESULTS:resolve(output,name+'.json')}});}
  catch(error){status='failed';log=(error.stdout??'')+'\n'+(error.stderr??'')+'\n'+String(error);}
  writeFileSync(resolve(output,name+'.log'),log);
  results.push({name,status,elapsedMs:performance.now()-started});console.log(name+': '+status);
}
const result={status:results.every(x=>x.status==='passed')?'passed':'failed',results,
  separatelyRunHeadlessCommands:candidates.filter(([name])=>name.endsWith('headless')).map(([name])=>name),
  environment:{node:process.version,platform:process.platform,cpu:os.cpus()[0]?.model,priority:os.getPriority(0)},
  scope:'Sequential BelowNormal CLI regressions. Synthetic/fake fixtures; no real microphone, listening or hardware latency claim.'};
writeFileSync(resolve(output,'REGRESSIONS.json'),JSON.stringify(result,null,2)+'\n');
if(result.status==='failed')process.exitCode=1;
