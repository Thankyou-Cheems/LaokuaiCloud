/* eslint-env node */
// Actual-source tests with fake dgram/net/child_process. No bind, listen, WMI,
// Electron, ET or real profile. Only synthetic temporary ledger files are real.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const require=createRequire(import.meta.url),ts=require('typescript');
const denied=()=>{throw Error('real-network-or-native-forbidden');};
let network,execReply;
class FakeUdp extends EventEmitter {
  constructor(){super();this.bound=false;this.sent=[];this.closed=0;}
  bind(port,address,callback){
    this.bindArgs={port,address};this.complete=()=>{this.bound=true;callback();};
    if(network.failUdp)queueMicrotask(()=>this.emit('error',Error('fake-udp-bind')));
    else if(!network.holdUdp)queueMicrotask(this.complete);
  }
  address(){if(!this.bound)throw Error('not-bound');return{address:this.bindArgs.address,port:this.bindArgs.port||15353};}
  send(buffer,port,address,callback){this.sent.push({buffer,port,address});callback();}
  close(callback){if(!this.bound)throw Error('not-bound');this.bound=false;this.closed++;queueMicrotask(()=>{this.emit('close');callback();});}
}
class FakeTcp extends EventEmitter {
  constructor(){super();this.bound=false;this.closed=0;}
  listen(port,address,callback){
    this.listenArgs={port,address};this.complete=()=>{this.bound=true;callback();};
    if(network.failTcp)queueMicrotask(()=>this.emit('error',Error('fake-tcp-listen')));
    else if(!network.holdTcp)queueMicrotask(this.complete);
  }
  close(callback){if(!this.bound)throw Error('not-bound');this.bound=false;this.closed++;queueMicrotask(()=>{this.emit('close');callback();});}
}
class FakeClient extends EventEmitter {
  constructor(address='127.0.0.1'){super();this.remoteAddress=address;this.destroyed=false;this.output=null;}
  setTimeout(ms,callback){this.timeout={ms,callback};}
  destroy(){if(!this.destroyed){this.destroyed=true;this.emit('close');}}
  end(output){this.output=output;queueMicrotask(()=>this.emit('close'));}
}
const resetNetwork=(change={})=>network={allowed:false,udp:[],tcp:[],...change};
resetNetwork();
const mocked={
  'node:dgram':{createSocket(){if(!network.allowed)return denied();const socket=new FakeUdp();network.udp.push(socket);return socket;}},
  'node:net':{createServer(){if(!network.allowed)return denied();if(network.failCreateTcp)throw Error('fake-create-tcp');const server=new FakeTcp();network.tcp.push(server);return server;}},
  'node:child_process':{execFile(helper,args,options,callback){
    if(!execReply)return denied();execReply.calls.push({helper,args,options});
    queueMicrotask(()=>callback(execReply.error??null,execReply.out));
    return{stdin:{on(){},end(value){execReply.input=value;}}};
  }},
};
const cache=new Map();
function load(file){
  const url=new URL(file,import.meta.url);if(cache.has(url.href))return cache.get(url.href);
  const mod={exports:{}};cache.set(url.href,mod.exports);
  const compiled=ts.transpileModule(fs.readFileSync(url,'utf8'),{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  assert.deepEqual(compiled.diagnostics.filter(item=>item.category===ts.DiagnosticCategory.Error),[]);
  const local=name=>{
    if(Object.hasOwn(mocked,name))return mocked[name];
    if(['node:fs','node:path','node:crypto'].includes(name))return require(name);
    assert.ok(name.startsWith('./') || name === '../src/lib/communityDnsNames',`unreviewed dependency ${name}`);return load(name+'.ts');
  };
  vm.runInThisContext('(function(require,module,exports){'+compiled.outputText+'\n})',{filename:url.pathname})(local,mod,mod.exports);
  return mod.exports;
}
const {CommunityDnsRecords,CommunityDnsListener,parseCommunityDnsDirectory,COMMUNITY_DNS_ADDRESS}=load('./communityDnsResolver.ts');
const {CommunityDnsPolicy,invokeDnsPolicy}=load('./communityDnsPolicy.ts');
const {communityDnsZone,communityDnsNameZone,communityDnsDisplayName}=load('../src/lib/communityDnsNames.ts');
const WALL=1_800_000_000_000,ZONE=`c-${'a'.repeat(32)}.lan.voice.ruikang.wang.`,ZONE_B=`c-${'b'.repeat(32)}.lan.voice.ruikang.wang.`;
const directory=(scope='community',zone=ZONE,change={})=>({v:1,communityId:scope,dns:{zone,serverTimeMs:WALL,maxAgeMs:10000},
  members:[{serverUserId:'member',virtualIp:'10.77.0.2',dnsName:`d-${'1'.repeat(32)}.${zone}`,dnsExpiresAtMs:WALL+10000}],...change});
const clone=value=>structuredClone(value);
test('shared DNS grammar accepts only canonical legacy and friendly label/zone pairs',()=>{
  for(const zone of ['lk.internal.','lk-0123abcd.internal.']) {
    assert.equal(communityDnsZone(zone),true);
    for(const label of ['shizi-12','yunbao-123','abcdefghijkl-999']) {
      const name=label+'.'+zone;
      assert.equal(communityDnsNameZone(name),zone);
      assert.equal(communityDnsDisplayName(name),name.slice(0,-1));
    }
  }
  assert.equal(communityDnsNameZone(`d-${'1'.repeat(32)}.${ZONE}`),ZONE);
  for(const name of ['ab-12.lk.internal.','abcdefghijklm-12.lk.internal.','shizi-1.lk.internal.',
    'shizi-1234.lk.internal.','Shizi-12.lk.internal.','shizi-12.lk-0123ABCD.internal.',
    'shizi-12.lk-1234567.internal.','shizi-12.lk-123456789.internal.','shizi-12.lk.other.internal.',
    'shizi-12.lk.internal','shizi-12.lk.internal.\n','shizi-12.lk.internal..','shizi-12.evil.lk.internal.',
    `shizi-12.${ZONE}`,`d-${'1'.repeat(32)}.lk.internal.`,null,{},123]) {
    assert.equal(communityDnsNameZone(name),null,String(name));
  }
  assert.equal(communityDnsZone('lk.internal.\n'),false);
  assert.equal(communityDnsDisplayName('claimed.example.'),'');
});
function query(name,kind=1,klass=1){
  const labels=name.replace(/\.$/,'').split('.').flatMap(label=>[Buffer.from([label.length]),Buffer.from(label)]);
  const header=Buffer.alloc(12);header.writeUInt16BE(0x1234);header.writeUInt16BE(0x0100,2);header.writeUInt16BE(1,4);
  const end=Buffer.alloc(5);end.writeUInt16BE(kind,1);end.writeUInt16BE(klass,3);return Buffer.concat([header,...labels,end]);
}
const rcode=packet=>packet.readUInt16BE(2)&15;
const answers=packet=>packet.readUInt16BE(6);
const ttl=packet=>packet.readUInt32BE(packet.length-10);
function recordsFixture(){
  const now={mono:1000,wall:WALL},records=new CommunityDnsRecords(()=>now.mono,()=>now.wall),raw=directory();
  records.replace(raw,'community',now.mono,now.wall);return{now,records,raw,name:raw.members[0].dnsName};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function policyFixture(run,options={}){
  resetNetwork();const root=fs.mkdtempSync(path.join(os.tmpdir(),'laokuai-dns-policy-test-')),ledger=path.join(root,'dns-ledger.json');
  const now={mono:1000,wall:WALL},records=new CommunityDnsRecords(()=>now.mono,()=>now.wall);
  const events=[],calls=[];let enabled=true,failureCallback,startError=null;
  const listener={start:async()=>{events.push('start');if(startError)throw startError;},stop:async()=>{events.push('stop');},onFailure:callback=>{failureCallback=callback;return()=>{};}};
  const ports={enabled:()=>enabled,ledgerPath:()=>ledger,helperPath:()=>{throw Error('real-helper-forbidden');},
    monoMs:()=>now.mono,wallMs:()=>now.wall,records,listener,invoke:async request=>{
      calls.push(request);events.push(request.operation);
      if(request.operation==='ensure')assert.ok(JSON.parse(fs.readFileSync(ledger,'utf8')).zones.some(row=>row.zone===request.zone&&row.ownershipId===request.ownershipId),'durable intent must precede helper');
      return{schemaVersion:1,ok:true,code:'owned'};
    },...options};
  const policy=new CommunityDnsPolicy(ports),raw=directory();
  const f={root,ledger,now,records,ports,listener,policy,raw,events,calls,
    publish:(value=raw,scope='community')=>policy.publish(scope,value,now.mono,now.wall),
    setEnabled:value=>enabled=value,setStartError:value=>startError=value,
    failListener:()=>{records.clearAll();events.push('listener-failed');failureCallback();},
    readLedger:()=>JSON.parse(fs.readFileSync(ledger,'utf8'))};
  try{await run(f);}finally{
    await policy.stop().catch(()=>undefined);
    fs.rmSync(root,{recursive:true,force:true});
  }
}

test('directory parser enforces scope, private IPv4, exact fields, distinct devices and expiry',()=>{
  const raw=directory();assert.deepEqual(parseCommunityDnsDirectory(raw,'community'),raw);
  for(const change of [r=>r.communityId='other',r=>r.dns.zone='untrusted.example.',r=>r.members[0].hostname='peer-claim',
    r=>r.members[0].virtualIp='198.51.100.1',r=>r.members[0].dnsExpiresAtMs=r.dns.serverTimeMs,
    r=>r.members[0].dnsExpiresAtMs=r.dns.serverTimeMs+10001,r=>r.members.push({...r.members[0]}),r=>r.dns.serverTimeMs=0,
    r=>r.dns.maxAgeMs=10001,r=>r.members[0].dnsName=r.members[0].dnsName.replace(ZONE,ZONE_B)]){
    const invalid=clone(raw);change(invalid);assert.throws(()=>parseCommunityDnsDirectory(invalid,'community'));
  }
  const second={...raw.members[0],virtualIp:'10.77.0.3',dnsName:`d-${'2'.repeat(32)}.${ZONE}`};raw.members.push(second);
  assert.equal(parseCommunityDnsDirectory(raw,'community').members.length,2,'same account devices stay distinct');
});
test('getters, inherited objects, hidden fields and sparse arrays cannot cross the parser',()=>{
  let calls=0;const getter=directory();Object.defineProperty(getter.members[0],'dnsName',{get(){calls++;return'claimed';}});
  assert.throws(()=>parseCommunityDnsDirectory(getter,'community'));assert.equal(calls,0);
  const arrayGetter=directory();Object.defineProperty(arrayGetter.members,'0',{get(){calls++;return directory().members[0];}});
  assert.throws(()=>parseCommunityDnsDirectory(arrayGetter,'community'));assert.equal(calls,0);
  const hidden=directory();Object.defineProperty(hidden,'hostname',{value:'claimed'});assert.throws(()=>parseCommunityDnsDirectory(hidden,'community'));
  const inherited=Object.assign(Object.create({hostname:'claim'}),directory());assert.throws(()=>parseCommunityDnsDirectory(inherited,'community'));
  assert.throws(()=>parseCommunityDnsDirectory(directory('community',ZONE,{members:new Array(1)}),'community'));
});
test('friendly records stay per device, zone scoped and answer the complete canonical name',()=>{
  for(const zone of ['lk.internal.','lk-0123abcd.internal.']) {
    const raw=directory('community',zone);
    raw.members[0].dnsName='shizi-12.'+zone;
    raw.members.push({...raw.members[0],virtualIp:'10.77.0.3',dnsName:'shizi-123.'+zone});
    assert.deepEqual(parseCommunityDnsDirectory(raw,'community'),raw);
    const now={mono:1000,wall:WALL},records=new CommunityDnsRecords(()=>now.mono,()=>now.wall);
    records.replace(raw,'community',now.mono,now.wall);
    assert.deepEqual([...records.answer(query(raw.members[0].dnsName)).subarray(-4)],[10,77,0,2]);
    assert.deepEqual([...records.answer(query(raw.members[1].dnsName.toUpperCase())).subarray(-4)],[10,77,0,3]);
    assert.equal(rcode(records.answer(query('shizi-12.other.internal.'))),5);
    const wrong=clone(raw);wrong.members[0].dnsName='shizi-12.lk-ffffffff.internal.';
    assert.throws(()=>parseCommunityDnsDirectory(wrong,'community'));
    now.mono+=10000;now.wall+=10000;
    assert.equal(answers(records.answer(query(raw.members[0].dnsName))),0);
  }
});
test('actual wire answer is authoritative IPv4 only, preserves ID/RD and caps positive TTL to one second',()=>{
  const f=recordsFixture(),request=query(f.name),answer=f.records.answer(request);
  assert.equal(rcode(answer),0);assert.equal(answers(answer),1);assert.equal(answer.readUInt16BE(0),0x1234);
  assert.equal(answer.readUInt16BE(2),0x8500);assert.equal(ttl(answer),1);assert.deepEqual([...answer.subarray(-4)],[10,77,0,2]);
  assert.equal(answers(f.records.answer(query(f.name,28))),0);assert.equal(rcode(f.records.answer(query(f.name,28))),0);
  assert.equal(rcode(f.records.answer(query(f.name,1,3))),5);assert.equal(rcode(f.records.answer(query('outside.example.'))),5);
  assert.equal(rcode(f.records.answer(query('missing.'+ZONE))),3);
});
test('malformed wire, high-bit ASCII aliases and unsupported header fields never receive an address',()=>{
  const f=recordsFixture(),packet=query(f.name),invalid=[];
  const high=Buffer.from(packet);high[13]|=0x80;invalid.push(high);
  const pointer=Buffer.from(packet);pointer[12]=0xc0;invalid.push(pointer);
  for(const [offset,value]of [[2,0x8000],[2,0x0800],[2,0x0200],[2,0x0040],[4,2],[6,1],[8,1],[10,2]]){
    const changed=Buffer.from(packet);changed.writeUInt16BE(value,offset);invalid.push(changed);
  }
  invalid.push(Buffer.concat([packet,Buffer.from([0])]),packet.subarray(0,packet.length-1),Buffer.alloc(513));
  for(const changed of invalid)assert.equal(f.records.answer(changed),null);
  for(let length=0;length<12;length++)assert.equal(f.records.answer(Buffer.alloc(length)),null);
});
test('one bounded EDNS0 record is accepted without reflecting its data; malformed options are rejected',()=>{
  const f=recordsFixture(),packet=query(f.name);packet.writeUInt16BE(1,10);
  const opt=Buffer.alloc(11);opt.writeUInt16BE(41,1);opt.writeUInt16BE(1232,3);
  const answer=f.records.answer(Buffer.concat([packet,opt]));assert.equal(answers(answer),1);assert.equal(answer.readUInt16BE(10),0);
  for(const change of [o=>o[0]=0xc0,o=>o.writeUInt16BE(1,1),o=>o.writeUInt32BE(0x10000,5),o=>o.writeUInt16BE(2,9)]){
    const malformed=Buffer.from(opt);change(malformed);assert.equal(f.records.answer(Buffer.concat([packet,malformed])),null);
  }
});
test('server clock skew uses relative lifetimes; each record expires on either local clock',()=>{
  const f=recordsFixture(),raw=directory();raw.dns.serverTimeMs=100000;raw.members[0].dnsExpiresAtMs=101500;
  f.records.replace(raw,'community',f.now.mono-500,f.now.wall-500);
  assert.equal(ttl(f.records.answer(query(f.name))),1);
  f.now.mono+=500;f.now.wall+=500;assert.equal(ttl(f.records.answer(query(f.name))),0);
  f.now.wall+=500;assert.equal(answers(f.records.answer(query(f.name))),0);
  assert.equal(f.records.hasFreshZone('community',ZONE),true);
});
test('stopped polling and local clock rollback expire or retire names even without timers',()=>{
  for(const field of ['mono','wall']){
    const f=recordsFixture();f.now[field]--;assert.equal(answers(f.records.answer(query(f.name))),0);
    f.now[field]++;assert.equal(answers(f.records.answer(query(f.name))),0);assert.equal(f.records.hasFreshZone('community',ZONE),false);
  }
  const f=recordsFixture();f.now.mono+=10000;assert.equal(rcode(f.records.answer(query(f.name))),2);assert.equal(f.records.hasFreshZone('community',ZONE),false);
});
test('future, negative and slow request clocks are rejected; cross-community zone collisions are isolated',()=>{
  const f=recordsFixture();
  for(const [mono,wall]of [[f.now.mono+1,f.now.wall],[-1,f.now.wall],[f.now.mono,0],[f.now.mono-1001,f.now.wall-1001]])
    assert.throws(()=>f.records.replace(f.raw,'community',mono,wall));
  assert.throws(()=>f.records.replace(directory('other'),'other',f.now.mono,f.now.wall));
  assert.equal(answers(f.records.answer(query(f.name))),1);
  f.records.replace(directory('other',ZONE_B),'other',f.now.mono,f.now.wall);f.records.clear('other');
  assert.equal(answers(f.records.answer(query(f.name))),1);
});
test('listener factories are mocked and ordinary tests cannot accidentally open a socket',async()=>{
  resetNetwork();const listener=new CommunityDnsListener(recordsFixture().records);await assert.rejects(listener.start(),/forbidden/);
});
test('fake UDP/TCP listener is loopback-only, bounded, and frames one complete TCP query',async()=>{
  resetNetwork({allowed:true});const f=recordsFixture(),listener=new CommunityDnsListener(f.records);await listener.start();
  const udp=network.udp[0],tcp=network.tcp[0],packet=query(f.name);
  assert.deepEqual(udp.bindArgs,{port:53,address:COMMUNITY_DNS_ADDRESS});assert.deepEqual(tcp.listenArgs,{port:53,address:COMMUNITY_DNS_ADDRESS});
  udp.emit('message',packet,{address:'198.51.100.1',port:1234});assert.equal(udp.sent.length,0);
  udp.emit('message',packet,{address:'127.0.0.1',port:1234});assert.equal(answers(udp.sent[0].buffer),1);
  const client=new FakeClient();tcp.emit('connection',client);assert.equal(client.timeout.ms,2000);
  const size=Buffer.alloc(2);size.writeUInt16BE(packet.length);client.emit('data',size.subarray(0,1));client.emit('data',Buffer.concat([size.subarray(1),packet]));
  assert.ok(client.output);assert.equal(client.output.readUInt16BE(0),client.output.length-2);assert.equal(answers(client.output.subarray(2)),1);
  const foreign=new FakeClient('198.51.100.1');tcp.emit('connection',foreign);assert.equal(foreign.destroyed,true);
  const oversized=new FakeClient();tcp.emit('connection',oversized);oversized.emit('data',Buffer.alloc(515));assert.equal(oversized.destroyed,true);
  const pipeline=new FakeClient();tcp.emit('connection',pipeline);pipeline.emit('data',Buffer.concat([size,packet,size,packet]));assert.equal(pipeline.destroyed,true);
  await listener.stop();assert.equal(listener.port,null);assert.equal(udp.bound,false);assert.equal(tcp.bound,false);
});
test('UDP/TCP startup and post-listen errors close only owned fake handles and clear records',async()=>{
  for(const mode of ['failUdp','failTcp','failCreateTcp']){
    resetNetwork({allowed:true,[mode]:true});const f=recordsFixture(),listener=new CommunityDnsListener(f.records);
    await assert.rejects(listener.start());assert.equal(network.udp.every(socket=>!socket.bound),true);assert.equal(listener.port,null);
  }
  resetNetwork({allowed:true});const f=recordsFixture(),listener=new CommunityDnsListener(f.records);let failed=0;
  listener.onFailure(()=>failed++);await listener.start();network.udp[0].emit('error',Error('fake-runtime-error'));await turn();
  assert.equal(failed,1);assert.equal(listener.port,null);assert.equal(answers(f.records.answer(query(f.name))),0);
});
test('a stopped late bind cannot resurrect its handles or close a newer listener generation',async()=>{
  resetNetwork({allowed:true,holdUdp:true});const f=recordsFixture(),listener=new CommunityDnsListener(f.records),old=listener.start();
  const rejected=assert.rejects(old,/retired/);const late=network.udp[0];await listener.stop();
  network.holdUdp=false;await listener.start();const current=network.udp[1];
  late.complete();await rejected;assert.equal(late.bound,false);assert.equal(current.bound,true);assert.equal(listener.port,53);
  await listener.stop();
});
test('policy writes ownership intent before helper ensure, reports freshness and removes only owned intent on quit',async()=>{
  await policyFixture(async f=>{
    f.publish();await f.policy.settled();assert.equal(f.policy.isReady('community'),true);
    assert.match(f.readLedger().zones[0].ownershipId,/^[a-f0-9]{32}$/);
    f.now.mono+=10000;assert.equal(f.policy.isReady('community'),false);
    await f.policy.stop();assert.deepEqual(f.readLedger().zones,[]);assert.deepEqual(f.calls.map(c=>c.operation),['ensure','remove']);
  });
});
test('same-zone refresh avoids another helper mutation, and same-epoch failure clears records',async()=>{
  await policyFixture(async f=>{
    f.publish();await f.policy.settled();f.now.mono+=1;f.now.wall+=1;f.publish();await f.policy.settled();
    assert.equal(f.calls.filter(c=>c.operation==='ensure').length,1);
    f.publish({invalid:'directory'});await f.policy.settled();assert.equal(f.policy.isReady('community'),false);assert.deepEqual(f.readLedger().zones,[]);
  });
});
test('older publish failure cannot erase newer records, readiness or a reused owned rule',async()=>{
  await policyFixture(async f=>{
    const pending=deferred();let first=true;
    f.ports.invoke=async request=>{f.calls.push(request);if(request.operation==='ensure'&&first){first=false;return pending.promise;}return{schemaVersion:1,ok:true,code:'owned'};};
    f.publish();await turn();f.publish();pending.reject(Error('older-helper-failure'));await f.policy.settled();
    assert.equal(f.policy.isReady('community'),true);assert.equal(answers(f.records.answer(query(f.raw.members[0].dnsName))),1);
    assert.equal(f.readLedger().zones.length,1);assert.equal(f.calls.filter(c=>c.operation==='remove').length,0);
  });
});
test('clear followed by newer same-zone publish cannot remove the newly reused rule',async()=>{
  await policyFixture(async f=>{
    f.publish();await f.policy.settled();const ownership=f.readLedger().zones[0].ownershipId;
    f.policy.clear('community');f.publish();await f.policy.settled();assert.equal(f.policy.isReady('community'),true);
    assert.equal(f.readLedger().zones[0].ownershipId,ownership);assert.equal(f.calls.filter(c=>c.operation==='remove').length,0);
  });
});
test('quit during ensure retires late success and rejects subsequent publications',async()=>{
  await policyFixture(async f=>{
    const pending=deferred();f.ports.invoke=async request=>{f.calls.push(request);return request.operation==='ensure'?pending.promise:{schemaVersion:1,ok:true,code:'owned'};};
    f.publish();await turn();const stop=f.policy.stop();pending.resolve({schemaVersion:1,ok:true,code:'owned'});await stop;
    assert.equal(f.policy.isReady('community'),false);assert.deepEqual(f.readLedger().zones,[]);assert.equal(f.events.includes('stop'),true);
    const count=f.calls.length;f.publish();await f.policy.settled();assert.equal(f.calls.length,count);
  });
});
test('crash ledger recovery runs before any new listener/policy; failed cleanup retains recovery evidence',async()=>{
  await policyFixture(async f=>{
    const row={zone:ZONE_B,ownershipId:'f'.repeat(32)};fs.writeFileSync(f.ledger,JSON.stringify({schemaVersion:1,zones:[row]}));
    await f.policy.recover();assert.deepEqual(f.calls[0],{schemaVersion:1,operation:'remove',...row});
    f.publish();await f.policy.settled();assert.deepEqual(f.events.slice(0,3),['remove','start','ensure']);
    f.ports.invoke=async request=>{f.calls.push(request);return{schemaVersion:1,ok:false,code:'ownership-conflict'};};
    await assert.rejects(f.policy.stop(),/cleanup-failed/);assert.equal(f.events.includes('stop'),true);assert.equal(f.readLedger().zones.length,1);
  });
});
test('failed old-zone cleanup blocks a new-zone ensure until the durable orphan is retired',async()=>{
  await policyFixture(async f=>{
    f.publish();await f.policy.settled();let cleanupAllowed=false;
    f.ports.invoke=async request=>{f.calls.push(request);return{schemaVersion:1,ok:request.operation!=='remove'||cleanupAllowed,code:'owned'};};
    const next=directory('community',ZONE_B);f.publish(next);await f.policy.settled();
    assert.equal(f.policy.isReady('community'),false);assert.equal(f.readLedger().zones[0].zone,ZONE);
    f.publish(next);await f.policy.settled();assert.equal(f.calls.some(c=>c.operation==='ensure'&&c.zone===ZONE_B),false);
    cleanupAllowed=true;f.publish(next);await f.policy.settled();assert.equal(f.policy.isReady('community'),true);
    assert.equal(f.readLedger().zones[0].zone,ZONE_B);
  });
});
test('malformed or inaccessible ledger still closes listener in the quit finally path',async()=>{
  await policyFixture(async f=>{
    fs.writeFileSync(f.ledger,'{"invalid":true}');await assert.rejects(f.policy.stop(),/cleanup-failed/);
    assert.equal(f.events.filter(e=>e==='stop').length,1);assert.equal(f.calls.length,0);
  });
});
test('disabled isolation never invokes helper or reads/adopts a production ledger, yet closes listeners',async()=>{
  await policyFixture(async f=>{
    f.setEnabled(false);fs.writeFileSync(f.ledger,'invalid production ledger');await f.policy.recover();f.publish();await f.policy.stop();
    assert.equal(f.calls.length,0);assert.equal(f.events.includes('stop'),true);
  });
});
test('listener failure retires readiness and subsequent fresh publication can re-establish DNS',async()=>{
  await policyFixture(async f=>{
    f.publish();await f.policy.settled();f.failListener();assert.equal(f.policy.isReady('community'),false);
    f.publish();await f.policy.settled();assert.equal(f.policy.isReady('community'),true);
    assert.equal(f.events.filter(e=>e==='start').length,2);
  });
});
test('listener startup failure cannot create a WMI intent or ready result',async()=>{
  await policyFixture(async f=>{
    f.setStartError(Error('fake-listener-start'));f.publish();await f.policy.settled();assert.equal(f.calls.length,0);
    assert.equal(f.policy.isReady('community'),false);assert.equal(fs.existsSync(f.ledger),false);
  });
});
test('durable ledger write failure prevents helper ensure and leaves names unavailable',async()=>{
  await policyFixture(async f=>{
    const blocked=path.join(f.root,'blocked');fs.writeFileSync(blocked,'fixture');f.ports.ledgerPath=()=>path.join(blocked,'ledger.json');
    f.publish();await f.policy.settled();assert.equal(f.calls.length,0);assert.equal(f.policy.isReady('community'),false);
  });
});
test('helper output is strictly bounded JSON while child execution is always mocked',async()=>{
  const request={schemaVersion:1,operation:'ensure',zone:ZONE,ownershipId:'1'.repeat(32)};
  execReply={out:JSON.stringify({schemaVersion:1,ok:true,code:'owned'}),calls:[]};
  assert.equal((await invokeDnsPolicy('FAKE-HELPER',request)).ok,true);assert.deepEqual(execReply.calls[0].args,['--dns-policy']);
  assert.deepEqual(JSON.parse(execReply.input),request);assert.equal(execReply.calls[0].options.windowsHide,true);
  for(const out of ['invalid',JSON.stringify({schemaVersion:1,ok:'yes',code:'owned'}),JSON.stringify({schemaVersion:1,ok:true,code:'owned',extra:true})]){
    execReply={out,calls:[]};await assert.rejects(invokeDnsPolicy('FAKE-HELPER',request),/invalid-response/);
  }
  execReply=null;
});
