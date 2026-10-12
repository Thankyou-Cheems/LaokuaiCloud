const fs=require('node:fs'),p=require('node:path'),{createRequire}=require('node:module'),crypto=require('node:crypto'),a=require('node:assert/strict');
const stage=p.resolve(__dirname,'..'),client=p.join(stage,'source/components/client'),nm=p.join(client,'node_modules'),backup=p.join(stage,'readonly-dependency-link-checkpoint');
const within=(file,root)=>{const r=p.relative(root,file);return r!==''&&!r.startsWith('..'+p.sep)&&r!=='..'&&!p.isAbsolute(r);};
function resolve(name,base){const req=createRequire(p.join(base,'package.json'));let f;try{f=req.resolve(name+'/package.json');}catch{f=req.resolve(name);}let dir=p.dirname(f);while(dir!==p.dirname(dir)){const meta=p.join(dir,'package.json');if(fs.existsSync(meta)){const v=JSON.parse(fs.readFileSync(meta));if(v.name===name)return {dir:fs.realpathSync(dir),metadata:v};}dir=p.dirname(dir);}throw Error('dependency-root-unresolved');}
const installed=new Map(),seen=new Set(),rows=[];
function ensure(name,base,parentDestination){const source=resolve(name,base);const identity=source.metadata.name+'@'+source.metadata.version;
 let dest=p.join(nm,name);if(installed.has(dest)&&installed.get(dest)!==identity)dest=p.join(parentDestination,'node_modules',name);
 if(seen.has(dest+'|'+identity))return;seen.add(dest+'|'+identity);a.ok(within(dest,client));
 if(!installed.has(dest)){
  if(fs.existsSync(dest)){a.ok(fs.lstatSync(dest).isSymbolicLink(),'Only owned readonly dependency junctions may move');const save=p.join(backup,p.relative(nm,dest));a.ok(within(save,stage));fs.mkdirSync(p.dirname(save),{recursive:true});a.ok(!fs.existsSync(save));fs.renameSync(dest,save);}
  fs.mkdirSync(p.dirname(dest),{recursive:true});
  fs.cpSync(source.dir,dest,{recursive:true,dereference:true,filter:file=>p.relative(source.dir,file).split(p.sep)[0]!=='node_modules'});
  installed.set(dest,identity);rows.push({name:source.metadata.name,version:source.metadata.version,destination:p.relative(client,dest).replaceAll('\\','/'),sourceBytesReused:true,installScriptsExecuted:false});
 }
 for(const child of Object.keys(source.metadata.dependencies||{}))ensure(child,source.dir,dest);
}
const root=JSON.parse(fs.readFileSync(p.join(client,'package.json')));for(const name of Object.keys(root.dependencies))ensure(name,client,client);
const hook=p.join(nm,'uiohook-napi/prebuilds/win32-x64/node.napi.node');const digest=crypto.createHash('sha256').update(fs.readFileSync(hook)).digest('hex');
const offer=JSON.parse(fs.readFileSync(p.join(stage,'SOURCE-OFFER.json')));a.equal(offer.sourceCommit,'2526db9081567da13f246be801a3b4662cb38102');
fs.writeFileSync(p.join(stage,'RUNTIME-DEPENDENCY-CLOSURE.json'),JSON.stringify({sourceCommit:offer.sourceCommit,packages:rows.length,rows,nativeHookSha256:digest,existingFrozenBytesOnly:true,newDependenciesAcquired:false,nodeOrNativeRebuilt:false,originalLinksPreserved:true},null,2));
console.log(JSON.stringify({packages:rows.length,nativeHookSha256:digest,onlyFrozenBytesMaterialized:true}));
