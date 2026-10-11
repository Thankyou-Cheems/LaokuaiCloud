'use strict';
// Restore the immutable dbaf companion, then apply one reviewed source overlay.
// Writes only a fresh dedicated destination; no build scripts or native code.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const [materials,destination,...options]=process.argv.slice(2);
if(!materials||!destination||options.some(x=>x!=='--metadata'))throw Error('Usage: node restore-next-native-source.cjs MATERIALS FRESH_DEST [--metadata]');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),read=p=>JSON.parse(fs.readFileSync(p)),here=__dirname,dest=path.resolve(destination),materialRoot=fs.realpathSync(materials),overlay=path.join(here,'overlays/windows-service-no-encoding'),m=read(path.join(overlay,'manifest.json'));
if(fs.existsSync(dest))throw Error('Preserve existing destination; use a new directory');
if(m.changedPath!=='easytier/Cargo.toml'||m.sourceCommit!=='fb3ae901a02f763241ff8d78f1db0b89243fba24'||sha(path.join(overlay,'Cargo.toml'))!==m.integratedSha256)throw Error('Overlay identity differs');
function run(command,args,cwd=here,env=process.env){const r=spawnSync(command,args,{cwd,env,windowsHide:true,encoding:'utf8',maxBuffer:20000000,timeout:60000});if(r.error||r.status!==0)throw Error(`${command} failed (${r.status}): ${r.error?.message||r.stderr}`);return r.stdout;}
run(process.execPath,[path.join(here,'restore-native-source.cjs'),materialRoot,dest]);
const baseline=read(path.join(dest,'RESTORATION-RECEIPT.json')),source=path.join(dest,'source'),cargo=path.join(source,m.changedPath);
if(!baseline.sourceMaterialsByteVerified||baseline.nativeSourceFiles!==1277||baseline.registryArchives!==865||baseline.gitBundles!==7||sha(cargo)!==m.baselineSha256||sha(path.join(source,'Cargo.lock'))!==m.cargoLockSha256)throw Error('Restored baseline differs; preserve failed destination');
fs.copyFileSync(path.join(overlay,'Cargo.toml'),cargo);
const receipt={schema:1,sourceCommit:m.sourceCommit,baselineNativeSourceCommit:m.nativeBaselineSourceCommit,changedFiles:1,overlayManifestSha256:sha(path.join(overlay,'manifest.json')),integratedCargoSha256:sha(cargo),cargoLockSha256:sha(path.join(source,'Cargo.lock')),sourceMaterialsByteVerified:true,baselineSourceFiles:1277,registryArchives:865,gitBundles:7,isolatedCargoHome:true,buildScriptsExecuted:false,nativeBuildExecuted:false,nativeExecuted:false,publicDistributionApproved:false,recipientRelinkAccepted:false};
if(options.includes('--metadata')){
 const material=read(path.join(materialRoot,'native-source-materials.json')),manifest=path.join(source,'easytier/Cargo.toml'),common=['--manifest-path',manifest,'--locked','--offline','--no-default-features'],env={...process.env,CARGO_HOME:path.join(dest,'cargo-home'),CARGO_TARGET_DIR:path.join(dest,'unused-target'),CARGO_NET_OFFLINE:'true',RUSTUP_AUTO_INSTALL:'0'};
 const output=run('cargo',['+'+material.rustVersion,'metadata',...common,'--format-version','1','--filter-platform',material.target,'--features',material.features.map(x=>'easytier/'+x).join(',')],source,env),data=JSON.parse(output);
 fs.writeFileSync(path.join(dest,'metadata.local.json'),output);
 const identity=p=>(p.source||'path')+'#'+p.name+'@'+p.version,ids=new Map(data.packages.map(p=>[p.id,identity(p)])),normalized={packages:data.packages.map(p=>({id:identity(p),license:p.license,licenseFile:p.license_file,authors:p.authors})).sort((a,b)=>a.id.localeCompare(b.id)),nodes:data.resolve.nodes.map(n=>({id:ids.get(n.id),features:[...n.features].sort(),deps:n.deps.map(d=>({name:d.name,pkg:ids.get(d.pkg),kinds:d.dep_kinds})).sort((a,b)=>a.name.localeCompare(b.name)||a.pkg.localeCompare(b.pkg))})).sort((a,b)=>a.id.localeCompare(b.id))},graph=crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
 if(graph!==m.normalizedMetadataGraphSha256||data.packages.length!==886||data.packages.filter(x=>x.source?.startsWith('registry+')).length!==865)throw Error('Integrated normalized metadata differs');
 const treeCommon=['+'+material.rustVersion,'tree',...common,'-p','easytier','--target',material.target,'--edges','normal,build','--prefix','none','--features',material.features.join(',')],tree=run('cargo',treeCommon,source,env);
 fs.writeFileSync(path.join(dest,'windows-tree.local.txt'),tree);
 const packages=[...new Set(tree.split(/\r?\n/).map(x=>x.match(/^([^ ]+) v([^ ]+)/)).filter(Boolean).map(x=>x[1]+'@'+x[2]))].sort();
 const features=run('cargo',[...treeCommon,'--invert','service-manager','--format','{p} features=[{f}]'],source,env);
 fs.writeFileSync(path.join(dest,'service-manager-features.local.txt'),features);
 if(packages.length!==504||packages.includes('codepage@0.1.3')||packages.includes('encoding-utils@0.1.0')||!features.split(/\r?\n/)[0].endsWith('features=[]')||sha(path.join(source,'Cargo.lock'))!==m.cargoLockSha256)throw Error('Windows target graph or lock differs');
 Object.assign(receipt,{normalizedMetadataGraphSha256:graph,metadataPackages:886,metadataRegistryPackages:865,windowsNormalBuildPackages:504,windowsServiceManagerFeatures:[],removedWindowsPackages:['codepage@0.1.3','encoding-utils@0.1.0'],lockUnchanged:true,metadataWorkspaceFeaturesAreNotTargetBuildAcceptance:true});
}
fs.writeFileSync(path.join(dest,'NEXT-SOURCE-RESTORATION-RECEIPT.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
