import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOwnedObserver } from './owned-tun-observer.mjs';
import { SCOPE,SCOPE_SHA256,sha256 } from './owned-tun-trial-policy.mjs';
// Explicit readonly entry. No native/process adapter import, payload/config or trial executor call.
const scripts=path.dirname(fileURLToPath(import.meta.url));
const directory=process.argv[2];
if(process.argv.length!==3||!path.isAbsolute(directory))throw new Error('readonly-evidence-directory-required');
for(const [file,expected] of Object.entries(SCOPE.observationSources))if(sha256(await fsp.readFile(path.join(scripts,file)))!==expected)throw new Error('readonly-source-mismatch');
await fsp.mkdir(directory,{recursive:true});
const observer=createOwnedObserver({scripts,directory,powershell:path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe')});
const started=performance.now(),samples=[];let outcome='failed',failure=null;
try {
 samples.push({stage:'before',...await observer.full({stage:'before'})});
 const full=observer.full({stage:'prepared'});void full.catch(()=>{});
 samples.push({stage:'concurrent-light-warmup',...await observer.light({stage:'warmup',warmup:true})});
 // This already-owned Node PID exercises UDP/creation-time reads; never starts or attaches to ET.
 for(let i=0;i<3;i++){samples.push({stage:'concurrent-warm-light-'+(i+1),...await observer.light({stage:'benchmark',owned:{pid:process.pid,interfaces:[]}})});await new Promise(resolve=>setTimeout(resolve,SCOPE.light.pauseMs));}
 samples.push({stage:'prepared-full',...await full});
 for(let i=0;i<2;i++){samples.push({stage:'post-warm-light-'+(i+1),...await observer.light({stage:'settling',owned:null})});if(i===0)await new Promise(resolve=>setTimeout(resolve,SCOPE.light.pauseMs));}
 outcome='passed';
}catch(error){failure=/^[a-z0-9-]{1,96}$/.test(error.message??'')?error.message:'readonly-benchmark-failed';process.exitCode=1;}
finally {await observer.close();await fsp.writeFile(path.join(directory,'readonly-timing.json'),JSON.stringify({schema:1,outcome,failure,scopeSha256:SCOPE_SHA256,samples,totalMs:Math.round(performance.now()-started),coreOrCliExecuted:false,tunOrDriverApi:false,osMutation:false,liveTrialNicMeasured:false},null,2),{flag:'wx'});}
