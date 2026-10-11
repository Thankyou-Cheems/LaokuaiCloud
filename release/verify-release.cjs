const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const m=JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.json'),'utf8'));
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const git=args=>{const r=spawnSync('git',args,{cwd:root,windowsHide:true,encoding:'utf8'});if(r.status)throw Error(r.stderr);return r.stdout.trim();};
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
git(['merge-base','--is-ancestor',m.repository.codeCommit,'HEAD']);
assert(git(['rev-parse',`${m.repository.codeCommit}^{tree}`])===m.repository.codeTree,'Recorded source tree mismatch');
for(const [name,component]of Object.entries(m.components))assert(git(['rev-parse',`HEAD:${component.path}`])===component.tree,`Component changed: ${name}`);
assert(!git(['diff','--name-only','HEAD','--','components']),'Uncommitted component changes');
assert(sha('components/client/yarn.lock')===m.components.client.dependencyLockSha256,'Dependency lock mismatch');
const packageInfo=m.components.voice.package;
assert(sha(packageInfo.path)===packageInfo.sha256,'SDK package mismatch');
const client=JSON.parse(fs.readFileSync(path.join(root,'components/client/package.json'),'utf8'));
assert(client.devDependencies['@gryt/voice']==='file:'+packageInfo.path.replace('components/client/',''),'Client SDK pin mismatch');
const tar=zlib.gunzipSync(fs.readFileSync(path.join(root,packageInfo.path)));let packed,files=0;
for(let pos=0;pos+512<=tar.length;){const header=tar.subarray(pos,pos+512);if(header.every(x=>x===0))break;const field=(start,length)=>header.toString('utf8',start,start+length).split('\0')[0];const size=parseInt(field(124,12).trim()||'0',8);assert(Number.isSafeInteger(size)&&size>=0&&pos+512+size<=tar.length,'Invalid SDK tar');const name=field(0,100),type=field(156,1);if(type==='0'||type===''){files++;if(name==='package/package.json')packed=JSON.parse(tar.toString('utf8',pos+512,pos+512+size));}pos+=512+Math.ceil(size/512)*512;}
assert(packed?.version===packageInfo.version&&files===205,'SDK packed version/inventory mismatch');
assert(m.easytier.tag==='v2.7.0'&&m.easytier.prerelease&&m.easytier.tagCommit==='8b7f1f0196edb5b580829ed5f135050fb5853478','ET source target mismatch');
assert(m.validation.clientPure.checks.every(x=>x.exit===0),'Recorded checks not green');
console.log(JSON.stringify({id:m.id,codeCommit:m.repository.codeCommit,sourceConsistent:true,components:Object.keys(m.components),sdkVersion:packed.version,ready:m.ready,easytier:m.easytier.implementationStatus,actualNetworkVerified:false}));
if(process.argv.includes('--require-ready')&&!m.ready){console.error('Release blocked: '+m.pending.join('; '));process.exitCode=2;}
