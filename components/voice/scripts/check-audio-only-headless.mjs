import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import os from 'node:os';
try{os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])).href),root=resolve('dist');
const server=createServer((req,res)=>{
  if(req.url==='/'){res.end('<title>Synthetic audio-only SDP validation</title>');return;}
  const file=resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(req.method!=='GET'||!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  try{res.setHeader('content-type','text/javascript');res.end(readFileSync(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;let browser;
try{
  browser=await chromium.launch({headless:true,args:['--mute-audio']});
  const page=await browser.newPage();
  await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await page.addInitScript(()=>{
    navigator.mediaDevices.getUserMedia=()=>{throw Error('Real capture forbidden');};
    navigator.mediaDevices.getDisplayMedia=()=>{throw Error('Real capture forbidden');};
  });
  await page.goto(origin);
  const cases=await page.evaluate(async()=>{
    const {restrictMediaSdp,applyPeerMediaPolicy}=await import('/shared/mediaPolicy.js');
    const ctx=new AudioContext(),mic=ctx.createMediaStreamDestination(),screen=ctx.createMediaStreamDestination();
    const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;
    canvas.getContext('2d').fillRect(0,0,2,2);const video=canvas.captureStream(0);
    const sender=new RTCPeerConnection({iceServers:[]}),receivers=[];
    const micSender=sender.addTrack(mic.stream.getAudioTracks()[0],mic.stream);
    sender.addTrack(screen.stream.getAudioTracks()[0],screen.stream);sender.addTrack(video.getVideoTracks()[0],video);
    for(const transceiver of sender.getTransceivers())transceiver.direction='sendonly';
    const results=[];
    const negotiate=async(name,allowlist,rewrite=false)=>{
      const offer=await sender.createOffer();
      const original=rewrite?offer.sdp.replaceAll(mic.stream.id,'rewritten-microphone'):offer.sdp;
      const policy={mediaMode:'audio-only',receiveMicrophoneStreamIds:allowlist};
      const receiver=new RTCPeerConnection({iceServers:[]});receivers.push(receiver);
      await receiver.setRemoteDescription({type:'offer',sdp:restrictMediaSdp(original,policy,'remote')});
      applyPeerMediaPolicy(receiver,policy,[],original);
      const answer=await receiver.createAnswer();
      const restricted=restrictMediaSdp(answer.sdp,policy,'local',original);
      await receiver.setLocalDescription({type:'answer',sdp:restricted});
      await sender.setLocalDescription(offer);
      await sender.setRemoteDescription({type:'answer',sdp:restricted});
      const sections=restricted.split(/\r?\nm=/).slice(1).map(s=>({
        kind:s.split(' ')[0],mid:/a=mid:(\S+)/.exec(s)[1],direction:/a=(sendrecv|recvonly|sendonly|inactive)\b/.exec(s)[1]
      }));
      results.push({name,sections,receiverDirections:receiver.getTransceivers().map(t=>t.currentDirection),
        signalingState:sender.signalingState,receiverState:receiver.signalingState});
    };
    try{
      await negotiate('trusted-microphone-only',[mic.stream.id]);
      const unknown=ctx.createMediaStreamDestination();sender.addTrack(unknown.stream.getAudioTracks()[0],unknown.stream);
      sender.getTransceivers().at(-1).direction='sendonly';
      await negotiate('renegotiation-unknown-denied',[mic.stream.id]);
      await negotiate('revoked-allowlist',[]);
      await negotiate('rewritten-stream-id-denied',[mic.stream.id],true);
      unknown.stream.getTracks().forEach(t=>t.stop());
      return results;
    }finally{
      sender.close();receivers.forEach(pc=>pc.close());
      for(const stream of[mic.stream,screen.stream,video])stream.getTracks().forEach(t=>t.stop());
      await ctx.close();
    }
  });
  for(const [i,c]of cases.entries()){
    assert.equal(c.signalingState,'stable');assert.equal(c.receiverState,'stable');
    assert.equal(c.sections.filter(s=>s.direction==='recvonly').length,i<2?1:0);
    assert.ok(c.sections.filter(s=>s.kind==='video').every(s=>s.direction==='inactive'));
    assert.ok(c.receiverDirections.every(d=>d==='recvonly'||d==='inactive'));
  }
  const result={browser:browser.version(),cases,scope:'Actual Chromium SDP acceptance; synthetic tracks only. No real SFU, ICE connectivity or bandwidth claim.'};
  if(process.env.AUDIO_ONLY_HEADLESS_RESULTS)writeFileSync(process.env.AUDIO_ONLY_HEADLESS_RESULTS,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
