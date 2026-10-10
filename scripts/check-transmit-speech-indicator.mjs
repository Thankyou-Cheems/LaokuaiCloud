import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(readFileSync(new URL('../src/lib/transmitSpeechIndicator.ts',import.meta.url),'utf8'),{mode:'transform'});
const {transmitSpeechIndicator:read}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const input={speech:true,speechState:{status:'available'},connected:true,muted:false,serverMuted:false,
  transmission:{status:'ready',publicationAcknowledged:true,publicationBlocked:false,publicationAllowed:true}};
assert.equal(read(input),true);
assert.equal(read({...input,transmission:{...input.transmission,status:'disabled'}}),true);
for(const speech of [false,undefined,null,1,'true',{speaking:true}])assert.equal(read({...input,speech}),false);
for(const status of ['recovering','suppressed','suspended','failed'])assert.equal(read({...input,transmission:{...input.transmission,status}}),false);
for(const patch of [{speechState:{status:'unavailable'}},{connected:false},{muted:true},{serverMuted:true}])assert.equal(read({...input,...patch}),false);
for(const patch of [{publicationAcknowledged:false},{publicationAcknowledged:undefined},{publicationBlocked:true},
  {publicationBlocked:undefined},{publicationAllowed:false},{publicationAllowed:undefined}])assert.equal(read({...input,transmission:{...input.transmission,...patch}}),false);
// A pending update can retain a historically-open boundary value, but it is not the current ACK.
assert.equal(read({...input,transmission:{...input.transmission,publicationAcknowledged:false}}),false);
console.log('23 transmit speech boolean/current-publication safety assertions passed');
