import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import os from 'node:os';
try{os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
const {chromium}=await import(pathToFileURL(resolve(process.argv[2],'playwright/index.mjs')).href);
const server=createServer((q,s)=>s.end('<title>Muted native hard-edge marker</title>'));
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try {
 browser=await chromium.launch({headless:true,args:['--mute-audio']});const page=await browser.newPage();
 await page.goto('http://127.0.0.1:'+server.address().port);
 const rows=await page.evaluate(async()=>{
  const rows=[];
  for(const rate of [44100,48000])for(const optionalCompressor of [false,true])for(const edgeMs of [3,5]) {
   const close=2048,open=Math.ceil((close+rate*edgeMs/1000)/128)*128,length=8192;
   const ctx=new OfflineAudioContext(1,length,rate),source=ctx.createBufferSource();source.buffer=ctx.createBuffer(1,length,rate);
   const input=source.buffer.getChannelData(0);for(let i=close-512;i<close;i++)input[i]=.02*Math.sin(i*Math.PI*2/31);
   let node=source;
   for(let i=0;i<(optionalCompressor?2:1);i++){const comp=ctx.createDynamicsCompressor();comp.threshold.value=i===0&&optionalCompressor?-24:-6;comp.knee.value=0;comp.ratio.value=i===0&&optionalCompressor?6:20;comp.attack.value=.001;comp.release.value=.1;node.connect(comp);node=comp;}
   const trim=ctx.createGain();trim.gain.value=10**(-3.34/20)/4;node.connect(trim);
   const clip=ctx.createWaveShaper(),curve=new Float32Array(4096),ceiling=10**(-1/20);for(let i=0;i<curve.length;i++){const x=(i/(curve.length-1)*2-1)*4;curve[i]=ceiling*Math.tanh(x/ceiling);}clip.curve=curve;clip.oversample='4x';trim.connect(clip);clip.connect(ctx.destination);source.start();
   const output=(await ctx.startRendering()).getChannelData(0);let peakAfterReopen=0,lastMarker=-1;
   for(let i=open;i<output.length;i++)if(Math.abs(output[i])>1e-7){peakAfterReopen=Math.max(peakAfterReopen,Math.abs(output[i]));lastMarker=i;}
   rows.push({rate,optionalCompressor,requestedClosedMs:edgeMs,closeSample:close,openSample:open,actualClosedMs:(open-close)/rate*1000,peakAtModelInputAfterReopen:peakAfterReopen,lastOldMarkerSample:lastMarker,
    inputAfterCloseExactlyZero:input.subarray(close).every(x=>x===0)});
  }return rows;
 });
 const result={browser:browser.version(),rows,note:'True offline native compressor/4x oversampler marker at model input. The source is exactly zero after close; existing native history survives a short hard gate. Not a portable native delay or a full hook freshness proof.'};
 writeFileSync('send-native-hard-edge-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
