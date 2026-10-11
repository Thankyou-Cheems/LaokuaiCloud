import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const connect=readFileSync('src/webrtc/hooks/sfuConnectFlow.ts','utf8');
const sfu=readFileSync('src/webrtc/hooks/useSFU.ts','utf8');
const selections=[...connect.matchAll(/streamToUse\s*=\s*(microphoneBufferRef[\s\S]*?);/g)].map(match=>match[1]);
assert.equal(selections.length,2);
const reconnect=sfu.match(/const newStream = ([^;]+);/)[1];
const replacement=sfu.match(/const track = \(microphoneBuffer\.publicationStream([\s\S]*?);/)[0].replace(/^const track = /,'').replace(/;$/,'');
const published={id:'stable-gated',getAudioTracks:()=>[{id:'published-zero-when-held'}]};
const raw={id:'raw',getAudioTracks:()=>[{id:'raw-unsafe'}]};
const processed={id:'old-graph',getAudioTracks:()=>[{id:'old-buffer'}]};
for(const candidate of [{publicationStream:published,processedStream:processed,mediaStream:raw},
  {publicationStream:published,mediaStream:raw},{publicationStream:published}]){
  for(const expression of selections)assert.equal(new Function('microphoneBufferRef','return '+expression)({current:candidate}),published);
  assert.equal(new Function('microphoneBuffer','return '+reconnect)(candidate),published);
  assert.equal(new Function('microphoneBuffer','return '+replacement)(candidate).id,'published-zero-when-held');
}
for(const expression of selections)assert.equal(new Function('microphoneBufferRef','return '+expression)({current:{processedStream:processed,mediaStream:raw}}),processed);
console.log('publication: connect/wait and both replacement selectors prefer stable gated output, including raw fallback');
