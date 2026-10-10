import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(readFileSync(new URL('../src/lib/movePolicy.ts',import.meta.url),'utf8'),{mode:'transform'});
const {isMovePolicyAcknowledged,sameMovePolicy}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const policy={requirePTT:true,disableRNNoise:true,maxBitrate:64000,eSportsMode:true,speak:true,shareVideo:false,shareScreen:false,isMuted:true,isDeafened:true};
const binding={host:'h',generation:'g',requestId:'r',destinationChannelId:'d',policy,beforePromotionRevision:10};
const evidence={host:'h',generation:'g',channel:'d',config:{audio:{inputMode:'push_to_talk',noiseSuppression:false,transmitEligible:true,
  muted:false,serverMuted:true,deafened:false,serverDeafened:true},connection:{mediaMode:'audio-only',eSportsMode:true,maxBitrate:64000}},
  transmission:{publicationAcknowledged:true,publicationBlocked:true,publicationRevision:11}};
assert.equal(isMovePolicyAcknowledged(binding,'r',policy,evidence),true);
for(const key of ['host','generation','channel'])assert.equal(isMovePolicyAcknowledged(binding,'r',policy,{...evidence,[key]:'other'}),false);
assert.equal(isMovePolicyAcknowledged(undefined,'r',policy,evidence),false);
assert.equal(isMovePolicyAcknowledged(binding,'old',policy,evidence),false);
for(const [key,value] of Object.entries(policy)) {
  const changed={...policy,[key]:typeof value==='boolean'?!value:128000};
  assert.equal(sameMovePolicy(policy,changed),false);
  assert.equal(isMovePolicyAcknowledged(binding,'r',changed,evidence),false);
}
for(const ack of [{publicationAcknowledged:false},{publicationBlocked:false},{publicationRevision:9},
  {publicationRevision:undefined},{publicationRevision:NaN},{publicationRevision:10.5}])
  assert.equal(isMovePolicyAcknowledged(binding,'r',policy,{...evidence,transmission:{...evidence.transmission,...ack}}),false);
for(const audio of [{inputMode:'voice_activity'},{noiseSuppression:true},{transmitEligible:false},
  {transmitEligible:undefined},{serverMuted:false},{serverDeafened:false}])
  assert.equal(isMovePolicyAcknowledged(binding,'r',policy,{...evidence,config:{...evidence.config,audio:{...evidence.config.audio,...audio}}}),false);
assert.equal(isMovePolicyAcknowledged(binding,'r',policy,{...evidence,config:{...evidence.config,connection:{mediaMode:'full',eSportsMode:true}}}),false);
// An unchanged, still-current closed physical gate may keep its revision. A pending/historical ACK never qualifies.
assert.equal(isMovePolicyAcknowledged(binding,'r',policy,{...evidence,transmission:{...evidence.transmission,publicationRevision:10}}),true);
assert.equal(isMovePolicyAcknowledged(binding,'r',policy,{...evidence,config:{...evidence.config,connection:{...evidence.config.connection,maxBitrate:128000}}}),false);
console.log('39 destination policy scope/permission/mute/current closed-ACK assertions passed (pure fixture; no SDK execution)');
