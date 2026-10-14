/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '..');
const repository = 'https://github.com/Thankyou-Cheems/LaokuaiCloud';
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:root,encoding:'utf8'}).trim();
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw Error('Missing exact source commit');
const version = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const assets = JSON.parse(fs.readFileSync(path.resolve(root,'../../release/source-materials/public-assets.json'),'utf8'));
const files = assets.files.map(file => {
  const bytes = fs.readFileSync(path.join(root,'build/recipient-source',file.file));
  if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw Error('Source asset mismatch: '+file.file);
  return {...file,url:repository+'/releases/download/'+assets.tag+'/'+file.file};
});
const offer = {schemaVersion:2, version, sourceCommit, sourceRepository:repository,
  sourceTree:repository+'/tree/'+sourceCommit, sourceArchive:repository+'/archive/'+sourceCommit+'.zip',
  sourceInstructions:repository+'/blob/'+sourceCommit+'/docs/SOURCE-ACCESS.md',
  publicSourceApproved:true, publicReleaseApproved:false, files, upstreamSources:assets.upstreamSources,
  sourcesMustAccompanyBinary:false, recipientCanModifyAndRebuild:true, profileOrSecretIncluded:false};
const nativeProvenance = JSON.parse(fs.readFileSync(path.resolve(root,'../easytier/provenance.json'),'utf8'));
if (nativeProvenance.privateBuild.sourceCommit !== '089b6182c603c8ab60044b673effe0cf614cc28a') {
  const manifestPath = 'release/source-materials/member-network-20261013/source-update-manifest.json';
  const repoRoot = path.resolve(root,'../..');
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot,manifestPath),'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.sourceCommit !== nativeProvenance.privateBuild.sourceCommit ||
      manifest.sourceTree !== nativeProvenance.privateBuild.sourceTree || manifest.unchangedDependencies !== true) throw Error('Native source-update manifest does not match current payload');
  const nativeTree = execFileSync('git',['rev-parse',sourceCommit+':components/easytier/source'],{cwd:root,encoding:'utf8'}).trim();
  if (nativeTree !== manifest.sourceTree) throw Error('App source offer does not contain the frozen native subtree');
  const supplements = [manifestPath,'release/source-materials/apply-native-source-update.cjs','release/source-materials/build-updated-recipient-native.ps1'].map(relative => {
    const committed = execFileSync('git',['show',sourceCommit+':'+relative],{cwd:root,maxBuffer:4*1024*1024});
    const current = fs.readFileSync(path.join(repoRoot,relative));
    const canonical = Buffer.from(current.toString('latin1').replace(/\r\n/g,'\n'),'latin1');
    if (!current.equals(committed) && !canonical.equals(committed)) throw Error('Source supplement differs from offered commit: '+relative);
    return {path:relative,bytes:committed.length,sha256:createHash('sha256').update(committed).digest('hex'),url:repository+'/blob/'+sourceCommit+'/'+relative};
  });
  offer.nativeSourceUpdate = {schemaVersion:1,nativeSourceCommit:manifest.sourceCommit,nativeSourceTree:manifest.sourceTree,
    sourceTreeScope:manifest.sourceTreeScope,sourceSnapshot:offer.sourceArchive,sourceFiles:manifest.sourceFiles,
    originalSourceAttachmentsRetained:true,files:supplements,compilerOrNativeExecutionIsSeparate:true};
}
const output = path.join(root,'build/legal/SOURCE-OFFER.json');
if (JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).grytNativeLanVoice === true) {
  const dependencies = JSON.parse(fs.readFileSync(path.resolve(root,'../../experiments/native-audio/dependencies.json'),'utf8'));
  offer.nativeLanAudio = {sourceTree:repository+'/tree/'+sourceCommit+'/experiments/native-audio',
    buildInstructions:repository+'/blob/'+sourceCommit+'/tools/build-native-lan-audio.ps1',
    dependencies, asset:JSON.parse(fs.readFileSync(path.join(root,'electron/nativeLanAudioAsset.json'),'utf8'))};
}
fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,JSON.stringify(offer,null,2)+'\n');
console.log('Pinned source offer written; this does not publish or prove remote availability.');
