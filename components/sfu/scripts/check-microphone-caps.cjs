// Actual stdlib-only SFU helper + frozen SDK fake-sender checks. No Pion PC,
// socket, audio, browser, Docker, native core or SDK owner working tree.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),sfu=path.join(root,'components/sfu');
const ts=require(path.join(root,'components/client/node_modules/typescript'));
const result=spawnSync('go',['test','-p','1','-count=1','-v','internal/webrtc/microphone_opus_parameters.go','internal/webrtc/microphone_opus_parameters_test.go'],{
 cwd:sfu,windowsHide:true,encoding:'utf8',timeout:60000,
 env:{...process.env,GOPROXY:'off',GOSUMDB:'off',GOTOOLCHAIN:'local'},
});
assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
const fixtures=result.stdout.split(/\r?\n/).filter(line=>line.startsWith('MICROPHONE_CAP_FIXTURE ')).map(line=>JSON.parse(line.slice('MICROPHONE_CAP_FIXTURE '.length)));
assert.equal(fixtures.length,11);
const load=relative=>{
 const output=ts.transpileModule(fs.readFileSync(path.join(root,relative),'utf8'),{reportDiagnostics:true,
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
 assert.deepEqual(output.diagnostics.filter(item=>item.category===ts.DiagnosticCategory.Error),[]);
 const exports={};vm.runInNewContext(output.outputText,{exports,require(name){throw Error('Unexpected runtime dependency '+name);}});return exports;
};
const codec=load('components/voice/src/webrtc/hooks/microphoneCodec.ts'),presets=load('components/client/src/lib/voiceTransportPreset.ts');
const standard=presets.sharedVoicePreset(),peer=presets.peerVoicePreset(standard);
assert.equal(standard.maxBitrateBps,16000);assert.equal(peer.maxBitrateBps,64000);assert.equal(standard.packetTimeMs,60);
const profiles=[standard,peer,...[24000,32000,96000].map(maxBitrateBps=>({...standard,selection:'custom',maxBitrateBps,packetTimeMs:40,requestDtx:false}))];
function senderFixture(){
 let parameters={codecs:[{mimeType:'audio/opus'}],encodings:[{}]},closed=false;
 const microphone={getParameters:()=>structuredClone(parameters),setParameters:async next=>{parameters=structuredClone(next);}};
 const screen={getParameters(){throw Error('Screen parameters must remain untouched');},setParameters(){throw Error('Screen parameters must remain untouched');}};
 const pc={getTransceivers:()=>[{mid:'mic',sender:microphone},{mid:'screen',sender:screen}],close(){closed=true;}};
 return {pc,microphone,isClosed:()=>closed};
}
const sdp=fmtp=>['v=0','m=audio 9 UDP/TLS/RTP/SAVPF 111','a=mid:mic','a=recvonly','a=rtpmap:111 opus/48000/2',
 'a=fmtp:111 '+fmtp,'a=ptime:20','a=maxptime:20','m=audio 9 UDP/TLS/RTP/SAVPF 111','a=mid:screen',
 'a=rtpmap:111 opus/48000/2','a=fmtp:111 maxaveragebitrate=128000;stereo=1','a=ptime:60','a=maxptime:60'].join('\r\n')+'\r\n';
(async()=>{
 let checks=0;
 for(const fixture of fixtures)for(const requested of profiles)for(const channel of [null,16000,32000,96000,0,4000]){
  const profile=presets.voicePresetCodec(requested),{pc,microphone,isClosed}=senderFixture();
  const actualRemote=Number(fixture.fmtp.match(/(?:^|;)maxaveragebitrate=(\d+)/)[1]);
  const expected=Math.min(profile.maxBitrateBps,actualRemote,channel===null?Infinity:channel);
  const state=await codec.applyMicrophoneCodec(pc,[microphone],profile,sdp(fixture.fmtp),channel);
  assert.equal(state.requested.maxBitrateBps,profile.maxBitrateBps);assert.equal(state.effectiveMaxBitrateBps,expected);
  assert.equal(state.remoteMaxAverageBitrateBps,actualRemote);assert.equal(state.rtpVerified,false);
  if(expected<6000){assert.equal(isClosed(),true);assert.equal(state.reason,'bitrate_below_opus_minimum');}
  else {assert.equal(microphone.getParameters().encodings[0].maxBitrate,expected);assert.equal(isClosed(),false);}
  checks++;
 }
 // Peer codec keeps its own 64k intent; the SFU policy is never applied to it.
 for(const channel of [null,16000,32000,48000,96000]){
  const {pc,microphone}=senderFixture(),profile=presets.voicePresetCodec(peer);
  const peerSdp=codec.applyLocalMicrophoneCodecSdp(pc,[microphone],sdp('minptime=10;useinbandfec=1'),profile);
  assert.match(peerSdp,/maxaveragebitrate=64000/);assert.ok(peerSdp.includes('a=fmtp:111 maxaveragebitrate=128000;stereo=1\r\na=ptime:60'));
  const state=await codec.applyMicrophoneCodec(pc,[microphone],profile,peerSdp,channel);
  assert.equal(state.effectiveMaxBitrateBps,Math.min(64000,channel===null?Infinity:channel));assert.equal(state.remoteOfferMatches,true);checks++;
 }
 const wrapper=fs.readFileSync(path.join(sfu,'internal/webrtc/microphone_opus.go'),'utf8');
 assert.ok(wrapper.includes('parameters, err := microphoneOpusParameters(existing, policy)'));
 assert.ok(wrapper.includes('strconv.Itoa(policy.PacketTimeMs)'));
 assert.ok(!wrapper.includes('24000'));
 console.log(JSON.stringify({passed:true,stdlibGoCapCases:11,invalidCapCases:10,otherParametersPreserved:true,
  actualSdkFakeSenderChecks:checks,standardSfuRequest:16000,peerRequest:64000,packetTimeMs:60,
  customAndChannelCapsPreserved:true,actualPreferSdpWrapperExecuted:false,realPeerConnections:0,network:false,capture:false,rtpVerified:false}));
})().catch(error=>{console.error(error);process.exitCode=1;});
