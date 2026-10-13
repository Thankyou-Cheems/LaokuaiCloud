/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
// Script VM with synthetic bytes only; no real offer, ZIP, Git or native mutation.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),vm=require("node:vm");
const code=fs.readFileSync(path.join(__dirname,"write-source-offer.cjs"),"utf8"),root=path.resolve(__dirname,".."),repo=path.resolve(root,"../..");
const appCommit="a".repeat(40),nativeCommit="b".repeat(40),tree="c".repeat(40),sha=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const manifestPath="release/source-materials/member-network-20261013/source-update-manifest.json",updater="release/source-materials/apply-native-source-update.cjs",builder="release/source-materials/build-updated-recipient-native.ps1";
function run({drift=false,wrongTree=false,old=false}={}){
  const archive=Buffer.from("synthetic source archive"),manifest=Buffer.from(JSON.stringify({schemaVersion:1,sourceCommit:nativeCommit,sourceTree:tree,sourceTreeScope:"components/easytier/source subtree in monorepo commit",sourceFiles:1263,unchangedDependencies:true})+"\n");
  const committed=new Map([[manifestPath,manifest],[updater,Buffer.from("updater source\n")],[builder,Buffer.from("builder source\n")]]),data=new Map([
    [path.join(root,"package.json"),Buffer.from(JSON.stringify({version:"synthetic-native-update"}))],
    [path.join(repo,"release/source-materials/public-assets.json"),Buffer.from(JSON.stringify({tag:"old-preserved-source-tag",files:[{file:"fixture.zip",bytes:archive.length,sha256:sha(archive)}],upstreamSources:[]}))],
    [path.join(root,"build/recipient-source/fixture.zip"),archive],
    [path.resolve(root,"../easytier/provenance.json"),Buffer.from(JSON.stringify({privateBuild:{sourceCommit:old?"089b6182c603c8ab60044b673effe0cf614cc28a":nativeCommit,sourceTree:tree}}))],
  ]);
  for(const [name,bytes] of committed)data.set(path.join(repo,name),bytes);
  if(drift)data.set(path.join(repo,updater),Buffer.from("uncommitted updater source\n"));
  let written;
  const dependencies={"node:fs":{readFileSync(file){assert.ok(data.has(file),file);return data.get(file);},mkdirSync(){},writeFileSync(_file,value){written=JSON.parse(value);}},
    "node:path":path,"node:crypto":crypto,"node:child_process":{execFileSync(_tool,args){assert.equal(_tool,"git");
      if(args.join(" ")==="rev-parse HEAD")return appCommit+"\n";
      if(args[0]==="rev-parse")return(wrongTree?"d".repeat(40):tree)+"\n";
      assert.equal(args[0],"show");const name=args[1].slice(appCommit.length+1);assert.ok(committed.has(name));return committed.get(name);
    }}};
  vm.runInNewContext(code,{__dirname,path,Buffer,require:key=>{assert.ok(Object.hasOwn(dependencies,key));return dependencies[key];},console:{log(){}}});return written;
}
const updated=run();assert.equal(updated.sourceCommit,appCommit);assert.equal(updated.files.length,1);assert.equal(updated.files[0].file,"fixture.zip");
assert.equal(updated.nativeSourceUpdate.nativeSourceCommit,nativeCommit);assert.equal(updated.nativeSourceUpdate.nativeSourceTree,tree);assert.equal(updated.nativeSourceUpdate.files.length,3);
assert.equal(updated.nativeSourceUpdate.files[0].path,manifestPath);assert.ok(updated.nativeSourceUpdate.files.every(file=>file.url.includes(appCommit)));
assert.equal(updated.sourcesMustAccompanyBinary,false);assert.equal(updated.publicReleaseApproved,false);assert.equal(updated.nativeSourceUpdate.originalSourceAttachmentsRetained,true);
assert.throws(()=>run({drift:true}),/differs from offered commit/);assert.throws(()=>run({wrongTree:true}),/does not contain the frozen native subtree/);
assert.equal(run({old:true}).nativeSourceUpdate,undefined);
console.log("Native source offer: preserves old attachment inventory, hashes three exact-commit supplements, binds native subtree and rejects dirty/source drift; synthetic metadata only");
