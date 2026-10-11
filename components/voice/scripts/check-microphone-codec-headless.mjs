import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import { createHash } from 'node:crypto';
try { os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
const vendor=resolve(process.argv[2]);
const sourceHashes=Object.fromEntries(['src/webrtc/hooks/microphoneCodec.ts','src/webrtc/hooks/sfuConnection.ts','src/webrtc/types/MicrophoneCodec.ts']
  .map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
const {chromium}=await import(pathToFileURL(resolve(vendor,'playwright/index.mjs')).href);
const {build}=await import(pathToFileURL(resolve(vendor,'esbuild/lib/main.js')).href);
const bundle=await build({stdin:{contents:`
export { connectToSfuWebSocket } from './src/webrtc/hooks/sfuConnection';
export { applyLocalMicrophoneCodecSdp } from './src/webrtc/hooks/microphoneCodec';`,resolveDir:process.cwd()},
bundle:true,write:false,format:'esm',platform:'browser',nodePaths:[vendor],alias:{react:resolve('node_modules/react/index.js')}});
const pcm=readFileSync('third-party/receive-rnn/fixtures/samples.pcm');
const server=createServer((req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].contents);}
  else if(req.url==='/speech.pcm')res.end(pcm);
  else{res.setHeader('Content-Type','text/html');res.end('<title>Muted synthetic Opus policy checks</title>');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
  const results=[];
  for(const mode of ['legacy','opus20-dtx','opus20-no-dtx']){
    const result=await page.evaluate(async mode=>{
      const api=await import('/bundle.js');
      const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const wait=async(fn,label,ms=10000)=>{const start=performance.now();while(!fn()){if(performance.now()-start>ms)throw Error('Timeout '+label);await sleep(20);}};
      const profile=mode==='legacy'?undefined:{codec:'opus',channels:1,maxBitrateBps:24000,packetTimeMs:20,vbr:true,dtx:mode==='opus20-dtx',fec:true};
      const audio=new AudioContext({sampleRate:48000});await audio.resume();
      const data=new Int16Array(await(await fetch('/speech.pcm')).arrayBuffer());
      const buffer=audio.createBuffer(1,data.length,48000);for(let i=0;i<data.length;i++)buffer.getChannelData(0)[i]=data[i]/32768*.2;
      const source=audio.createBufferSource();source.buffer=buffer;source.loop=true;
      const gain=audio.createGain();gain.gain.value=1;
      const destination=audio.createMediaStreamDestination();destination.channelCount=1;destination.channelCountMode='explicit';
      source.connect(gain).connect(destination);source.start();
      const senderPC=new RTCPeerConnection({encodedInsertableStreams:true}),receiverPC=new RTCPeerConnection();
      const sender=senderPC.addTrack(destination.stream.getAudioTracks()[0],destination.stream);
      const toc={mono:0,stereo:0,durations:{},sizes:{},frames:0};
      if(typeof sender.createEncodedStreams!=='function')throw Error('Encoded Opus inspection unavailable');
      const encoded=sender.createEncodedStreams();
      encoded.readable.pipeThrough(new TransformStream({transform(frame,controller){
        const bytes=new Uint8Array(frame.data);
        if(bytes.length){const config=bytes[0]>>3,code=bytes[0]&3;
          const frameMs=config>=16?2.5*(2**(config&3)):config>=12?10*(2**(config&1)):[10,20,40,60][config&3];
          const count=code===0?1:code<3?2:(bytes[1]&63),duration=frameMs*count;
          if(bytes[0]&4)toc.stereo++;else toc.mono++;
          toc.durations[duration]=(toc.durations[duration]??0)+1;toc.sizes[bytes.length]=(toc.sizes[bytes.length]??0)+1;toc.frames++;
        }controller.enqueue(frame);
      }})).pipeTo(encoded.writable).catch(()=>{});
      const recvSlot=receiverPC.addTransceiver('audio',{direction:'recvonly'});
      let decodedTrack,codecState,socket,wireOffer,receiveAnalyser,decodeElement;
      receiverPC.ontrack=e=>{decodedTrack=e.track;
        decodeElement=document.createElement('audio');decodeElement.autoplay=true;decodeElement.muted=true;
        decodeElement.srcObject=new MediaStream([e.track]);void decodeElement.play();
        receiveAnalyser=audio.createAnalyser();const muted=audio.createGain();muted.gain.value=0;
        audio.createMediaStreamSource(new MediaStream([e.track])).connect(receiveAnalyser).connect(muted).connect(audio.destination);
      };
      const realWebSocket=window.WebSocket;
      class FixtureSocket{
        static OPEN=1;static CONNECTING=0;static CLOSED=3;
        constructor(){this.readyState=0;socket=this;queueMicrotask(()=>{this.readyState=1;this.onopen?.();});}
        send(text){const message=JSON.parse(text);if(message.event==='client_join')void(async()=>{
          const offer=await receiverPC.createOffer();await receiverPC.setLocalDescription(offer);
          await wait(()=>receiverPC.iceGatheringState==='complete','receiver ICE');
          wireOffer=receiverPC.localDescription;
          if(profile)wireOffer={type:'offer',sdp:api.applyLocalMicrophoneCodecSdp(receiverPC,[recvSlot.sender],wireOffer.sdp,profile)};
          this.onmessage?.({data:JSON.stringify({event:'offer',data:JSON.stringify(wireOffer)})});
        })();
        else if(message.event==='answer')void receiverPC.setRemoteDescription(JSON.parse(message.data));
        else if(message.event==='candidate')void receiverPC.addIceCandidate(JSON.parse(message.data));}
        close(){this.readyState=3;this.onclose?.({code:1000,wasClean:true});}
      }
      window.WebSocket=FixtureSocket;
      senderPC.onicecandidate=e=>{if(e.candidate)void receiverPC.addIceCandidate(e.candidate);};
      const refs={isDisconnectingRef:{current:false},sfuWebSocketRef:{current:null},peerConnectionRef:{current:senderPC}};
      const connected=api.connectToSfuWebSocket('ws://synthetic',{room_id:'fixture'},refs,mode==='legacy',{
        microphoneCodec:profile,getMicrophoneSenders:()=>[sender],onMicrophoneCodecState:value=>{codecState=value;},
      });connected.catch(()=>{});
      await wait(()=>senderPC.connectionState==='connected'&&receiverPC.connectionState==='connected','real RTP transport');
      // Complete the same SDK WebSocket lifecycle without a production signaling service.
      socket.onmessage?.({data:JSON.stringify({event:'room_joined',data:'{}'})});await connected;
      const stats=async()=>{const report=await sender.getStats();const row=[...report.values()].find(row=>row.type==='outbound-rtp'&&row.kind==='audio');
        const receiverReport=await receiverPC.getStats();const inbound=[...receiverReport.values()].find(row=>row.type==='inbound-rtp'&&row.kind==='audio');
        return {at:performance.now(),packets:row?.packetsSent??0,bytes:row?.bytesSent??0,headers:row?.headerBytesSent??0,
          codec:[...report.values()].find(row=>row.id===report.get(row?.codecId)?.id)?.sdpFmtpLine??null,
          received:inbound?.packetsReceived??0,decoded:inbound?.totalSamplesReceived??0,audioEnergy:inbound?.totalAudioEnergy??0};};
      const interval=async ms=>{const a=await stats();await sleep(ms);const b=await stats();const seconds=(b.at-a.at)/1000;
        const decoded=new Float32Array(2048);receiveAnalyser?.getFloatTimeDomainData(decoded);
        const pcmPeak=decoded.reduce((peak,value)=>Math.max(peak,Math.abs(value)),0);
        return {seconds,packets:b.packets-a.packets,pps:(b.packets-a.packets)/seconds,payloadBytes:b.bytes-a.bytes,
          payloadBps:8*(b.bytes-a.bytes)/seconds,headerBytes:b.headers-a.headers,received:b.received-a.received,
          decodedSamples:b.decoded-a.decoded,audioEnergy:b.audioEnergy-a.audioEnergy,pcmPeak};};
      await sleep(1500);const speech=await interval(3000);
      gain.gain.setValueAtTime(0,audio.currentTime);await sleep(2500);const silence=await interval(4000);
      gain.gain.setValueAtTime(1,audio.currentTime);await sleep(500);const resumed=await interval(1500);
      const info={mode,codecState:codecState??null,wireOfferCodecLines:wireOffer.sdp.split(/\r?\n/).filter(line=>/^(m=|a=(mid|rtpmap|fmtp|ptime|maxptime):)/.test(line)),
        senderParameters:{encodings:sender.getParameters().encodings,codecs:sender.getParameters().codecs},
        speech,silence,resumed,toc,trackLive:decodedTrack?.readyState==='live'};
      refs.isDisconnectingRef.current=true;socket.close();senderPC.close();receiverPC.close();decodeElement?.pause();if(decodeElement)decodeElement.srcObject=null;
      source.stop();destination.stream.getTracks().forEach(track=>track.stop());await audio.close();window.WebSocket=realWebSocket;return info;
    },mode);
    results.push(result);
    console.log(JSON.stringify({mode,speechPps:result.speech.pps,silencePps:result.silence.pps,speechBps:result.speech.payloadBps,state:result.codecState?.status,toc:result.toc.durations}));
  }
  writeFileSync('microphone-codec-headless-results.candidate.json',JSON.stringify(results,null,2)+'\n');
  const [legacy,dtx,noDtx]=results;
  for(const r of results){assert.equal(r.trackLive,true);assert.ok(r.speech.received>0&&r.resumed.received>0&&r.speech.pcmPeak>0,'RTP reception and actual decoded PCM');assert.equal(r.toc.stereo,0);}
  for(const r of [dtx,noDtx]){assert.equal(r.codecState.status,'configured');assert.equal(r.codecState.remoteOfferMatches,true);assert.equal(r.codecState.senderMaxBitrateBps,24000);assert.equal(r.codecState.rtpVerified,false);assert.deepEqual(Object.keys(r.toc.durations),['20']);assert.ok(Object.keys(r.toc.sizes).length>3);}
  assert.ok(legacy.silence.pps>40&&noDtx.silence.pps>40,'baseline must actually send silence packets');
  assert.ok(dtx.silence.pps<10&&dtx.silence.pps<noDtx.silence.pps/4,'DTX must demonstrably reduce emitted and received RTP packets');
  const evidence={createdAt:new Date().toISOString(),sourceHashes,browserVersion:browser.version(),node:process.version,platform:os.platform(),cpus:os.cpus()[0]?.model,
    sampleRate:48000,peersPerCase:2,serialCases:true,network:'localhost host ICE; WebSocket lifecycle fixture with real Chromium peers; no SFU forwarding/TURN/production',
    limitation:'FEC preference verified; no loss-injection recovery proof. rtpVerified remains false in SDK because these measurements are external.',results};
  writeFileSync('microphone-codec-headless-results.json',JSON.stringify(evidence,null,2)+'\n');
  console.log('PASS real SDK negotiation, encoded mono/20ms/VBR payload sizes, DTX/no-DTX packet A/B and decoded audio; muted headless synthetic only');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
