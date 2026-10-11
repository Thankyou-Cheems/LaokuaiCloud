import assert from 'node:assert/strict';
import { advance, FakeSocket, fakePhonePlatform, fakeRoom, log, mountEngine, settle, voiceConfig } from './engine-harness.mjs';
import { VoiceConfigProvider } from '../dist/config/index.js';
import { setVoicePlatform } from '../dist/platform/index.js';
import { VoiceSingletonHooks } from '../dist/shared/SingletonHooks.js';
import { useSFU } from '../dist/webrtc/hooks/useSFU.js';
import { applyLocalMicrophoneCodecSdp, applyMicrophoneCodec, remoteMicrophoneCodecMatches, snapshotMicrophoneCodec } from '../dist/webrtc/hooks/microphoneCodec.js';
const profile={codec:'opus',maxBitrateBps:24000,packetTimeMs:20,channels:1,vbr:true,dtx:true,fec:true};
let assertions=0;
const equal=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);++assertions;};
const mic='m=audio 9 UDP/TLS/RTP/SAVPF 111 0\r\na=mid:0\r\na=recvonly\r\na=rtpmap:111 opus/48000/2\r\na=rtpmap:0 PCMU/8000\r\na=fmtp:111 minptime=10;maxaveragebitrate=24000;stereo=0;cbr=0;usedtx=1;useinbandfec=1\r\na=ptime:20\r\na=maxptime:20\r\n';
const other='m=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:1\r\na=sendonly\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 usedtx=0\r\na=ptime:10\r\n';
const sdp='v=0\r\n'+mic+other;
const phone=fakePhonePlatform();setVoicePlatform(phone);
const pc=phone.createPeerConnection({});const track={kind:'audio'},sender=pc.addTrack(track,{id:'mic'});
pc.getTransceivers()[0].mid='0';sender.parameters.codecs=[{mimeType:'audio/opus',payloadType:111}];
equal(snapshotMicrophoneCodec(profile),profile);equal(snapshotMicrophoneCodec(undefined),undefined);
for(const patch of [{channels:2},{codec:'pcmu'},{maxBitrateBps:NaN},{maxBitrateBps:5999},{maxBitrateBps:510001},{packetTimeMs:15},{dtx:1},{fec:null},{vbr:undefined}]) {
  assert.throws(()=>snapshotMicrophoneCodec({...profile,...patch}),/invalid_profile/);++assertions;
}
const snapshot=snapshotMicrophoneCodec(profile);snapshot.maxBitrateBps=32000;equal(profile.maxBitrateBps,24000);
equal(remoteMicrophoneCodecMatches(pc,[sender],sdp,profile),true);
for(const change of [text=>text.replace('usedtx=1','usedtx=0'),text=>text.replace('useinbandfec=1','useinbandfec=0'),text=>text.replace('stereo=0','stereo=1'),text=>text.replace('cbr=0','cbr=1'),text=>text.replace('maxaveragebitrate=24000','maxaveragebitrate=64000'),text=>text.replace('a=ptime:20','a=ptime:10'),text=>text.replace('a=maxptime:20','a=maxptime:60'),text=>text.replace('opus/48000/2','PCMU/8000')]) {
  equal(remoteMicrophoneCodecMatches(pc,[sender],change(sdp),profile),false);
}
equal(remoteMicrophoneCodecMatches(pc,[],sdp,profile),false);
const answer=applyLocalMicrophoneCodecSdp(pc,[sender],sdp,profile);
equal(answer.endsWith(other),true,'non-microphone section must remain byte-exact');
equal(answer.includes('m=audio 9 UDP/TLS/RTP/SAVPF 111 0'),false);
equal(answer.includes('opus/48000/2'),true,'RFC Opus rtpmap channels stays 2');
equal(answer.includes('sprop-stereo=0'),true);
equal(applyLocalMicrophoneCodecSdp(pc,[sender],answer,profile),answer,'policy is idempotent');
const good=await applyMicrophoneCodec(pc,[sender],profile,sdp);
equal(good.status,'configured');equal(good.remoteOfferMatches,true);equal(good.senderMaxBitrateBps,24000);equal(good.rtpVerified,false);
const channelLimited=await applyMicrophoneCodec(pc,[sender],profile,sdp,16000);
equal(channelLimited.effectiveMaxBitrateBps,16000);equal(channelLimited.senderMaxBitrateBps,16000);equal(channelLimited.limitedBy,['channel_bitrate']);
const lowerRemote=await applyMicrophoneCodec(pc,[sender],{...profile,maxBitrateBps:32000},sdp,64000);
equal(lowerRemote.effectiveMaxBitrateBps,24000);equal(lowerRemote.senderMaxBitrateBps,24000);equal(lowerRemote.remoteMaxAverageBitrateBps,24000);
equal(lowerRemote.limitedBy,['remote_bitrate']);equal(lowerRemote.reason,'remote_offer_profile_mismatch');
equal((await applyMicrophoneCodec(pc,[sender],{...profile,maxBitrateBps:32000,packetTimeMs:40},sdp)).remoteOfferMatches,false);
equal((await applyMicrophoneCodec(pc,[sender],profile,sdp.replace('usedtx=1','usedtx=0'))).reason,'remote_offer_profile_mismatch');
sender.parameters.codecs=[{mimeType:'audio/PCMU'}];equal((await applyMicrophoneCodec(pc,[sender],profile,sdp)).reason,'opus_not_negotiated');
sender.parameters.codecs=[{mimeType:'audio/opus'}];const write=sender.setParameters;
sender.setParameters=async()=>{throw new DOMException('fixture','NotSupportedError');};
const failed=await applyMicrophoneCodec(pc,[sender],profile,sdp);equal(failed.reason,'set_parameters_failed');equal(failed.errorName,'NotSupportedError');
sender.setParameters=async()=>{};sender.parameters.encodings[0].maxBitrate=128000;
equal((await applyMicrophoneCodec(pc,[sender],profile,sdp)).reason,'bitrate_readback_mismatch');sender.setParameters=write;
for(const cap of [0,5000,5999.9]){
  const blocked=phone.createPeerConnection({});const blockedSender=blocked.addTrack({kind:'audio'},{id:'blocked'});
  const state=await applyMicrophoneCodec(blocked,[blockedSender],profile,undefined,cap);
  equal(state.reason,'bitrate_below_opus_minimum');equal(blocked.connectionState,'closed');equal(state.effectiveMaxBitrateBps,Math.floor(cap));
}

// Drive the actual public hook through initial join, renegotiation, config change and recovery.
const config=voiceConfig({stunHosts:['stun:fixture.test']});config.connection.microphoneCodec=profile;config.connection.eSportsMode=true;
const engine=await mountEngine({provider:VoiceConfigProvider,runner:VoiceSingletonHooks,read:()=>useSFU(),config,target:{id:'codec-server',room:fakeRoom('codec-server')}});
await settle(()=>engine.current.connect('chan-a',true,128000).catch(()=>{}));await advance(1000);
let active=phone.peers.at(-1);await settle(()=>active.reach('connected'));
let activeSender=active.getSenders().find(s=>s.track?.kind==='audio');
equal(activeSender.parameters.encodings[0].maxBitrate,24000,'explicit profile beats eSports/channel 128k');
equal(engine.current.microphoneCodecState.status,'degraded','legacy fake offer is not claimed compatible');
activeSender.parameters.codecs=[{mimeType:'audio/opus'}];
await settle(()=>FakeSocket.all.at(-1).deliver('offer',{type:'offer',sdp}));
equal(engine.current.microphoneCodecState.status,'configured');
const activeWrite=activeSender.setParameters;activeSender.setParameters=async()=>{throw new DOMException('fixture','NotSupportedError');};
await settle(()=>FakeSocket.all.at(-1).deliver('offer',{type:'offer',sdp}));
equal(engine.current.microphoneCodecState.reason,'set_parameters_failed','public hook exposes setter failure');activeSender.setParameters=activeWrite;
const first=active;await settle(()=>FakeSocket.all.at(-1).drop());await advance(2000);
active=phone.peers.at(-1);equal(active!==first,true);equal(active.getSenders().find(s=>s.track?.kind==='audio').parameters.encodings[0].maxBitrate,24000,'reconnect keeps explicit profile');
await settle(()=>active.reach('connected'));
await engine.update({config:{...config,connection:{...config.connection,microphoneCodec:{...profile,maxBitrateBps:32000}}}});
equal(engine.current.microphoneCodecState.reason,'profile_changed_reconnect_required');
await settle(()=>FakeSocket.all.at(-1).deliver('offer',{type:'offer',sdp}));
equal(engine.current.microphoneCodecState.reason,'profile_changed_reconnect_required','late old negotiation cannot overwrite changed policy');
const staleSender=active.getSenders().find(s=>s.track?.kind==='audio');let resolveWrite;
staleSender.setParameters=()=>new Promise(resolve=>{resolveWrite=resolve;});
await settle(()=>FakeSocket.all.at(-1).deliver('offer',{type:'offer',sdp}));
await settle(()=>engine.current.disconnect());equal(engine.current.microphoneCodecState.status,'idle');
await settle(()=>resolveWrite());equal(engine.current.microphoneCodecState.status,'idle','late retired-PC parameter ACK cannot revive configuration');
await settle(()=>engine.current.connect('under-minimum',true,5000).catch(()=>{}));
await advance(1000);
equal(engine.current.microphoneCodecState.reason,'bitrate_below_opus_minimum');equal(engine.current.isConnected,false);
equal(engine.current.getPeerConnection(),null,'below-minimum channel closes and cleans the publication PC');
await engine.unmount();
log(`microphone codec: ${assertions} assertions; fake lifecycle plus authentic SDP parsing, no real capture/network`);
