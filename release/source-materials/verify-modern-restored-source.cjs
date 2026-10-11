'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dest=path.resolve(process.argv[2]||''),here=__dirname,sha=b=>crypto.createHash('sha256').update(b).digest('hex'),read=p=>JSON.parse(fs.readFileSync(p));
if(!process.argv[2])throw Error('Usage: node verify-modern-restored-source.cjs RESTORED_DIRECTORY');
const source=path.join(dest,'source'),overlay=read(path.join(here,'overlays/modern-standard-static-crt/manifest.json')),inventory=read(path.join(here,'native/preferred-source-files.json'));
if(inventory.length!==1277)throw Error('Source inventory differs');
const expected=new Set(inventory.map(x=>x.path)),actual=[];
function walk(dir,prefix=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const relative=prefix+e.name,target=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Source symlink rejected');if(e.isDirectory())walk(target,relative+'/');else if(e.isFile())actual.push(relative);else throw Error('Unknown source object');}}
walk(source);if(actual.length!==expected.size||actual.some(x=>!expected.has(x)))throw Error('Unexpected/missing source files');
for(const x of inventory){const target=path.resolve(source,x.path);if(path.relative(source,target).startsWith('..')||path.isAbsolute(path.relative(source,target)))throw Error('Unsafe source path');if(sha(fs.readFileSync(target))!==(x.path===overlay.changedPath?overlay.integratedSha256:x.sha256))throw Error('Source byte mismatch: '+x.path);}
const receipt={schema:1,sourceCommit:overlay.sourceCommit,sourceFiles:1277,allBaselineAndFinalOverlayBytesVerified:true,changedFilesFromDbaf:1,nativeBuilt:false,nativeExecuted:false};console.log(JSON.stringify(receipt));
