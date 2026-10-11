import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import {createHash} from 'node:crypto';
try { os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
const vendor=resolve(process.argv[2]);
const {chromium}=await import(pathToFileURL(resolve(vendor,'playwright/index.mjs')).href);
const {build}=await import(pathToFileURL(resolve(vendor,'esbuild/lib/main.js')).href);
const bundle=await build({stdin:{contents:`
export { TransmissionController } from './src/audio/lib/transmission';
export { Rnnoise } from '@shiguredo/rnnoise-wasm';
export { useMicrophone } from './src/audio/hooks/useMicrophone';
export { VoiceConfigProvider } from './src/config';
export { registrations } from './src/shared/singletonHook';
export { setVoicePlatform } from './src/platform';
export { webPlatform } from './src/platform/web';
export { createElement } from 'react';
export { createRoot } from 'react-dom/client';`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',
nodePaths:[vendor],alias:{react:resolve('node_modules/react/index.js')},plugins:[{name:'genuine-rnnoise-error-fixture',setup(build){build.onLoad({filter:/rnnoiseProcessor\.ts$/},args=>({loader:'ts',contents:readFileSync(args.path,'utf8')
.replace("const d = e.data;","const d = e.data; if(d.type==='test-crash')this.testCrash=true;")
.replace('  process(inputs, outputs, parameters) {',"  process(inputs, outputs, parameters) { if(this.testCrash)throw Error('fixture-processor-error');")}));
build.onLoad({filter:/[\\/]transmission\.ts$/},args=>({loader:'ts',contents:readFileSync(args.path,'utf8')
 .replace('this.boundary = node;','this.boundary = node; globalThis.fixtureTransmission=this; globalThis.fixtureBoundaryAcks=[];')
 .replace('this.acknowledged = data.revision;','globalThis.fixtureBoundaryAcks.push(data); this.acknowledged = data.revision;')}));}}]
});
const worker=await build({entryPoints:['src/audio/processors/rnnoiseWorker.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
const pcm=readFileSync('third-party/receive-rnn/fixtures/samples.pcm');
const server=createServer((req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].contents);}
  else if(req.url==='/rnnoiseWorker.js'){res.setHeader('Content-Type','application/javascript');res.end(worker.outputFiles[0].contents);}
  else if(req.url==='/speech.pcm'){res.setHeader('Content-Type','application/octet-stream');res.end(pcm);}
  else{res.setHeader('Content-Type','text/html');res.end('<title>Muted synthetic transmit speech checks</title>');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;let browser;
try{
  browser=await chromium.launch({headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage();page.on("pageerror",e=>console.log("PAGE ERROR",e.message));
  await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
  await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=()=>{throw Error('Real microphone forbidden')};});
  await page.goto(url);
  const exerciseHook=async page=>page.evaluate(async()=>{
    const api=await import('/bundle.js');const pcm=new Int16Array(await(await fetch('/speech.pcm')).arrayBuffer());
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const wait=async(fn,label)=>{for(let i=0;i<350;i++){if(fn())return;await sleep(20);}throw Error(label+' timeout '+JSON.stringify({speech:window.mic?.transmitSpeechActivityState,tx:window.mic?.transmissionState,rate:window.mic?.audioContext?.sampleRate,params:[...window.mic.microphoneBuffer.noiseGateWorklet.parameters].map(([k,v])=>[k,v.value])}));};
    const synth=new AudioContext({sampleRate:48000});await synth.resume();
    const buffer=synth.createBuffer(1,pcm.length,48000);for(let i=0;i<pcm.length;i++)buffer.getChannelData(0)[i]=pcm[i]/32768*.1;
    let source=synth.createBufferSource();source.buffer=buffer;source.loop=true;source.start();
    const dest=synth.createMediaStreamDestination();source.connect(dest);
    navigator.mediaDevices.enumerateDevices=async()=>[{kind:'audioinput',deviceId:'synthetic',label:'Synthetic fixture',groupId:'test'}];
    api.setVoicePlatform({...api.webPlatform,getMicrophone:async()=>dest.stream});
    let config={audio:{deviceId:'synthetic',muted:false,serverMuted:false,deafened:false,serverDeafened:false,outputVolume:100,
      inputMode:'voice_activity',volume:100,loopback:false,noiseSuppression:false,noiseGateMode:"automatic",noiseGate:0,noiseGateRelease:200,
      autoGain:{enabled:false,targetDb:-20},compressorEnabled:false,compressorAmount:50,
      transmitSuppressionEnabled:true,transmitSpeechActivityEnabled:true,transmitEligible:false},
      camera:{quality:'720p',fps:30,mirrored:false},screen:{quality:'1080p',fps:30,gamingMode:false},connection:{stunHosts:[],eSportsMode:false}};
    function Runner(){return api.registrations.map(r=>r.render());}let access=false;
    function Probe(){window.mic=api.useMicrophone(access);return null;}
    const container=document.createElement('div');document.body.append(container);const root=api.createRoot(container);
    const render=()=>root.render(api.createElement(api.VoiceConfigProvider,{config},api.createElement(Runner),api.createElement(Probe)));
    const update=async audio=>{config={...config,audio:{...config.audio,...audio}};render();await sleep(60);};
    render();await sleep(80);access=true;render();await wait(()=>window.mic?.transmissionState.status==='ready','initial hook ready');
    window.mic.setTransmitConnected(true);await sleep(100);const permissionDefaultClosed=!window.mic.transmitSpeechActivity;
    await update({transmitEligible:true});await wait(()=>window.mic.transmitSpeechActivity===true,'public hook speech');
    const id=window.mic.microphoneBuffer.publicationStream.id;
    await update({muted:true});const muted=!window.mic.transmitSpeechActivity;
    await update({muted:false,inputMode:'push_to_talk'});const pttIdle=!window.mic.transmitSpeechActivity;
    window.mic.setPushToTalkActive(true);await wait(()=>window.mic.transmitSpeechActivity,'hook PTT speech');
    window.mic.setPushToTalkActive(false);await sleep(20);const pttRelease=!window.mic.transmitSpeechActivity;
    await update({inputMode:'voice_activity'});await wait(()=>window.mic.transmitSpeechActivity,'hook VA speech');
    window.mic.setTransmitSuppressed(true);await sleep(20);const suppressed=!window.mic.transmitSpeechActivity;
    await update({compressorEnabled:true});const rebuildHeld=!window.mic.transmitSpeechActivity;
    window.mic.setTransmitSuppressed(false);await wait(()=>window.mic.transmissionState.status==='ready','hook fresh recovery');
    await wait(()=>window.mic.transmitSpeechActivity,'hook fresh actual speech');const publicationIdStable=window.mic.microphoneBuffer.publicationStream.id===id;
    window.mic.setTransmitConnected(false);await sleep(20);const disconnected=!window.mic.transmitSpeechActivity;
    await update({transmitEligible:false});window.mic.setTransmitConnected(true);await sleep(80);const noSpeak=!window.mic.transmitSpeechActivity;
    await update({transmitEligible:true});await wait(()=>window.mic.transmitSpeechActivity,'hook reconnect speech');
    if(window.mic.audioContext.sampleRate===44100) {
      await update({noiseSuppression:true});await wait(()=>window.mic.transmitSpeechActivity,'44.1 real fallback speech');
      const state=window.mic.transmitSpeechActivityState;
      const unsupportedNsObservable=state.source==='webrtc_rnn' && state.noiseSuppression?.status==='unavailable' && state.noiseSuppression.reason==='unsupported_sample_rate';
      root.unmount();source.stop();await synth.close();return {unsupportedNsObservable};
    }
    const ctx=window.mic.audioContext;
    const recorderCode=`class Measure extends AudioWorkletProcessor {
      constructor(){super();this.left=0;this.peak=0;this.samples=0;this.port.onmessage=()=>{this.left=4800;this.peak=0;this.samples=0;};}
      process(inputs,outputs){for(const channel of outputs[0])channel.fill(0);if(this.left>0){const input=inputs[0]?.[0];if(input)for(const value of input){this.peak=Math.max(this.peak,Math.abs(value));this.samples++;if(--this.left===0){this.port.postMessage({peak:this.peak,samples:this.samples});break;}}}return true;}
    }registerProcessor('synthetic-publication-measure',Measure);`;
    const recorderUrl=URL.createObjectURL(new Blob([recorderCode],{type:'application/javascript'}));
    await ctx.audioWorklet.addModule(recorderUrl);URL.revokeObjectURL(recorderUrl);
    const recorder=new AudioWorkletNode(ctx,'synthetic-publication-measure');
    const publicationSource=ctx.createMediaStreamSource(window.mic.microphoneBuffer.publicationStream);
    publicationSource.connect(recorder);recorder.connect(ctx.destination);
    const measure=async()=>{await sleep(100);return new Promise(resolve=>{recorder.port.onmessage=e=>resolve(e.data);recorder.port.postMessage('measure');});};
    const closedAck=()=>window.mic.transmissionState.publicationAcknowledged===true && window.mic.transmissionState.publicationBlocked===true;
    await update({noiseGateMode:'manual',noiseGate:0,transmitEligible:false});
    await wait(closedAck,'manual permission actual closed ACK');
    const manualNoPermissionPcm=await measure();
    const manualClosedRevision=window.mic.transmissionState.publicationRevision;
    await update({transmitEligible:true});await wait(()=>window.mic.transmissionState.publicationAllowed===true,'manual actual allowed ACK');
    const manualAllowedPcm=await measure();
    window.mic.setTransmitConnected(false);await wait(closedAck,'manual disconnect actual closed ACK');
    const manualDisconnectedPcm=await measure();
    window.mic.setTransmitConnected(true);await wait(()=>window.mic.transmissionState.publicationAllowed===true,'manual reconnect actual allowed ACK');
    const manualReconnectedPcm=await measure();
    await update({transmitEligible:false});await wait(closedAck,'manual revoked permission actual closed ACK');
    const manualRevokedPcm=await measure();
    const manualPermissionPcmZero=[manualNoPermissionPcm,manualDisconnectedPcm,manualRevokedPcm].every(x=>x.peak===0 && x.samples===4800);
    const manualEligiblePcmNonzero=[manualAllowedPcm,manualReconnectedPcm].every(x=>x.peak>0 && x.samples===4800);
    const manualActualAckRevision=Number.isInteger(manualClosedRevision) && window.mic.transmissionState.publicationRevision>manualClosedRevision;
    const manualPcmEvidence={manualNoPermissionPcm,manualAllowedPcm,manualDisconnectedPcm,manualReconnectedPcm,manualRevokedPcm,manualClosedRevision,finalRevision:window.mic.transmissionState.publicationRevision};
    publicationSource.disconnect();recorder.disconnect();recorder.port.close();
    // Test-only observation of the actual stable boundary output avoids a MediaStream recorder queue.
    source.stop();await sleep(200);await update({transmitEligible:true});
    await wait(()=>window.mic.transmissionState.publicationAllowed===true,'manual fresh marker eligible');
    const markerRecorderCode=`class Marker extends AudioWorkletProcessor {process(inputs,outputs){for(const channel of outputs[0])channel.fill(0);if(inputs[0]?.[0])this.port.postMessage({frame:currentFrame,pcm:inputs[0][0].slice()});return true;}}registerProcessor('synthetic-native-marker',Marker);`;
    const markerUrl=URL.createObjectURL(new Blob([markerRecorderCode],{type:'application/javascript'}));await ctx.audioWorklet.addModule(markerUrl);URL.revokeObjectURL(markerUrl);
    const nativeFreshMarker=[];
    for(const [ns,edge] of [[false,'connection'],[false,'ptt'],[true,'connection'],[true,'ptt'],[true,'squad']]) {
      await update({noiseSuppression:ns,inputMode:edge==='ptt'?'push_to_talk':'voice_activity'});
      if(edge==='ptt')window.mic.setPushToTalkActive(true);
      await wait(()=>window.mic.transmissionState.publicationAllowed===true && (ns?!!window.mic.microphoneBuffer.rnnoiseNode:window.mic.transmitSpeechActivityState.source==='webrtc_rnn'),'marker model and eligible gate');
      const markerRecorder=new AudioWorkletNode(ctx,'synthetic-native-marker'),markerChunks=[];
      markerRecorder.port.onmessage=e=>markerChunks.push(e.data);
      window.fixtureTransmission.boundary.connect(markerRecorder);markerRecorder.connect(ctx.destination);
      const marker=ctx.createOscillator(),markerGain=ctx.createGain();marker.frequency.value=1537;markerGain.gain.value=.02;marker.connect(markerGain);markerGain.connect(window.mic.microphoneBuffer.input);marker.start();
      await sleep(150);const beforeEdgeFrame=ctx.currentTime*ctx.sampleRate;
      marker.stop(ctx.currentTime);
      if(edge==='connection')window.mic.setTransmitConnected(false);else if(edge==='ptt')window.mic.setPushToTalkActive(false);else window.mic.setTransmitSuppressed(true);
      await sleep(4);const releaseRequestedFrame=ctx.currentTime*ctx.sampleRate,releaseStarted=performance.now();
      if(edge==='connection')window.mic.setTransmitConnected(true);else if(edge==='ptt')window.mic.setPushToTalkActive(true);else window.mic.setTransmitSuppressed(false);
      await wait(()=>window.mic.transmissionState.publicationAllowed===true,'native marker actual reopen');
      const releaseWaitMs=performance.now()-releaseStarted;await sleep(100);
      const openAck=window.fixtureBoundaryAcks.filter(x=>!x.blocked && x.frame>=beforeEdgeFrame).at(-1);
      let oldTailAfterActualOpenPeak=0,preEdgeMarkerPeak=0,observedSamples=0;
      for(const chunk of markerChunks)for(let i=0;i<chunk.pcm.length;i++){
        const frame=chunk.frame+i,value=Math.abs(chunk.pcm[i]);
        if(frame<beforeEdgeFrame)preEdgeMarkerPeak=Math.max(preEdgeMarkerPeak,value);
        if(openAck && frame>=openAck.frame){oldTailAfterActualOpenPeak=Math.max(oldTailAfterActualOpenPeak,value);observedSamples++;}
      }
      nativeFreshMarker.push({source:ns?'rnnoise':'webrtc_rnn',edge,beforeEdgeFrame,releaseRequestedFrame,requestedForbiddenMs:(releaseRequestedFrame-beforeEdgeFrame)/ctx.sampleRate*1000,releaseWaitMs,openAck,preEdgeMarkerPeak,oldTailAfterActualOpenPeak,observedSamples});
      window.fixtureTransmission.boundary.disconnect(markerRecorder);markerRecorder.disconnect();markerRecorder.port.close();markerGain.disconnect();
    }
    const clear=row=>!!row.openAck && row.preEdgeMarkerPeak>0 && row.observedSamples>=2400 && row.oldTailAfterActualOpenPeak===0;
    const manualNativeOldTailCleared=nativeFreshMarker.filter(x=>x.source==='webrtc_rnn').every(clear);
    const sharedRnnoiseNativeOldTailCleared=nativeFreshMarker.filter(x=>x.source==='rnnoise').every(clear);
    source=synth.createBufferSource();source.buffer=buffer;source.loop=true;source.connect(dest);source.start();
    await update({noiseGateMode:'automatic',transmitEligible:true});await wait(()=>window.mic.transmitSpeechActivity,'auto restored after manual PCM proof');
    await update({noiseSuppression:true});await wait(()=>!!window.mic.microphoneBuffer.rnnoiseNode,'real RNNoise node');
    await wait(()=>window.mic.transmitSpeechActivity,'shared RNNoise real speech');
    const sharedRnnoise=!!window.mic.microphoneBuffer.rnnoiseNode && !window.mic.microphoneBuffer.speechEvidenceNode;
    window.mic.microphoneBuffer.rnnoiseNode.port.postMessage({type:'test-crash'});
    await wait(()=>window.mic.transmissionState.status==='failed','genuine RNNoise processor error');
    const processorFaultClosed=!window.mic.transmitSpeechActivity;
    await update({noiseSuppression:false});window.mic.retryTransmission();await wait(()=>!window.mic.microphoneBuffer.rnnoiseNode,'RNNoise release');
    await wait(()=>window.mic.transmitSpeechActivity,'fallback real speech after NS off');
    access=false;render();await sleep(100);const noHandles=!window.mic.transmitSpeechActivity;
    await update({transmitSpeechActivityEnabled:false});const disabled=window.mic.transmitSpeechActivityState.reason==='disabled';
    root.unmount();source.stop();await synth.close();
    return {checks:{permissionDefaultClosed,muted,pttIdle,pttRelease,suppressed,rebuildHeld,publicationIdStable,disconnected,noSpeak,noHandles,disabled,sharedRnnoise,processorFaultClosed,manualPermissionPcmZero,manualEligiblePcmNonzero,manualActualAckRevision,manualNativeOldTailCleared,sharedRnnoiseNativeOldTailCleared},manualPcmEvidence,nativeFreshMarker};
  });
  const hook=await exerciseHook(page);
  writeFileSync('send-hard-edge-hook-results.json',JSON.stringify(hook.nativeFreshMarker,null,2));console.log('native marker',JSON.stringify(hook.nativeFreshMarker));
  const page441=await browser.newPage();await page441.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
  await page441.addInitScript(()=>{const Native=window.AudioContext;window.AudioContext=class extends Native{constructor(options){super({...options,sampleRate:44100});}};navigator.mediaDevices.getUserMedia=()=>{throw Error('Real microphone forbidden')};});
  await page441.goto(url);const rate441=await exerciseHook(page441);assert.equal(rate441.unsupportedNsObservable,true);await page441.close();
  for(const [key,value]of Object.entries(hook.checks))assert.equal(value,true,key);
  const peaks=await page.evaluate(async()=>{
    const {Rnnoise}=await import('/bundle.js');const bytes=new Int16Array(await(await fetch('/speech.pcm')).arrayBuffer());
    const model=await Rnnoise.load(),rows=[];
    for(const kind of ['quiet-speech','normal-speech','max-gain-shout','seeded-broadband','synthetic-fan','synthetic-keyboard']) {
      const rate=48000,length=rate*8,ctx=new OfflineAudioContext(1,length,rate),source=ctx.createBufferSource();source.buffer=ctx.createBuffer(1,length,rate);
      const input=source.buffer.getChannelData(0);let seed=42;
      for(let i=0;i<length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;
        input[i]=kind==='seeded-broadband'?(seed/2**32*2-1)*.02:kind==='synthetic-fan'?Math.sin(i/rate*Math.PI*2*120)*.008+(seed/2**32*2-1)*.005
        :kind==='synthetic-keyboard'?(i%12000<64?(seed/2**32*2-1)*.2:0):bytes[i%bytes.length]/32768*(kind==='quiet-speech'?.005:kind==='max-gain-shout'?20:.1);}
      const gain=ctx.createGain();gain.gain.value=kind==='max-gain-shout'?4:1;source.connect(gain);
      const comp=ctx.createDynamicsCompressor();comp.threshold.value=-24;comp.knee.value=20;comp.ratio.value=6;comp.attack.value=.003;comp.release.value=.25;gain.connect(comp);
      const makeup=ctx.createGain();makeup.gain.value=10**(3/20);comp.connect(makeup);
      const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-6;limiter.knee.value=0;limiter.ratio.value=20;limiter.attack.value=.001;limiter.release.value=.1;makeup.connect(limiter);
      const trim=ctx.createGain();trim.gain.value=10**(-3.34/20)/4;limiter.connect(trim);
      const clip=ctx.createWaveShaper();clip.oversample='4x';const curve=new Float32Array(4096),ceiling=10**(-1/20);
      for(let i=0;i<curve.length;i++){const x=(i/(curve.length-1)*2-1)*4;curve[i]=ceiling*Math.tanh(x/ceiling);}clip.curve=curve;trim.connect(clip);clip.connect(ctx.destination);source.start();
      const before=(await ctx.startRendering()).getChannelData(0);const state=model.createDenoiseState(),frame=new Float32Array(480);let prePeak=0,postPeak=0,clampSamples=0,trustedFrames=0;
      for(let at=0;at<length;at+=480){for(let i=0;i<480;i++){prePeak=Math.max(prePeak,Math.abs(before[at+i]));frame[i]=before[at+i]*32768;}
        const p=state.processFrame(frame);if(p>=.95)trustedFrames++;
        for(let i=0;i<480;i++){const value=frame[i]/32768;postPeak=Math.max(postPeak,Math.abs(value));if(Math.abs(value)>ceiling)clampSamples++;}}
      state.destroy();rows.push({kind,preRnnoisePeak:prePeak,postRnnoisePeak:postPeak,emergencyClampSamples:clampSamples,trustedFrames,
        bound:ceiling});
    }return rows;
  });

  const sourceHashes=Object.fromEntries(['src/audio/hooks/useMicrophone.ts','src/audio/hooks/microphonePipeline.ts','src/audio/processors/rnnoiseProcessor.ts','src/audio/processors/rnnoiseWorker.ts','src/audio/processors/noiseGateProcessor.ts','src/audio/processors/transmitSpeechProcessor.ts','src/audio/processors/adaptiveTransmitGate.ts','src/audio/processors/transmitSpeechCode.ts','src/audio/processors/transmitCaptureProcessor.ts','src/audio/lib/transmission.ts'].map(path=>[path,createHash('sha256').update(readFileSync(path,'utf8').replace(/\r\n/g,'\n')).digest('hex')]));
  const result={browser:browser.version(),hook,rate441,peaks,sourceHashes,nsOffWaveformEvidence:'adaptive-send-marker-results.json actual 44.1/48k public PCM parity, not a per-kind peak claim', note:'Actual public PCM and RNN, headless muted loopback server, getUserMedia forbidden, BelowNormal.'};
  writeFileSync('adaptive-send-headless-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
