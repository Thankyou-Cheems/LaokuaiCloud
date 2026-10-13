// Actual provisioner with memory-only filesystem/native-permission ports.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path'),ts=require('typescript');
const file=path.join(__dirname,'../electron/publicCommunityProvisioning.ts');
const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const fixed={communityId:'老蒯聊_5000_default',serverInstanceId:'老蒯聊_5000_default',serverHost:'voice.ruikang.wang',origin:'https://voice.ruikang.wang',bootstrap:{bootstrapProfileId:'laokuai-public270-9db53f79',upstreamCommit:'8b7f1f0196edb5b580829ed5f135050fb5853478',peerEndpoints:['tcp://124.221.119.113:11014'],ipv4PrefixLength:24,issuerPublicKeyB64:'iP6v39g6ghV7ziiJIV5gwcR+gGHYHz7f/cUEA3hiXyk=',issuerPublicKeyFingerprint:'81915f84f741f90338dc2289354e1beeb42673dcb293ed8e1372326616f13498'}};
const otherTarget={...fixed,communityId:'other-private',serverInstanceId:'other-private',serverHost:'other.invalid',origin:'https://other.invalid'};
async function run({permission=true,existing=false,other=false,scope='老蒯聊_5000_default'}={}) {
  let writes=0,approved;
  const exports={}; const missing=()=>{const e=Error('missing');e.code='ENOENT';throw e;};
  const modules={'node:crypto':{randomUUID:()=> 'synthetic-id'},'node:path':path,
    'node:fs/promises':{mkdir:async()=>{},lstat:async p=>{if(p.endsWith('activation.json')&&!other)missing();return {isSymbolicLink:()=>false,isFile:()=>true,size:20};},readFile:async()=>JSON.stringify({grantCommunities:[{communityId:'other-private',origin:'https://other.invalid'}]}),open:async()=>({writeFile:async b=>{approved=JSON.parse(b);writes++;},sync:async()=>{},close:async()=>{}}),rename:async()=>{},unlink:async()=>{}},
    './communityEtTrustedConfiguration':{protectOwnedFile:async()=>{},readCommunityGrantTarget:async(_root,id)=>{if(existing&&id==='老蒯聊_5000_default')return fixed;if(other&&id==='other-private')return otherTarget;missing(); }},'./easyTierWindowsProcesses':{hasEasyTierWindowsPermission:async()=>permission}};
  vm.runInNewContext(code,{exports,require:id=>modules[id]}, {filename:file});
  let result;try{result=await exports.approvePublicCommunity('synthetic-root',scope,undefined,async()=>permission);}catch(error){result={accepted:false,error};}
  return {result,writes,approved};
}
(async()=>{
  const noAdmin=await run({permission:false});assert.equal(noAdmin.result.reason,'needs-permission');assert.equal(noAdmin.writes,0);
  const wrong=await run({scope:'private-community'});assert.equal(wrong.result.accepted,false);assert.equal(wrong.writes,0);
  const preserve=await run({other:true});assert.equal(preserve.result.accepted,false);assert.equal(preserve.result.error.message,'other-community-policy-preserved');assert.equal(preserve.writes,0);
  const prior=await run({existing:true});assert.equal(prior.result.accepted,true);assert.equal(prior.writes,0);
  const yes=await run();assert.equal(yes.result.accepted,true);assert.equal(yes.writes,1);assert.equal(yes.approved.schemaVersion,3);assert.equal(yes.approved.expiresAtUnixMs,null);assert.equal(yes.approved.grantCommunities.length,1);assert.equal(yes.approved.grantCommunities[0].serverHost,'voice.ruikang.wang');
  console.log(JSON.stringify({passed:true,actualProvisionerScenarios:5,dialogsActuallyOpened:false,profilesOrCredentialsWritten:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
