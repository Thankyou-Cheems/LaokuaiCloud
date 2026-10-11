import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
const vendor = resolve(process.argv[2]);
const { chromium } = await import(pathToFileURL(resolve(vendor, 'playwright/index.mjs')).href);
const { build } = await import(pathToFileURL(resolve(vendor, 'esbuild/lib/main.js')).href);
const bundle = await build({ stdin: { contents: `
export { TransmissionController } from './src/audio/lib/transmission';
export { createMicrophoneBuffer } from './src/audio/hooks/microphonePipeline';
export { RNNoiseProcessor, RNNOISE_WORKLET_CODE } from './src/audio/processors/rnnoiseProcessor';
export { loadTransmitCapture } from './src/audio/processors/transmitCaptureProcessor';
export { useMicrophone } from './src/audio/hooks/useMicrophone';
export { VoiceConfigProvider } from './src/config';
export { registrations } from './src/shared/singletonHook';
export { setVoicePlatform } from './src/platform';
export { webPlatform } from './src/platform/web';
export { createElement } from 'react';
export { createRoot } from 'react-dom/client';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser', nodePaths: [vendor],
  alias:{react:resolve('node_modules/react/index.js')} });
const worker = await build({ entryPoints: ['src/audio/processors/rnnoiseWorker.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/javascript');
  if (request.url === '/bundle.js') response.end(bundle.outputFiles[0].contents);
  else if (request.url === '/rnnoiseWorker.js') response.end(worker.outputFiles[0].contents);
  else { response.setHeader('Content-Type', 'text/html'); response.end('<title>Synthetic transmission gate</title>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => { throw new Error('Real microphone forbidden'); }; });
  await page.goto(url);
  const results = await page.evaluate(async () => {
    const { TransmissionController, createMicrophoneBuffer, RNNoiseProcessor, RNNOISE_WORKLET_CODE, loadTransmitCapture } = await import('/bundle.js');
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const waitFor = async (fn, label) => { for (let i = 0; i < 250; i++) { if (fn()) return; await sleep(20); } throw new Error(label + ' timeout'); };
    const recordCode = `class Recorder extends AudioWorkletProcessor {
      constructor(){super();this.left=0;this.samples=[];this.port.onmessage=e=>{this.left=e.data;this.samples=[];};}
      process(inputs, outputs){const src=inputs[0][0];outputs[0][0].fill(0);if(this.left&&src){for(const v of src){if(!this.left)break;this.samples.push(v);this.left--;}if(!this.left)this.port.postMessage(this.samples);}return true;}
    } registerProcessor('record',Recorder);`;
    const rows = [];
    for (const rate of [44100, 48000]) {
      for (const rnEnabled of [false, ...(rate === 48000 ? [true] : [])]) {
        const ctx = new AudioContext({ sampleRate: rate }); await ctx.resume(); await loadTransmitCapture(ctx);
        const recordURL = URL.createObjectURL(new Blob([recordCode], {type:'application/javascript'}));
        await ctx.audioWorklet.addModule(recordURL); URL.revokeObjectURL(recordURL);
        const source = ctx.createOscillator(); source.frequency.value = 230; source.start();
        let rn;
        if (rnEnabled) { rn = new RNNoiseProcessor(); await rn.initialize(ctx); rn.setEnabled(true); }
        let buf, freshCount = 0;
        const build = async generation => {
          if (buf) { source.disconnect(buf.input); buf.disposePipeline(); }
          buf = createMicrophoneBuffer({ audioContext:ctx, micStream:undefined, rnnoiseNode:rn?.getNode() ?? null,
            noiseGateNode:null, eSportsModeEnabled:false, autoGainEnabled:false, compressorEnabled:true, captureGeneration:generation });
          buf.volumeGain.gain.value = .1; source.connect(buf.input);
          tx.attach(buf.finalAnalyser, buf.captureFresh);
          await buf.captureFresh; freshCount++;
        };
        const tx = new TransmissionController(ctx, async generation => {
          if (rn) await rn.resetForTransmission();
          await build(generation);
        });
        tx.setEnabled(true); await build(0); await sleep(100);
        const recorder = new AudioWorkletNode(ctx, 'record'); tx.gate.connect(recorder); recorder.connect(ctx.destination);
        const record = () => new Promise(resolve => { recorder.port.onmessage=e=>resolve(e.data); recorder.port.postMessage(2048); });
        const peak = values => values.reduce((a,b)=>Math.max(a,Math.abs(b)),0);
        const baseline = peak(await record());
        tx.setSuppressed(true); const requestStatus=tx.state.status;
        await waitFor(()=>tx.state.status==='suppressed','audio boundary suppression ACK');
        const acknowledgedStatus=tx.state.status; await sleep(40); const suppressed = peak(await record());
        source.frequency.value = 670; const recoveryStart=performance.now(); tx.setSuppressed(false);
        const immediatelyClosed = tx.gate.gain.value === 0;
        await waitFor(() => tx.state.status === 'ready', 'fresh recovery');
        const recoveryMs=performance.now()-recoveryStart;
        const recovered = peak(await record());
        tx.setSuppressed(true); tx.setSuppressed(false); tx.setSuppressed(true); await sleep(120);
        const repress = peak(await record());
        tx.setEnabled(false); await waitFor(() => tx.state.status === 'disabled', 'safe disable');
        const disabled = peak(await record());
        tx.setEnabled(true); tx.setSuppressed(true); tx.setReasons({userMuted:true,serverMuted:false,pttRequired:false,pttHeld:false});
        tx.setSuppressed(false); await waitFor(() => tx.state.status === 'ready', 'muted fresh');
        const userMuted = peak(await record());
        tx.setReasons({userMuted:false,serverMuted:true,pttRequired:true,pttHeld:true});
        const serverMuted = peak(await record());
        tx.setReasons({userMuted:false,serverMuted:false,pttRequired:true,pttHeld:false});
        const pttReleased = peak(await record());
        rows.push({rate,rnEnabled,baseline,suppressed,recovered,repress,disabled,userMuted,serverMuted,pttReleased,immediatelyClosed,freshCount,recoveryMs,requestStatus,acknowledgedStatus});
        source.stop(); buf.disposePipeline(); rn?.destroy(); tx.dispose(); recorder.disconnect(); await ctx.close();
      }
    }
    const lateCtx = new AudioContext({sampleRate:48000}); await lateCtx.resume();
    const codeURL=URL.createObjectURL(new Blob([RNNOISE_WORKLET_CODE],{type:'application/javascript'}));
    await lateCtx.audioWorklet.addModule(codeURL); URL.revokeObjectURL(codeURL);
    const rnNode=new AudioWorkletNode(lateCtx,'rnnoise-processor');
    const port=new MessageChannel(); rnNode.port.postMessage({type:'worker-port'},[port.port1]); rnNode.port.postMessage({type:'enable',enabled:true});
    const old=lateCtx.createConstantSource();old.offset.value=.1;old.connect(rnNode);old.start();
    const recorderURL=URL.createObjectURL(new Blob([recordCode],{type:'application/javascript'}));await lateCtx.audioWorklet.addModule(recorderURL);URL.revokeObjectURL(recorderURL);
    const recorder=new AudioWorkletNode(lateCtx,'record');rnNode.connect(recorder);recorder.connect(lateCtx.destination);
    const collect=()=>new Promise(resolve=>{recorder.port.onmessage=e=>resolve(e.data);recorder.port.postMessage(2048);});
    rnNode.port.postMessage({type:'reset-transmission',generation:9});await sleep(30);
    port.port2.postMessage({type:'processed',generation:0,frame:new Float32Array(480).fill(.8).buffer});
    const lateOldPeak=Math.max(...(await collect()).map(Math.abs));
    port.port2.postMessage({type:'reset-ack',generation:9});
    port.port2.onmessage=e=>{if(e.data.type==='frame'&&e.data.generation===9)port.port2.postMessage({type:'processed',generation:9,frame:new Float32Array(480).fill(.125).buffer});};
    await sleep(60);const lateFreshPeak=Math.max(...(await collect()).map(Math.abs));
    old.stop();rnNode.disconnect();recorder.disconnect();port.port2.close();await lateCtx.close();
    const tailCtx=new AudioContext({sampleRate:48000});await tailCtx.resume();await loadTransmitCapture(tailCtx);
    const tailURL=URL.createObjectURL(new Blob([recordCode],{type:'application/javascript'}));await tailCtx.audioWorklet.addModule(tailURL);URL.revokeObjectURL(tailURL);
    const marker=tailCtx.createConstantSource();marker.offset.value=.6;marker.start();let tailBuf;
    const freshTail=async generation=>{if(tailBuf){marker.disconnect(tailBuf.input);tailBuf.disposePipeline();}
      tailBuf=createMicrophoneBuffer({audioContext:tailCtx,micStream:undefined,rnnoiseNode:null,noiseGateNode:null,
        eSportsModeEnabled:false,autoGainEnabled:false,compressorEnabled:true,captureGeneration:generation});
      tailBuf.volumeGain.gain.value=1;marker.connect(tailBuf.input);tailTx.attach(tailBuf.finalAnalyser,tailBuf.captureFresh);await tailBuf.captureFresh;};
    const tailTx=new TransmissionController(tailCtx,freshTail);tailTx.setEnabled(true);await freshTail(0);await sleep(60);
    const tailRecorder=new AudioWorkletNode(tailCtx,'record');tailTx.gate.connect(tailRecorder);tailRecorder.connect(tailCtx.destination);
    const tailRecord=()=>new Promise(resolve=>{tailRecorder.port.onmessage=e=>resolve(Math.max(...e.data.map(Math.abs)));tailRecorder.port.postMessage(2048);});
    const oldMarkerPeak=await tailRecord();tailTx.setSuppressed(true);await sleep(40);marker.offset.value=0;tailTx.setSuppressed(false);
    await waitFor(()=>tailTx.state.status==='ready','native fresh tail');const nativeFreshZero=await tailRecord();
    marker.stop();tailBuf.disposePipeline();tailTx.dispose();tailRecorder.disconnect();await tailCtx.close();
    const errorCtx=new AudioContext({sampleRate:48000});await errorCtx.resume();await loadTransmitCapture(errorCtx);
    const faultCode=`class FaultBoundary extends AudioWorkletProcessor{constructor(){super();this.rev=0;this.blocked=true;this.boom=false;this.port.onmessage=e=>{if(e.data.type==='throw')this.boom=true;else{this.rev=e.data.revision;this.blocked=e.data.blocked;}};}process(i,o){if(this.boom)throw new Error('intentional-test-fault');if(i[0][0]&&!this.blocked)o[0][0].set(i[0][0]);else o[0][0].fill(0);this.port.postMessage({type:'boundary',revision:this.rev,blocked:this.blocked});return true;}}registerProcessor('fault-boundary',FaultBoundary);`;
    const faultURL=URL.createObjectURL(new Blob([faultCode],{type:'application/javascript'}));await errorCtx.audioWorklet.addModule(faultURL);URL.revokeObjectURL(faultURL);
    let creations=0;const errorTx=new TransmissionController(errorCtx,async()=>{},async ctx=>new AudioWorkletNode(ctx,creations++===0?'fault-boundary':'gryt-transmission-boundary-v1'));
    const errorSource=errorCtx.createConstantSource();errorSource.offset.value=.125;errorSource.start();errorTx.attach(errorSource);errorTx.setEnabled(true);
    await waitFor(()=>errorTx.state.status==='ready','fault boundary ready');
    errorTx.boundary.port.postMessage({type:'throw'});await waitFor(()=>errorTx.state.status==='failed','genuine processorerror');
    const genuineFailure={...errorTx.state,closed:errorTx.gate.gain.value===0};errorTx.setSuppressed(true);const failureHeldStatus=errorTx.state.status;
    errorTx.setSuppressed(false);await waitFor(()=>errorTx.state.status==='ready','processorerror retry');
    const genuineRecovered=errorTx.gate.gain.value===1;errorSource.stop();errorTx.dispose();await errorCtx.close();
    return {rows,lateOldPeak,lateFreshPeak,oldMarkerPeak,nativeFreshZero,genuineFailure,genuineRecovered,failureHeldStatus};
  });
  for (const row of results.rows) {
    assert(row.baseline > 1e-5 && row.recovered > 1e-5 && row.disabled > 1e-5, JSON.stringify(row));
    for (const field of ['suppressed','repress','userMuted','serverMuted','pttReleased']) assert.equal(row[field],0,JSON.stringify(row));
    assert(row.immediatelyClosed && row.freshCount >= 4,JSON.stringify(row));
    assert.equal(row.requestStatus,'recovering');assert.equal(row.acknowledgedStatus,'suppressed');
  }
  assert.equal(results.lateOldPeak,0); assert.equal(results.lateFreshPeak,.125);
  assert(results.oldMarkerPeak>.01);assert.equal(results.nativeFreshZero,0);
  assert.equal(results.genuineFailure.reason,'transmission-processor-error');assert(results.genuineFailure.closed&&results.genuineRecovered);
  assert.equal(results.failureHeldStatus,'failed');
  const hook = await page.evaluate(async () => {
    const api=await import('/bundle.js');
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const waitFor=async(fn,label)=>{for(let i=0;i<400;i++){if(fn())return;await sleep(20);}throw new Error(label+' timeout '+JSON.stringify(window.mic?.transmissionState));};
    const synth=new AudioContext({sampleRate:48000});await synth.resume();
    const oscillator=synth.createOscillator();oscillator.frequency.value=230;
    const volume=synth.createGain();volume.gain.value=.1;
    const dest=synth.createMediaStreamDestination();oscillator.connect(volume);volume.connect(dest);oscillator.start();
    navigator.mediaDevices.enumerateDevices=async()=>[{kind:'audioinput',deviceId:'synthetic',label:'Synthetic input',groupId:'test'}];
    api.setVoicePlatform({...api.webPlatform,getMicrophone:async()=>dest.stream});
    let config={audio:{deviceId:'synthetic',muted:false,serverMuted:false,deafened:false,serverDeafened:false,outputVolume:100,
      inputMode:'voice_activity',volume:100,loopback:false,noiseSuppression:true,noiseGate:0,noiseGateRelease:200,
      autoGain:{enabled:false,targetDb:-20},compressorEnabled:true,compressorAmount:50,transmitSuppressionEnabled:true},
      camera:{quality:'720p',fps:30,mirrored:false},screen:{quality:'1080p',fps:30,gamingMode:false},connection:{stunHosts:[],eSportsMode:false}};
    function Runner(){return api.registrations.map(r=>r.render());}
    let access=false;
    function Probe(){window.mic=api.useMicrophone(access);return null;}
    const container=document.createElement('div');document.body.append(container);const root=api.createRoot(container);
    const render=()=>root.render(api.createElement(api.VoiceConfigProvider,{config},api.createElement(Runner),api.createElement(Probe)));
    const update=async changes=>{config={...config,audio:{...config.audio,...changes}};render();await sleep(60);};
    render();await sleep(80);access=true;render();await waitFor(()=>window.mic?.transmissionState.status==='ready','hook initial ready');
    await waitFor(()=>!!window.mic?.microphoneBuffer.rnnoiseNode,'RN ready');
    const id=window.mic.microphoneBuffer.publicationStream.id;
    const ctx=window.mic.audioContext;
    const code=`class Record extends AudioWorkletProcessor{constructor(){super();this.n=0;this.a=[];this.port.onmessage=e=>{this.n=e.data;this.a=[];};}process(i,o){o[0][0].fill(0);if(i[0][0]&&this.n){for(const v of i[0][0]){if(!this.n)break;this.a.push(v);this.n--;}if(!this.n)this.port.postMessage(this.a);}return true;}}registerProcessor('hook-record',Record);`;
    const blob=URL.createObjectURL(new Blob([code],{type:'application/javascript'}));await ctx.audioWorklet.addModule(blob);URL.revokeObjectURL(blob);
    const recordNode=new AudioWorkletNode(ctx,'hook-record');
    const published=ctx.createMediaStreamSource(window.mic.microphoneBuffer.publicationStream);published.connect(recordNode);recordNode.connect(ctx.destination);
    const peak=()=>new Promise(resolve=>{recordNode.port.onmessage=e=>resolve(Math.max(...e.data.map(Math.abs)));recordNode.port.postMessage(2048);});
    window.mic.setTransmitSuppressed(true);await sleep(30);const held=await peak();
    await update({muted:true});window.mic.setTransmitSuppressed(false);
    await waitFor(()=>window.mic.transmissionState.status==='ready','hook fresh');const muted=await peak();
    await update({muted:false,inputMode:'push_to_talk'});const pttIdle=await peak();window.mic.setPushToTalkActive(true);await sleep(40);const pttOpen=await peak();
    const oldRnNode=window.mic.microphoneBuffer.rnnoiseNode;oldRnNode.onprocessorerror(new Event('processorerror'));
    await waitFor(()=>window.mic.transmissionState.status==='failed','RN failure visible');await sleep(40);const rnFailurePCM=await peak();
    window.mic.retryTransmission();await waitFor(()=>window.mic.transmissionState.status==='ready','RN recreate retry');
    const rnRetryNodeNew=oldRnNode!==window.mic.microphoneBuffer.rnnoiseNode;
    window.mic.setTransmitSuppressed(true);await update({compressorEnabled:false,noiseSuppression:false});const rebuildHeld=await peak();
    window.mic.setTransmitSuppressed(false);await waitFor(()=>window.mic.transmissionState.status==='ready','hook rebuild fresh');
    const stableId=window.mic.microphoneBuffer.publicationStream.id===id;
    window.mic.microphoneBuffer.captureBarrier.onprocessorerror(new Event('processorerror'));await sleep(30);
    const failedState=window.mic.transmissionState;const failurePCM=await peak();window.mic.retryTransmission();
    await waitFor(()=>window.mic.transmissionState.status==='ready','hook retry');const retryPCM=await peak();
    window.mic.setTransmitSuppressed(true);await update({transmitSuppressionEnabled:false});
    await waitFor(()=>window.mic.transmissionState.status==='disabled','hook safe disable');const disabledPCM=await peak();
    window.mic.setPushToTalkActive(false);await sleep(40);const releasedPCM=await peak();
    root.unmount();published.disconnect();recordNode.disconnect();oscillator.stop();await synth.close();
    return {held,muted,pttIdle,pttOpen,rnFailurePCM,rnRetryNodeNew,rebuildHeld,stableId,failedState,failurePCM,retryPCM,disabledPCM,releasedPCM};
  });
  for(const field of ['held','muted','pttIdle','rnFailurePCM','rebuildHeld','failurePCM','releasedPCM'])assert.equal(hook[field],0,JSON.stringify(hook));
  assert(hook.pttOpen>1e-5&&hook.retryPCM>1e-5&&hook.disabledPCM>1e-5&&hook.stableId&&hook.rnRetryNodeNew,JSON.stringify(hook));
  assert.equal(hook.failedState.status,'failed');
  const evidence={browser:browser.version(),...results,hook,note:'Headless synthetic audio, real RNNoise WASM/Worker and AudioWorklet. No microphone, keyboard or game listening.'};
  writeFileSync('transmission-headless-results.json',JSON.stringify(evidence,null,2)); console.log(JSON.stringify(evidence,null,2));
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
