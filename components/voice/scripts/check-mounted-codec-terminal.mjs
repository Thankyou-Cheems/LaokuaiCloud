import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]??new URL('../../../',import.meta.url).pathname),sdk=path.join(root,'components/voice');
const {advance,fakePhonePlatform,fakeRoom,log,mountEngine,settle,voiceConfig,FakeSocket}=await import(pathToFileURL(path.join(sdk,'scripts/engine-harness.mjs')));
const {VoiceConfigProvider}=await import(pathToFileURL(path.join(sdk,'dist/config/index.js')));
const {setVoicePlatform}=await import(pathToFileURL(path.join(sdk,'dist/platform/index.js')));
const {VoiceSingletonHooks}=await import(pathToFileURL(path.join(sdk,'dist/shared/SingletonHooks.js')));
const {useSFU}=await import(pathToFileURL(path.join(sdk,'dist/webrtc/hooks/useSFU.js')));
const phone=fakePhonePlatform(),room=fakeRoom('server-a');setVoicePlatform(phone);
const config=voiceConfig({stunHosts:['stun:a.test']});config.connection.microphoneCodec={codec:'opus',maxBitrateBps:24000,packetTimeMs:20,channels:1,vbr:true,dtx:true,fec:true};
const engine=await mountEngine({provider:VoiceConfigProvider,runner:VoiceSingletonHooks,read:()=>useSFU(),config,target:{id:'server-a',room}});
try {
 let joining;await settle(()=>{joining=engine.current.connect('room-a',false,128000);});await advance(1000);await joining;
 const pc=phone.peers.at(-1),ws=FakeSocket.all.at(-1);await settle(()=>pc.reach('connected'));
 const sender=pc.getSenders().find(x=>x.track?.kind==='audio');sender.parameters.codecs=[{mimeType:'audio/opus',payloadType:111}];
 const sdp='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\na=recvonly\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;maxaveragebitrate=5000;stereo=0;cbr=0;usedtx=1;useinbandfec=1\r\na=ptime:20\r\na=maxptime:20\r\n';
 await settle(()=>ws.deliver('offer',{type:'offer',sdp}));
 const result={sourceRoot:root,pcState:pc.connectionState,reason:engine.current.microphoneCodecState.reason,status:engine.current.microphoneCodecState.status,wsState:ws.readyState};log(JSON.stringify(result,null,2));
 assert.equal(result.pcState,'closed');assert.equal(result.reason,'bitrate_below_opus_minimum','same-generation terminal codec reason must survive intentional PC close');
 assert.equal(result.wsState,3,'terminal codec failure must also close owned signaling socket');
 log('PASS renegotiated terminal codec failure is published for its owner');
}finally{await engine.unmount();}
