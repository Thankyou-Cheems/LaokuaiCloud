import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(readFileSync(new URL('../src/lib/voiceQualityStats.ts',import.meta.url),'utf8'),{mode:'transform'});
const {VoiceQualitySampler}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const rows=(t,received,lost)=>[
 {id:'transport',type:'transport',selectedCandidatePairId:'pair'},
 {id:'pair',type:'candidate-pair',state:'succeeded',currentRoundTripTime:.04,address:'PRIVATE'},
 {id:'source',type:'media-source',trackIdentifier:'mic'},
 {id:'out',type:'outbound-rtp',kind:'audio',mediaSourceId:'source',remoteId:'remote'},
 {id:'remote',type:'remote-inbound-rtp',kind:'audio',localId:'out',timestamp:t,packetsReceived:received,packetsLost:lost,roundTripTime:.06},
 {id:'in',type:'inbound-rtp',kind:'audio',timestamp:t,packetsReceived:received,packetsLost:lost,jitter:.007},
 {id:'video',type:'inbound-rtp',kind:'video',timestamp:t,packetsReceived:999,packetsLost:1,jitter:4},
];
const sampler=new VoiceQualitySampler(1);
const first=sampler.sample(rows(1000,50,1),'mic');assert.equal(first.iceRttMs,40);assert.equal(first.uplink.rttMs,60);assert.equal(first.uplink.sample,null);assert.equal(first.receive.jitterMaxMs,7);
const second=sampler.sample(rows(3000,150,3),'mic');assert.deepEqual(second.receive.sample,{windowMs:2000,packetsReceived:100,packetsLost:2});assert.equal(second.seq,2);assert.equal(second.connectionGeneration,1);
assert.equal(JSON.stringify(second).includes('PRIVATE'),false);
assert.equal(sampler.sample(rows(5000,100,0),'mic').receive.sample,null,'counter reset is unknown');
assert.equal(sampler.sample(rows(7000,150,-1),'mic').receive.sample,null,'negative loss is unknown');
assert.equal(sampler.sample(rows(9000,160,0),'mic').receive.sample,null,'negative baseline cannot become a real delta');
const newer=new VoiceQualitySampler(2);assert.equal(newer.sample(rows(11000,999,9),'mic').seq,1);
assert.equal(newer.sample([], 'mic').iceRttMs,null);
const unrelated=rows(1000,2,1).map(row=>row.id==='remote'?{...row,localId:'other'}:row);
assert.equal(new VoiceQualitySampler(1).sample(unrelated,'mic').uplink,null);
assert.equal(new VoiceQualitySampler(1).sample(rows(1000,2,1),'not-mic').uplink,null);
const noSelected=rows(1000,2,1).filter(row=>row.type!=='transport');assert.equal(new VoiceQualitySampler(1).sample(noSelected,'mic').iceRttMs,null);
const invalid=rows(1000,2,1).map(row=>row.id==='pair'?{...row,currentRoundTripTime:Infinity}:row);assert.equal(new VoiceQualitySampler(1).sample(invalid,'mic').iceRttMs,null);
const low=new VoiceQualitySampler(1);low.sample(rows(1000,1,0),'mic');assert.equal(low.sample(rows(3000,1,0),'mic').receive.sample,null,'DTX/no packets is unknown, not zero loss');
console.log('14 raw RTC quality association/delta/privacy checks passed');
