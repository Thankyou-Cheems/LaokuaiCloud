/* eslint-env node */
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
const output = path.join(root,'build/legal/SOURCE-OFFER.json');
fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,JSON.stringify(offer,null,2)+'\n');
console.log('Pinned source offer written; this does not publish or prove remote availability.');
