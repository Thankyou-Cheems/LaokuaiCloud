import assert from 'node:assert/strict';
import { CaptureLease, restrictMediaSdp, microphoneReceiveAllowed, applyPeerMediaPolicy, canonicalMediaPolicy } from '../dist/shared/mediaPolicy.js';

const policy = { mediaMode: 'audio-only', receiveMicrophoneStreamIds: ['trusted-mic'] };
assert.deepEqual(canonicalMediaPolicy({}),canonicalMediaPolicy({mediaMode:'full',receiveMicrophoneStreamIds:['irrelevant']}));
assert.deepEqual(canonicalMediaPolicy({mediaMode:'audio-only',receiveMicrophoneStreamIds:['b','a','b']}),
  canonicalMediaPolicy({mediaMode:'audio-only',receiveMicrophoneStreamIds:['a','b']}));
assert.deepEqual(canonicalMediaPolicy({mediaMode:'audio-only'}),canonicalMediaPolicy({mediaMode:'audio-only',receiveMicrophoneStreamIds:[]}));
const section = (kind, mid, direction, stream) => [`m=${kind} 9 UDP/TLS/RTP/SAVPF 96`, `a=mid:${mid}`, ...(direction ? [`a=${direction}`] : []), ...(stream ? [`a=msid:${stream} track-${mid}`] : [])].join('\r\n');
const offer = 'v=0\r\na=group:BUNDLE 0 1 2 3 4 5\r\n' + [section('audio','0','recvonly'), section('audio','1','sendrecv','trusted-mic'), section('audio','2','sendonly','screen-audio'), section('video','3','sendonly','camera'), section('video','4','sendrecv','screen'), section('audio','5','sendonly')].join('\r\n') + '\r\n';
const directions = sdp => Object.fromEntries(sdp.split(/\r?\nm=/).slice(1).map(s => [/a=mid:(\S+)/.exec(s)[1], /a=(sendrecv|recvonly|sendonly|inactive)\b/.exec(s)[1]]));
assert.equal(restrictMediaSdp(offer, {}, 'remote'), offer, 'omitted mode preserves SDP byte for byte');
const remote = restrictMediaSdp(offer, policy, 'remote');
assert.deepEqual(directions(remote), {'0':'recvonly','1':'sendrecv','2':'inactive','3':'inactive','4':'inactive','5':'inactive'});
assert.ok(remote.includes('a=group:BUNDLE 0 1 2 3 4 5'), 'bundle/mids preserved');
assert.equal(microphoneReceiveAllowed(offer,'1',policy),true);
assert.equal(microphoneReceiveAllowed(offer,'2',policy),false);
assert.equal(microphoneReceiveAllowed(offer,'5',policy),false);
assert.equal(microphoneReceiveAllowed(offer,null,policy),false);
assert.equal(microphoneReceiveAllowed(offer,'1',{mediaMode:'audio-only'}),false);
const mixed = 'v=0\r\n'+section('audio','x','sendrecv','trusted-mic')+'\r\na=ssrc:12 msid:screen-audio track-screen\r\n';
assert.equal(microphoneReceiveAllowed(mixed,'x',policy),false,'mixed mic/screen section fails closed');
const inherited = 'v=0\na=sendonly\n'+section('video','v',null,'cam').replaceAll('\r\n','\n')+'\n';
assert.equal(directions(restrictMediaSdp(inherited,policy,'remote')).v,'inactive');
const answer = 'v=0\r\n'+[section('audio','0','sendonly','local-mic'),section('audio','1','recvonly'),section('audio','2','recvonly'),section('video','3','recvonly'),section('video','4','sendrecv')].join('\r\n')+'\r\n';
assert.deepEqual(directions(restrictMediaSdp(answer,policy,'local',offer)),{'0':'sendonly','1':'recvonly','2':'inactive','3':'inactive','4':'inactive'});

const track = kind => ({kind,enabled:true,stopped:0,stop(){++this.stopped;}});
const sender = kind => ({track:track(kind),replacements:[],async replaceTrack(t){this.replacements.push(t);this.track=t;}});
const mic=sender('audio'),screenAudio=sender('audio'),camera=sender('video');
const transceivers=[{mid:'0',sender:mic,receiver:{track:track('audio')}},{mid:'1',sender:sender('audio'),receiver:{track:track('audio')}},{mid:'2',sender:screenAudio,receiver:{track:track('audio')}},{mid:'3',sender:camera,receiver:{track:track('video')}}];
const pc={remoteDescription:{sdp:offer},getTransceivers:()=>transceivers,close(){this.closed=true;}};
applyPeerMediaPolicy(pc,policy,[mic]);
assert.deepEqual(transceivers.map(t=>t.direction),['sendonly','recvonly','inactive','inactive']);
assert.equal(mic.track.stopped,0);assert.equal(screenAudio.track,null);assert.equal(camera.track,null);
assert.equal(transceivers[2].receiver.track.enabled,false);

const lease=new CaptureLease();let calls=0;
lease.setMode(policy);assert.equal(await lease.capture(async()=>{++calls;return {getTracks:()=>[]};}),null);assert.equal(calls,0);
lease.setMode({});let resolve;const lateTrack=track('video');
const pending=lease.capture(()=>new Promise(r=>{++calls;resolve=r;}));
lease.setMode(policy);lease.setMode({});resolve({getTracks:()=>[lateTrack]});
assert.equal(await pending,null);assert.equal(lateTrack.stopped,1,'mode round trip invalidates late capture');
const token=lease.begin();lease.invalidate();assert.equal(lease.valid(token),false);
console.log('media policy: SDP directions, strict msid allowlist, local mic, forbidden senders, late capture leases passed');
