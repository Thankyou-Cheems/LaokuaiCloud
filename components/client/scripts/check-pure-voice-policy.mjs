import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = readFileSync(new URL('../src/lib/pureVoicePolicy.ts', import.meta.url), 'utf8');
const { receiveMicrophoneStreamIds } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const base = {connected:true,host:'server',channelId:'room',clients:[
 {serverUserId:'a',voiceChannelId:'room',hasJoinedChannel:true,streamID:'mic-a'},
 {serverUserId:'b',voiceChannelId:'room',hasJoinedChannel:true,streamID:'mic-b',screenShareAudioStreamID:'screen-b'},
 {serverUserId:'c',voiceChannelId:'other',hasJoinedChannel:true,streamID:'mic-c'},
 {voiceChannelId:'room',hasJoinedChannel:true,streamID:'unknown'},
 {serverUserId:'d',voiceChannelId:'room',hasJoinedChannel:false,streamID:'not-joined'},
]};
assert.deepEqual(receiveMicrophoneStreamIds(base),['mic-a','mic-b']);
for (const changed of [{connected:false},{host:''},{channelId:undefined}]) assert.deepEqual(receiveMicrophoneStreamIds({...base,...changed}),[]);
assert.deepEqual(receiveMicrophoneStreamIds({...base,clients:[...base.clients,{serverUserId:'e',voiceChannelId:'room',hasJoinedChannel:true,streamID:'mic-a'}]}),['mic-a','mic-b']);
// Screen aliases take precedence even when announced by a different room.
assert.deepEqual(receiveMicrophoneStreamIds({...base,clients:[...base.clients,{serverUserId:'e',voiceChannelId:'other',screenShareAudioStreamID:'mic-a'}]}),['mic-b']);
assert.deepEqual(receiveMicrophoneStreamIds({...base,clients:[{serverUserId:'a',voiceChannelId:'room',hasJoinedChannel:true,streamID:' ' }]}),[]);
console.log('7 microphone subscription allowlist checks passed');
