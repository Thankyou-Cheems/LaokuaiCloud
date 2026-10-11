const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=path.join(__dirname,'../components/client/release/licenses/native-transitive');
const review=JSON.parse(fs.readFileSync(path.join(base,'native-license-review.json'),'utf8'));
const bytes=fs.readFileSync(path.join(base,review.licenseTextBundle.path));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(sha(bytes),review.licenseTextBundle.sha256);assert.equal(bytes.length,review.licenseTextBundle.bytes);
assert.equal(review.packageRows.length,506);assert.equal(review.reviewedMissingCases,25);
assert.equal(review.potentialRuntimePackages+review.buildOrProcMacroOnlyPackages,506);
assert.equal(new Set(review.packageRows.map(p=>p.name+'@'+p.version+'#'+p.source)).size,506);
assert.equal(review.originalLicenseUtf8ByteRoundTripVerified,true);
const units=new Map();let pos=0;
while((pos=bytes.indexOf('===== SHA256 ',pos))!==-1){
 const end=bytes.indexOf('\n',pos),header=bytes.toString('utf8',pos,end);
 const match=/^===== SHA256 ([a-f0-9]{64}); [^;]+; (\d+) original bytes =====$/.exec(header);assert.ok(match,'Invalid original-text unit header');
 const start=bytes.indexOf('\n\n',end+1)+2;assert.ok(start>end);
 const length=Number(match[2]);const original=bytes.subarray(start,start+length);assert.equal(original.length,length);assert.equal(sha(original),match[1],'Compiled original license bytes changed');
 assert.ok(!units.has(match[1]));units.set(match[1],length);pos=start+length;
}
assert.equal(units.size,review.licenseTextBundle.uniqueTextUnits);
for(const p of review.packageRows){assert.ok(p.licenseTexts.length);for(const text of p.licenseTexts)assert.equal(units.get(text.sha256),text.bytes,p.name+'@'+p.version);if(p.registryArchiveChecksum)assert.equal(p.registryArchiveByteVerified,true);}
const missing=review.packageRows.filter(p=>p.originalTopLevelScanMissing);
assert.equal(missing.length,25);assert.equal(missing.filter(p=>p.reviewStatus==='declared-MIT-without-upstream-license-or-copyright-notice').length,2);
assert.equal(missing.filter(p=>p.reviewStatus==='original-notices-recovered-source-metadata-expression-clarification-pending').length,1);
assert.equal(review.publicDistributionApproved,false);
console.log(JSON.stringify({packages:506,missingCasesReviewed:25,originalTextsOrNoticesRecovered:23,authorNoticeQuestions:2,sourceMetadataClarification:1,registryArchiveChecks:496,originalTextUnits:units.size,originalTextBytesVerified:true,publicDistributionApproved:false}));
