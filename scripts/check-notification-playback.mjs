import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const dataUrl = text => 'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const root = new URL('../src/packages/lib/',import.meta.url);
const deps = {};
for (const name of ['audioVolume','outputDevice']) deps[name]=dataUrl(stripTypeScriptTypes(readFileSync(new URL(name+'.ts',root),'utf8')));
let text = stripTypeScriptTypes(readFileSync(new URL('notificationSound.ts',root),'utf8'));
for (const name of Object.keys(deps)) text=text.replaceAll('"./'+name+'"',JSON.stringify(deps[name]));
const log=[]; let resume; let decoding;
class Context {
 state='suspended';destination={};
 resume(){log.push('resume');return new Promise(resolve=>{resume=()=>{this.state='running';resolve();};});}
 setSinkId(id){log.push(['sink',id]);return Promise.resolve();}
 decodeAudioData(){return new Promise(resolve=>{decoding=()=>resolve({});});}
 createGain(){return {gain:{value:0},connect(){},disconnect(){log.push('gain-disconnect');}};}
 createBufferSource(){return {connect(){},disconnect(){},start(){log.push('start');this.onended?.();},stop(){log.push('stop');this.onended?.();}};}
}
globalThis.AudioContext=Context;
globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)});
const api=await import(dataUrl(text));
const spin=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
api.setNotificationOutputDevice('headphones');
const first=api.playNotificationSound('fixture-a',30);
assert.equal(typeof first?.stop,'function','playback exposes cancellation');
await spin(); assert.equal(log.includes('start'),false,'suspended context never starts a cue');
resume();await spin();decoding();await spin();
assert.equal(await first.finished,true);assert.equal(log.filter(x=>x==='start').length,1);
assert.ok(log.some(x=>Array.isArray(x)&&x[1]==='headphones'));
const canceled=api.playNotificationSound('fixture-b',30);await spin();canceled.stop();decoding();await spin();
assert.equal(await canceled.finished,false);assert.equal(log.filter(x=>x==='start').length,1);
let current=true;const stale=api.playNotificationSound('fixture-c',30,{shouldPlay:()=>current});await spin();current=false;decoding();await spin();
assert.equal(await stale.finished,false);assert.equal(log.filter(x=>x==='start').length,1);
const zero=api.playNotificationSound('fixture-d',0);assert.equal(await zero.finished,false);
const pending=api.playNotificationSound('fixture-e',30);await spin();api.setNotificationOutputDevice('new-headphones');decoding();await spin();
assert.equal(await pending.finished,false);assert.equal(log.filter(x=>x==='start').length,1);
console.log('6 notification playback lifecycle/routing mock checks passed');
