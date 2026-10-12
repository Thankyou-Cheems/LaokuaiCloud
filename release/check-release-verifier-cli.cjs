const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module'),{spawnSync}=require('node:child_process');
const target=path.join(__dirname,'verify-release.cjs'),manifestPath=path.join(__dirname,'manifest.json');
if(process.argv.includes('--fixture')){
 const scenario=process.argv[process.argv.indexOf('--fixture')+1],m=JSON.parse(fs.readFileSync(manifestPath));
 if(scenario==='bad-inventory')m.components.voice.package.packedFiles++;
 if(scenario==='bad-version')m.components.voice.package.version='0.6.2-laokuai.lifecycle.2';
 if(scenario==='bad-history')m.components.voice.preservedReceivePath1.package.sha256='0'.repeat(64);
 if(scenario==='bad-provider-hash')m.validation.providerActualInstanceBinding.receiptSha256='0'.repeat(64);
 if(scenario==='bad-relink-hash')m.validation.recipientBuildPreparation.relinkReceiptSha256='0'.repeat(64);
 if(scenario==='bad-current-plan')m.validation.recipientBuildPreparation.currentPlanSha256='0'.repeat(64);
 if(scenario==='bad-current-acceptance')m.internalLifecycle3Candidate.runtimeAccepted=true;
 if(scenario==='bad-provider-promotion')m.validation.providerActualInstanceBinding.currentBuildFreezeMediaSourceIdentical=true;
 const proxy=new Proxy(fs,{get:(object,key)=>key==='readFileSync'?(file,options)=>{
   if(typeof file==='string'&&path.resolve(file)===manifestPath){const text=JSON.stringify(m);return typeof options==='string'||options?.encoding?text:Buffer.from(text);}
   return fs.readFileSync(file,options);
 }:object[key]});
 const compiled=new Module(target,module);compiled.filename=target;compiled.paths=Module._nodeModulePaths(__dirname);const original=compiled.require.bind(compiled);compiled.require=name=>name==='node:fs'?proxy:original(name);compiled._compile(fs.readFileSync(target,'utf8'),target);
}else{
 const scenarios=[['valid',0],['require-ready',2],['bad-inventory',1],['bad-version',1],['bad-history',1],['bad-provider-hash',1],['bad-relink-hash',1],['bad-current-plan',1],['bad-current-acceptance',1],['bad-provider-promotion',1]],results=[];
 for(const [scenario,status]of scenarios){const args=[__filename,'--fixture',scenario];if(scenario==='require-ready')args.push('--require-ready');const r=spawnSync(process.execPath,args,{windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});assert.equal(r.status,status,scenario+' '+r.stderr);if(status===1)assert.ok(!r.stdout.includes('"sourceConsistent":true'),'Premature success output for '+scenario);if(status===2)assert.ok(r.stderr.includes('Release blocked:')&&r.stdout.includes('"ready":false'));results.push({scenario,expectedExit:status,actualExit:r.status});console.log('PASS '+scenario);}
 console.log(JSON.stringify({checks:results.length,allPassed:true,sourceManifestWasNotModified:true,results}));
}
