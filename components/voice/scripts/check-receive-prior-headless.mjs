import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import os from 'node:os';
try { os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])).href),root=resolve('dist');
const original=readFileSync('dist/audio/processors/receiveProcessor.js'),sourceHash=createHash('sha256').update(original).digest('hex');
const server=createServer((req,res)=>{
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  if(req.url==='/'){res.end('<title>Synthetic receive prior and protection validation</title>');return;}
  if(req.url==='/fixture'){res.end(readFileSync('third-party/receive-rnn/fixtures/samples.pcm'));return;}
  const file=resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  try{res.setHeader('content-type','text/javascript');res.end(readFileSync(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;let browser;
try{
  browser=await chromium.launch({headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage();await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=()=>{throw Error('Real microphone forbidden');};
    navigator.mediaDevices.getDisplayMedia=()=>{throw Error('Display capture forbidden');};});
  await page.goto(origin);
  const result=await page.evaluate(async()=>{
    const {RECEIVE_WORKLET_CODE,RECEIVE_PROCESSOR_NAME}=await import('/audio/processors/receiveProcessor.js');
    const {ReceiveLimiter}=await import('/audio/processors/receiveLevelingCore.js');
    const {ReceiveController}=await import('/audio/lib/receiveGraph.js');
    const wait=ms=>new Promise(r=>setTimeout(r,ms)),cases=[];
    for(const rate of[44100,48000])for(const [count,manual,master]of[[1,0,2],[1,1,1],[1,2,.25],[4,2,2]]){
      const length=rate,ctx=new OfflineAudioContext(1,length,rate);
      const blob=URL.createObjectURL(new Blob([RECEIVE_WORKLET_CODE],{type:'text/javascript'}));
      await ctx.audioWorklet.addModule(blob);URL.revokeObjectURL(blob);
      const bus=new AudioWorkletNode(ctx,RECEIVE_PROCESSOR_NAME,{numberOfInputs:1,numberOfOutputs:1,
        outputChannelCount:[1],channelCount:1,parameterData:{enabled:1},processorOptions:{kind:'limiter'}});
      const masterNode=ctx.createGain();masterNode.gain.value=master;masterNode.connect(bus);bus.connect(ctx.destination);
      const signal=new Float32Array(length);
      for(let i=0;i<length;i++)signal[i]=Math.SQRT2*10**((i<rate*.2||i>=rate*.5?-20:10)/20)*Math.sin(2*Math.PI*400*i/rate);
      const nodes=[];
      for(let i=0;i<count;i++){
        const source=ctx.createBufferSource();source.buffer=ctx.createBuffer(1,length,rate);source.buffer.copyToChannel(signal,0);
        const gain=ctx.createGain();gain.gain.value=manual;
        const route=new AudioWorkletNode(ctx,RECEIVE_PROCESSOR_NAME,{numberOfInputs:1,numberOfOutputs:1,
          outputChannelCount:[1],channelCount:1,parameterData:{enabled:1,fastProtection:1},processorOptions:{kind:'limiter',routeKey:i+1}});
        source.connect(gain);gain.connect(route);route.connect(masterNode);source.start();nodes.push(route);
      }
      const rendered=await ctx.startRendering(),actual=rendered.getChannelData(0);
      const route=new ReceiveLimiter(rate),limiter=new ReceiveLimiter(rate),expected=new Float32Array(length);
      for(let at=0;at<length;at+=128){const n=Math.min(128,length-at),input=new Float32Array(n),a=new Float32Array(n),b=new Float32Array(n);
        for(let i=0;i<n;i++)input[i]=signal[at+i]*manual;
        route.process([input],[a],true,true);for(let i=0;i<n;i++)a[i]*=count*master;
        limiter.process([a],[b],true);expected.set(b,at);
      }
      let error=0,peak=0,finite=true;
      for(let i=0;i<length;i++){error=Math.max(error,Math.abs(actual[i]-expected[i]));peak=Math.max(peak,Math.abs(actual[i]));finite&&=Number.isFinite(actual[i]);}
      cases.push({rate,count,manual,master,maxError:error,peak,finite,latencySamples:route.latencySamples+limiter.latencySamples});
      for(const node of [...nodes,bus]){node.port.postMessage('dispose');node.port.close();node.disconnect();}
    }
    // The exact production graph, identity/prior controls and real shared WASM handle, not a fake processor.
    const rate=48000,length=rate*14,ctx=new OfflineAudioContext(1,length,rate),raw=new Int16Array(await(await fetch('/fixture')).arrayBuffer());
    const owner=new ReceiveController(ctx,true),source=ctx.createBufferSource(),manual=ctx.createGain();
    source.buffer=ctx.createBuffer(1,length,rate);const data=source.buffer.getChannelData(0);
    for(let i=0;i<length;i++)data[i]=raw[i%raw.length]/32768*.1;
    const route=owner.attach(source,manual),id={participantId:'synthetic-person',receiverId:'physical',trackId:'track',generation:1};
    route.setIdentity(id);route.setRole('microphone');owner.bus.gain.value=.25;
    const prior={schemaVersion:1,processorSchema:'gryt-receive-level-v2',learnedGainDb:18,speechLevelDbfs:-48,
      effectiveSpeechSeconds:30,lastVerifiedUnixMs:1000};
    const queued=route.setPrior(prior,id),staleRejected=!route.setPrior(prior,{...id,generation:0});
    while(owner.loading)await wait(1);if(!owner.busLimiter)throw Error('Production graph unavailable');
    const request=()=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('snapshot timeout')),5000);
      const listen=e=>{if(e.data.kind==='receive-auto-levels'){clearTimeout(t);owner.busLimiter.port.removeEventListener('message',listen);resolve(e.data);}};
      owner.busLimiter.port.addEventListener('message',listen);owner.busLimiter.port.start();owner.busLimiter.port.postMessage({kind:'snapshot'});});
    const earlyPause=ctx.suspend(1.5),latePause=ctx.suspend(12);source.start();const rendering=ctx.startRendering();
    await earlyPause;const early=await request();await ctx.resume();await latePause;const late=await request();
    const manualBefore=manual.gain.value;owner.bus.gain.value=.1;const manualAfter=manual.gain.value;
    route.setIdentity({...id,trackId:'replacement',generation:2});const oldPriorRejected=!route.setPrior(prior,id);
    const lifecycleClear=owner.autoBatch.snapshots[0];await ctx.resume();const rendered=await rendering;
    let peak=0,finite=true;for(const x of rendered.getChannelData(0)){peak=Math.max(peak,Math.abs(x));finite&&=Number.isFinite(x);}
    owner.dispose();return{cases,actualGraph:{queued,staleRejected,early,late,manualBefore,manualAfter,oldPriorRejected,
      lifecycleClear,peak,finite,remainingRoutes:owner.chains.size,disposed:owner.disposed},realMicrophone:false};
  });
  for(const row of result.cases){assert.ok(row.maxError<2e-6,JSON.stringify(row));assert.ok(row.finite);assert.ok(row.peak<=10**(-3/20)+1e-7);if(row.manual===0)assert.equal(row.peak,0);}
  const graph=result.actualGraph;assert.ok(graph.queued&&graph.staleRejected&&graph.oldPriorRejected&&graph.finite&&graph.disposed);
  assert.equal(graph.manualBefore,1);assert.equal(graph.manualAfter,1);assert.equal(graph.remainingRoutes,0);
  const early=graph.early.snapshots[0],late=graph.late.snapshots[0];
  assert.ok(early.acceptedSpeechSeconds>0);assert.ok(early.acceptedSpeechSeconds<5);assert.equal(early.estimatorReliability,'provisional');
  assert.ok(early.appliedAutoGainDb<=3.8);assert.equal(early.learnedAutoGainDb,18);assert.equal(early.priorRestoring,true);
  assert.ok(late.acceptedSpeechSeconds>early.acceptedSpeechSeconds);assert.ok(late.lastAcceptedSpeechAudioTimeSeconds!==null);
  assert.equal(graph.lifecycleClear.appliedAutoGainDb,null);assert.equal(graph.lifecycleClear.generation,2);
  const evidence={status:'passed',browser:browser.version(),sourceHash,...result,
    scope:'Muted headless Chromium actual AudioWorklet, 8 known normalized protection parity cases and actual production RNN/prior graph. Offline rendering is not hardware timing or call-experience validation.'};
  const path=process.env.RECEIVE_RESULTS??'receive-prior-headless-results.json';writeFileSync(path,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence,null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
