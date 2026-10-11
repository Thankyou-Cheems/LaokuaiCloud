import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import os from 'node:os';
try{os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
const {chromium}=await import(pathToFileURL('C:/Users/cheb2/Documents/Codex/2026-10-10/task-2/gryt-client-work/node_modules/playwright/index.mjs').href);
const server=createServer((q,s)=>s.end('<title>Muted offline DSP delay evidence</title>'));
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,args:['--mute-audio']});const page=await browser.newPage();
 await page.goto('http://127.0.0.1:'+server.address().port);
 const rows=await page.evaluate(async()=>{
  const rows=[];
  for(const rate of [44100,48000])for(const compressors of [0,1,2])for(const oversample of ['none','4x'])for(const amplitude of [.0001,.05]){
   const ctx=new OfflineAudioContext(1,rate/2,rate),source=ctx.createBufferSource();
   source.buffer=ctx.createBuffer(1,rate/2,rate);source.buffer.getChannelData(0)[2048]=amplitude;let node=source;
   for(let c=0;c<compressors;c++){const comp=ctx.createDynamicsCompressor();comp.threshold.value=-6;comp.knee.value=0;comp.ratio.value=20;comp.attack.value=.001;comp.release.value=.1;node.connect(comp);node=comp;}
   const wave=ctx.createWaveShaper(),curve=new Float32Array(4097);for(let i=0;i<curve.length;i++){const x=(i/(curve.length-1)*2-1)*4;curve[i]=.89125094*Math.tanh(x/.89125094);}
   const gain=ctx.createGain();gain.gain.value=.25;node.connect(gain);gain.connect(wave);wave.curve=curve;wave.oversample=oversample;wave.connect(ctx.destination);source.start();
   const output=(await ctx.startRendering()).getChannelData(0);let peak=0,at=0,first=-1,last=-1;
   for(let i=0;i<output.length;i++){const a=Math.abs(output[i]);if(a>1e-8){if(first<0)first=i;last=i;}if(a>peak){peak=a;at=i;}}
   rows.push({rate,compressors,oversample,amplitude,peakDelaySamples:at-2048,firstDelaySamples:first-2048,lastDelaySamples:last-2048});
  }return rows;
 });const result={browser:browser.version(),rows,note:'OfflineAudioContext synthetic impulses, no device capture and --mute-audio. One browser implementation; not a portable delay contract.'};writeFileSync('native-dsp-delay-probe-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
