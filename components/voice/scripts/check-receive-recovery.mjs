import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const tests=[];
const actualCompile=WebAssembly.compile;
const context=()=>({audioWorklet:{calls:0,async addModule(){++this.calls;}}});
const loader=await import('../dist/audio/processors/receiveProcessor.js?loader-recovery');
const compileContext=context();let compileCalls=0;
WebAssembly.compile=async bytes=>{if(++compileCalls===1)throw Error('injected compile');return actualCompile(bytes);};
await assert.rejects(loader.loadReceiveProcessor(compileContext));
await loader.loadReceiveProcessor(compileContext);assert.equal(compileContext.audioWorklet.calls,1);
assert.equal(compileCalls,2);WebAssembly.compile=actualCompile;
tests.push('compile failure retry reuses successful addModule');
const loadContext=context();loadContext.audioWorklet.addModule=async function(){if(++this.calls===1)throw Error('injected load');};
await assert.rejects(loader.loadReceiveProcessor(loadContext));await loader.loadReceiveProcessor(loadContext);
assert.equal(loadContext.audioWorklet.calls,2);tests.push('failed addModule retries once; subscriber-independent cache');
class Param{value=1;setValueAtTime(v){this.value=v;}setTargetAtTime(v){this.value=v;}}
class Node{targets=new Set();connect(n){this.targets.add(n);return n;}disconnect(){this.targets.clear();}}
class Gain extends Node{gain=new Param();}
class Port{posted=[];onmessage;postMessage(v){this.posted.push(v);}close(){this.closed=true;}}
const nodes=[];
globalThis.AudioWorkletNode=class extends Node{
  constructor(ctx,name,opts){super();this.options=opts;this.port=new Port();this.parameters=new Map([['enabled',new Param()],['muted',new Param()]]);nodes.push(this);}
};
class Context{
  sampleRate=48000;currentTime=1;state='running';destination=new Node();listeners=new Set();audioWorklet=context().audioWorklet;
  createGain(){return new Gain();}createWaveShaper(){return new Node();}
  addEventListener(_,fn){this.listeners.add(fn);}removeEventListener(_,fn){this.listeners.delete(fn);}
  change(state){this.state=state;for(const fn of this.listeners)fn();}
}
const {ReceiveController}=await import('../dist/audio/lib/receiveGraph.js');
const ctx=new Context(),owner=new ReceiveController(ctx,false),source=new Node(),manual=new Gain();
manual.gain.value=.37;owner.bus.gain.value=.42;
const route=owner.attach(source,manual),identity={participantId:'host/authenticated-user',receiverId:'physical-1',trackId:'track-1',generation:1};
route.setIdentity(identity);route.setRole('microphone');
const batches=[],states=[];const unsubscribe=owner.subscribeAutoLevels(x=>batches.push(x));owner.subscribe(x=>states.push(x));
assert.equal(owner.state.status,'disabled');assert.equal(owner.state.latencyMs,0);
assert.equal(route.fallbackGain.gain.value,1);owner.setEnabled(true);await owner.recover();
await new Promise(resolve=>setTimeout(resolve,0));await owner.recover();
assert.equal(owner.state.status,'active');assert.equal(owner.state.latencyMs,6);assert.equal(route.healthy,true);
tests.push('cold disabled unity; enabled healthy 6ms graph');
assert.ok(source.targets.has(route.leveler));assert.ok(route.leveler.targets.has(manual));
assert.ok(manual.targets.has(route.limiter));assert.ok(!manual.targets.has(route.leveler), 'manual gain must not feed the automatic measurement');
const assertManualPreserved=()=>{assert.equal(manual.gain.value,.37);assert.equal(owner.bus.gain.value,.42);};
assertManualPreserved();
tests.push('automatic measurement precedes personal gain; personal/master coefficients preserved on activation');
const prior={schemaVersion:1,processorSchema:'gryt-receive-level-v2',learnedGainDb:18,
  speechLevelDbfs:-38,effectiveSpeechSeconds:30,lastVerifiedUnixMs:1000};
assert.equal(route.setPrior(prior,{...identity,generation:0}),false);
assert.equal(route.setPrior({...prior,learnedGainDb:Infinity},identity),false);
assert.equal(route.setPrior(prior,identity),true);prior.learnedGainDb=1;
assert.equal(route.prior.learnedGainDb,18);
tests.push('prior queue validates exact binding and copied scalars');
function workerSnapshot(gain=12,sequence=1){return {...identity,sequence,controlRevision:route.controlRevision,
  audioTimeSeconds:2,status:'learning',limitReasons:[],appliedAutoGainDb:gain,learnedAutoGainDb:gain,targetAutoGainDb:gain,
  acceptedSpeechSeconds:2,speechWindowSeconds:2,estimatorReliability:'provisional',compressionGainReductionDb:0,
  speechLevelDbfs:-38,priorRestoring:false,priorRejected:false,lastAcceptedSpeechAudioTimeSeconds:2};}
function send(snapshot,bus=owner.busLimiter){bus.port.onmessage({data:{kind:'receive-auto-levels',schemaVersion:1,snapshots:[snapshot]}});}
send(workerSnapshot());const first=batches.at(-1).snapshots[0];assert.equal(first.appliedAutoGainDb,12);
assert.equal(route.setPrior(prior,identity),false);
const stale=workerSnapshot(15,2);route.setMuted(true);
const invalid=batches.at(-1).snapshots[0];assert.equal(invalid.appliedAutoGainDb,null);assert.ok(invalid.sequence>first.sequence);
send(stale);assert.equal(batches.at(-1).snapshots[0].appliedAutoGainDb,null);
route.setMuted(false);send(workerSnapshot(3,3));assert.equal(batches.at(-1).snapshots[0].appliedAutoGainDb,3);
tests.push('lifecycle null clears with increasing public sequence; old control data rejected');
const oldBus=owner.busLimiter,lastSequence=batches.at(-1).snapshots[0].sequence;
owner.fail('injected-processor-error');assert.equal(owner.state.status,'degraded');assert.equal(owner.state.latencyMs,0);
assertManualPreserved();
assert.ok(source.targets.has(route.fallbackGain));assert.equal(route.fallbackGain.gain.value,.5);
await owner.recover();assert.equal(owner.state.status,'active');send(workerSnapshot(4,1));
assertManualPreserved();
assert.ok(batches.at(-1).snapshots[0].sequence>lastSequence);assert.equal(batches.at(-1).snapshots[0].appliedAutoGainDb,4);
send(workerSnapshot(17,999),oldBus);assert.equal(batches.at(-1).snapshots[0].appliedAutoGainDb,4);
tests.push('processor-error fallback remains routed; recovery monotonic public sequence rejects old bus');
owner.setEnabled(false);assert.equal(owner.state.status,'disabled');assert.equal(owner.state.latencyMs,6);
assert.equal(route.leveler.parameters.get('enabled').value,0);assert.equal(route.limiter.parameters.get('enabled').value,0);
assert.equal(route.fallbackGain.gain.value,1);tests.push('warm OFF actual delay retained, no forced -6dB');
assertManualPreserved();
owner.setEnabled(true);ctx.change('suspended');assert.equal(owner.state.status,'suspended');
assert.equal(batches.at(-1).snapshots[0].appliedAutoGainDb,null);ctx.change('running');send(workerSnapshot(2,2));
assert.equal(batches.at(-1).snapshots[0].appliedAutoGainDb,2);tests.push('suspend invalidates; resumed graph publishes measured state');
assertManualPreserved();tests.push('personal/master settings survive processor failure, recovery, OFF and suspend/resume');
route.setIdentity({...identity,generation:2,trackId:'track-2'});send(workerSnapshot(10,500));
assert.equal(route.prior,undefined);assert.equal(route.setPrior(prior,identity),false);
assert.equal(batches.at(-1).snapshots[0].appliedAutoGainDb,null);assert.equal(batches.at(-1).snapshots[0].generation,2);
route.setIdentity(identity);assert.equal(route.identity.generation,2);route.setIdentity(undefined);
assert.deepEqual(batches.at(-1).snapshots,[]);tests.push('new generation clears old measurements, rejects old identity, explicit unbind authoritative empty');
route.setIdentity(identity);assert.equal(route.identity,undefined);
route.setIdentity({...identity,generation:2,trackId:'track-2'});
const reboundSequence=batches.at(-1).snapshots[0].sequence;assert.ok(reboundSequence>1);
owner.setMuted(true);assert.equal(route.leveler.parameters.get('muted').value,1);assert.equal(route.limiter.parameters.get('muted').value,1);
route.setMuted(true);owner.setMuted(false);assert.equal(route.leveler.parameters.get('muted').value,1);
route.setMuted(false);assert.equal(route.leveler.parameters.get('muted').value,0);
tests.push('unbound generation high-water retained; global mute clears all routes and preserves personal reason');
route.dispose();unsubscribe();owner.dispose();assert.equal(owner.telemetryTimer?._destroyed,true);
assert.equal(ctx.listeners.size,0);assert.ok(nodes.every(node=>node.port.closed));tests.push('dispose clears routes, timers, ports, listeners');
const result={status:'passed',tests,scope:'main-thread state/graph-management with fake nodes; actual DSP tested separately'};
if(process.env.RECEIVE_RESULTS)writeFileSync(process.env.RECEIVE_RESULTS,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
