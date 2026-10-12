// Actual provisioner with memory-only filesystem/native-dialog ports.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path'),ts=require('typescript');
const file=path.join(__dirname,'../electron/publicCommunityProvisioning.ts');
const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function run({permission=true,answer=1,existing=false,other=false,scope='老蒯聊_5000_default'}={}) {
  let dialogs=0,writes=0,approved;
  const exports={}; const missing=()=>{const e=Error('missing');e.code='ENOENT';throw e;};
  const modules={electron:{dialog:{showMessageBox:async()=>{dialogs++;return {response:answer};}}},'node:crypto':{randomUUID:()=> 'synthetic-id'},'node:path':path,
    'node:fs/promises':{mkdir:async()=>{},lstat:async p=>{if(p.endsWith('activation.json')&&!other)missing();return {isSymbolicLink:()=>false,isFile:()=>true,size:20};},readFile:async()=>JSON.stringify({grantCommunities:[{communityId:'other-private',origin:'https://other.invalid'}]}),open:async()=>({writeFile:async b=>{approved=JSON.parse(b);writes++;},sync:async()=>{},close:async()=>{}}),rename:async()=>{},unlink:async()=>{}},
    './communityEtTrustedConfiguration':{protectOwnedFile:async()=>{},readCommunityGrantTarget:async()=>{if(!existing)missing();return {}; }},'./easyTierWindowsProcesses':{hasEasyTierWindowsPermission:async()=>permission}};
  vm.runInNewContext(code,{exports,require:id=>modules[id]}, {filename:file});
  let result;try{result=await exports.approvePublicCommunity('synthetic-root',scope);}catch{result={accepted:false};}
  return {result,dialogs,writes,approved};
}
(async()=>{
  const cancel=await run();assert.equal(cancel.result.accepted,false);assert.equal(cancel.writes,0);
  const noAdmin=await run({permission:false,answer:0});assert.equal(noAdmin.result.reason,'needs-permission');assert.equal(noAdmin.writes,0);
  const wrong=await run({answer:0,scope:'private-community'});assert.equal(wrong.dialogs,0);assert.equal(wrong.writes,0);
  const preserve=await run({answer:0,other:true});assert.equal(preserve.result.accepted,false);assert.equal(preserve.writes,0);
  const prior=await run({existing:true});assert.equal(prior.result.accepted,true);assert.equal(prior.dialogs,0);assert.equal(prior.writes,0);
  const yes=await run({answer:0});assert.equal(yes.result.accepted,true);assert.equal(yes.dialogs,1);assert.equal(yes.approved.schemaVersion,3);assert.equal(yes.approved.expiresAtUnixMs,null);assert.equal(yes.approved.grantCommunities.length,1);assert.equal(yes.approved.grantCommunities[0].serverHost,'voice.ruikang.wang');
  console.log(JSON.stringify({passed:true,actualProvisionerScenarios:6,dialogsActuallyOpened:false,profilesOrCredentialsWritten:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
