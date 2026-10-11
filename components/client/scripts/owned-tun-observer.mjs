import { Worker } from 'node:worker_threads';
/** Parent owns only a worker handle, requests and tiny results; bulk observations never run here. */
export function createOwnedObserver(data,{WorkerClass=Worker}={}) {
 const worker=new WorkerClass(new URL('./owned-tun-observer-worker.mjs',import.meta.url),{workerData:data});
 let sequence=0,closed=false;const pending=new Map();
 worker.on('message',row=>{const entry=pending.get(row.id);if(!entry)return;pending.delete(row.id);row.failure?entry.reject(new Error(row.failure)):entry.resolve(row.value);});
 const fail=()=>{for(const p of pending.values())p.reject(new Error('observation-worker-exited'));pending.clear();};
 worker.on('error',fail);worker.on('exit',fail);
 function request(op,args={}){if(closed)return Promise.reject(new Error('observation-worker-closed'));const id=++sequence;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,op,...args});});}
 return {full:args=>request('full',args),light:args=>request('light',args),cancel:()=>{if(!closed)worker.postMessage({op:'cancel'});},
  async close(){if(closed)return;let timer;try{await Promise.race([request('close'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('observer-close-timeout')),6000);})]);}finally{clearTimeout(timer);closed=true;await worker.terminate();fail();}}};
}
