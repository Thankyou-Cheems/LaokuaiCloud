import {createServer} from 'node:http';import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';import os from 'node:os';
try{os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
const {RECEIVE_WORKLET_CODE}=await import('../dist/audio/processors/receiveProcessor.js');
const diagnostic=RECEIVE_WORKLET_CODE.replace('const opts = options.processorOptions;',
  'const opts = options.processorOptions; this.diagnosticTimes=new Float64Array(4096);this.diagnosticAt=0;')
  .replace('const data = event.data;',`const data = event.data;
  if(data?.kind==='performance'){const n=Math.min(this.diagnosticAt,this.diagnosticTimes.length);
    this.port.postMessage({kind:'performance',times:Array.from(this.diagnosticTimes.subarray(0,n)),
      frames:this.diagnosticAt,heap:runtime?.memory.buffer.byteLength??null,liveHandles:runtime?.gryt_live_states()??null,
      processingAllocations:diagnosticAlloc,processingFrees:diagnosticFree});return;}`)
  .replace('registerProcessor(',`let diagnosticFrame=-1,diagnosticStart=0,diagnosticAlloc=0,diagnosticFree=0;
  const diagnosticOriginalProcess=ReceiveProcessor.prototype.process;
  ReceiveProcessor.prototype.process=function(inputs,outputs,parameters){
    const a=runtime?.gryt_allocation_calls()??0,f=runtime?.gryt_free_calls()??0;
    if(diagnosticFrame!==currentFrame){diagnosticFrame=currentFrame;diagnosticStart=Date.now();}
    const result=diagnosticOriginalProcess.call(this,inputs,outputs,parameters);
    if(this.kind==='limiter'&&this.routeKey===undefined){if(this.diagnosticAt<this.diagnosticTimes.length)
      this.diagnosticTimes[this.diagnosticAt]=Date.now()-diagnosticStart;++this.diagnosticAt;}
    diagnosticAlloc+=(runtime?.gryt_allocation_calls()??0)-a;diagnosticFree+=(runtime?.gryt_free_calls()??0)-f;
    return result;};registerProcessor(`);
const processBytes=RECEIVE_WORKLET_CODE.slice(RECEIVE_WORKLET_CODE.indexOf('  process(inputs, outputs, parameters) {'),RECEIVE_WORKLET_CODE.indexOf('\nregisterProcessor('));
if(!diagnostic.includes(processBytes))throw Error('Production process bytes changed by diagnostics');
const root=resolve('dist'),server=createServer((req,res)=>{
  if(req.url==='/'){res.end('<title>Muted receive performance probe</title>');return;}
  if(req.url==='/diagnostic'){res.setHeader('content-type','text/javascript');res.end(diagnostic);return;}
  if(req.url==='/fixture'){res.end(readFileSync('third-party/receive-rnn/fixtures/samples.pcm'));return;}
  const file=resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  try{res.setHeader('content-type','text/javascript');res.end(readFileSync(file));}catch{res.writeHead(404).end();}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])).href);let browser;
try{browser=await chromium.launch({headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage();await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=()=>{throw Error('Physical microphone forbidden');};
    navigator.mediaDevices.getDisplayMedia=()=>{throw Error('Physical screen forbidden');};});await page.goto(origin);
  const cases=await page.evaluate(async()=>{
    const {ReceiveController}=await import('/audio/lib/receiveGraph.js'),raw=new Int16Array(await(await fetch('/fixture')).arrayBuffer());
    const wait=ms=>new Promise(r=>setTimeout(r,ms)),cases=[];
    for(const count of[1,4]){
      const ctx=new AudioContext({sampleRate:48000});await ctx.suspend();const realAdd=ctx.audioWorklet.addModule.bind(ctx.audioWorklet);
      ctx.audioWorklet.addModule=()=>realAdd('/diagnostic');const owner=new ReceiveController(ctx,true),sources=[];
      for(let i=0;i<count;i++){const source=ctx.createBufferSource();source.buffer=ctx.createBuffer(1,raw.length,48000);
        const samples=source.buffer.getChannelData(0);for(let k=0;k<samples.length;k++)samples[k]=raw[(k+i*4800)%raw.length]/32768*.1;
        source.loop=true;const gain=ctx.createGain();gain.gain.value=2;const route=owner.attach(source,gain);
        route.setRole('microphone');route.setIdentity({participantId:'p'+i,receiverId:'r'+i,trackId:'t'+i,generation:1});sources.push(source);
      }
      owner.bus.gain.value=2;while(owner.loading)await wait(1);if(!owner.busLimiter)throw Error('Graph load failed');
      for(const source of sources)source.start();await ctx.resume();await wait(3000);
      const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Diagnostic timeout')),5000);
        const listen=e=>{if(e.data.kind==='performance'){clearTimeout(timer);owner.busLimiter.port.removeEventListener('message',listen);resolve(e.data);}};
        owner.busLimiter.port.addEventListener('message',listen);owner.busLimiter.port.start();owner.busLimiter.port.postMessage({kind:'performance'});});
      const snapshots=owner.autoBatch.snapshots.map(s=>({accepted:s.acceptedSpeechSeconds,status:s.status}));
      await ctx.suspend();for(const source of sources)source.stop();owner.dispose();await ctx.close();
      const sorted=result.times.slice().sort((a,b)=>a-b);cases.push({count,...result,p50:sorted[Math.floor(sorted.length*.5)],
        p95:sorted[Math.floor(sorted.length*.95)],p99:sorted[Math.floor(sorted.length*.99)],max:sorted.at(-1),snapshots});
    }return cases;
  });
  const result={browser:browser.version(),environment:{cpu:os.cpus()[0]?.model,os:os.type()+' '+os.release(),node:process.version,hostPriority:os.getPriority(0)},
    sourceWorkletSha256:createHash('sha256').update(RECEIVE_WORKLET_CODE).digest('hex'),
    diagnosticSha256:createHash('sha256').update(diagnostic).digest('hex'),processMethodBytesPreserved:true,cases,
    scope:'Sequential 1/4-route real-time muted synthetic graphs. Date.now has 1ms resolution. Span begins first DSP callback and ends bus limiter, excludes later native/device/WebRTC scheduling and module initialization. Diagnostic overhead included. No hardware underrun counter or real game-load observation; no deadline/inaudibility certification. Constructor diagnostic arrays are32KiB/node; production does not allocate them.'};
  if(cases.some(c=>c.processingAllocations!==0||c.processingFrees!==0||c.heap!==16777216||c.liveHandles!==c.count))throw Error('Lifetime/allocation invariant failed');
  writeFileSync(process.env.RECEIVE_RESULTS??'receive-prior-performance.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({...result,cases:cases.map(({times,...c})=>c)},null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
