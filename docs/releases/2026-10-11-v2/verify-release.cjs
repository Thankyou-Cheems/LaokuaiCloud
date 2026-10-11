const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../..');
const m=JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.json'),'utf8'));
const git=args=>{const r=spawnSync('git',args,{cwd:root,windowsHide:true,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();};
const assert=(condition,message)=>{if(!condition)throw Error(message);};
git(['merge-base','--is-ancestor',m.repositories.client.commit,'HEAD']);
assert(git(['rev-parse',`${m.repositories.client.commit}^{tree}`])===m.repositories.client.tree,'Source tree mismatch');
const current={};for(const line of git(['ls-files','--stage','src','electron','scripts','package.json','yarn.lock','HYBRID-INTEGRATION.md']).split('\n')){const match=line.match(/^\d+ ([a-f0-9]+) 0\t(.+)$/);assert(match,'Unexpected index entry');current[match[2]]=match[1];}
assert(JSON.stringify(current)===JSON.stringify(m.sourceInputs),'Recorded source inputs changed');
assert(!git(['diff','--name-only','HEAD','--','src','electron','scripts','package.json','yarn.lock','HYBRID-INTEGRATION.md']),'Uncommitted source changes');
const pkg=m.repositories.voice.activePackage;
const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,pkg.path))).digest('hex');
assert(hash===pkg.sha256,'Active SDK package hash mismatch');
assert(m.repositories.easytier.releaseTag==='v2.7.0'&&m.repositories.easytier.prerelease===true,'EasyTier release pin mismatch');
assert(m.repositories.easytier.selectedApplicationCommit==='8b7f1f0196edb5b580829ed5f135050fb5853478','EasyTier commit mismatch');
assert(m.validation.clientPure.checks.every(r=>r.exit===0),'Recorded pure checks contain failures');
console.log(JSON.stringify({id:m.id,sourceCommit:m.repositories.client.commit,sourceInputs:Object.keys(current).length,consistent:true,ready:m.ready,finalSdkInstalled:!!m.repositories.voice.finalPackage,realNetworkVerified:false}));
if(process.argv.includes('--require-ready')&&!m.ready){console.error('Release blocked: '+m.pending.join('; '));process.exitCode=2;}
