import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync, spawn} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const arg = name => {const at = process.argv.indexOf(name);return at < 0 ? null : process.argv[at + 1];};
const profile = arg('--profile'), resources = arg('--resources');
if (!profile || !resources || !path.isAbsolute(profile) || !path.isAbsolute(resources)) throw Error('Explicit existing --profile and verified --resources are required');
if (!fs.existsSync(path.join(profile,'gryt-global.json')) || !fs.existsSync(path.join(profile,'IndexedDB'))) throw Error('Original existing profile required; no identity import/reset');
const metadata = JSON.parse(fs.readFileSync(path.join(root,'package.json')));
if (metadata.grytLaokuai !== true || metadata.grytI18nTest !== true) throw Error('Product flags absent');
// Reuse only known sealed sidecars. No build/download/embedded server operation.
const sealPath = arg('--seal');
if (!sealPath) throw Error('--seal is required for resource byte correspondence');
const seal = JSON.parse(fs.readFileSync(sealPath));
const verify = file => {
  const relative = path.relative(seal.manifestRoot,file).replaceAll('\\','/');
  const pin = seal.files[relative];
  if (!pin || fs.statSync(file).size !== pin.bytes || crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== pin.sha256) throw Error('Unsealed preview resource');
};
function copyDir(from,to) {
  if (!fs.existsSync(from)) return;
  for (const entry of fs.readdirSync(from,{withFileTypes:true})) {
    const source=path.join(from,entry.name),dest=path.join(to,entry.name);
    if(entry.isDirectory()) copyDir(source,dest);
    else if(entry.isFile()) {verify(source);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(source,dest);}
  }
}
for(const folder of ['native','squad','community-lan'])copyDir(path.join(resources,folder),path.join(root,'build',folder));
for(const name of fs.readdirSync(resources).filter(n=>/^(icon|tray).*\.png$/.test(n))) {const file=path.join(resources,name);verify(file);fs.mkdirSync(path.join(root,'build'),{recursive:true});const dest=path.join(root,'build',name);if(!fs.existsSync(dest))fs.copyFileSync(file,dest);}
const vite=path.join(root,'node_modules/vite/bin/vite.js');
if (!process.argv.includes('--no-build')) {
  const result=spawnSync(process.execPath,[vite,'build'],{cwd:root,env:{...process.env,ELECTRON:'1'},windowsHide:true,stdio:'inherit'});
  if(result.status!==0)process.exit(result.status??1);
}
if(process.argv.includes('--build-only'))process.exit(0);
const electron=path.join(root,'node_modules/electron/dist/electron.exe');
if(process.platform!=='win32'||!fs.existsSync(electron))throw Error('Existing Windows Electron runtime required');
const env={...process.env};delete env.VITE_DEV_SERVER_URL;delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(electron,[root,'--laokuai-preview','--user-data-dir='+profile],{cwd:root,env,windowsHide:true,stdio:'ignore'});
child.on('exit',code=>{process.exitCode=code??1;});
console.log(JSON.stringify({started:true,pid:child.pid,origin:'http://127.0.0.1:15738',realExistingProfile:true,tunEnabled:false,firewallChanged:false}));
