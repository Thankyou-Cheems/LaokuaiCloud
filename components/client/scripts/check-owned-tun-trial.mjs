import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fakeFacts } from './owned-tun-snapshot-fixture.mjs';
import { fakeSocketSnapshot } from './owned-tun-socket-fixture.mjs';
import { SCOPE, SCOPE_SHA256, TRIAL_SUSPENDED, sha256, validateApproval, validateBuildEvidence, verifyTrialPayload, verifyTrialDocuments, buildIsolatedConfig, validateBefore, validateDuring, validateAfter, runBoundedTrial } from './owned-tun-trial-policy.mjs';

// Pure observations, fake clocks/children only. No execute adapter, OS reads or sockets.
const copy = value => structuredClone(value);
const before = () => ({ ...fakeSocketSnapshot(), complete: true, administrator: true, guiAlive: true, guiFingerprint: 'old-gui', ownedForbiddenSocketCount: 0,
  semanticFacts:fakeFacts(SCOPE.protectedGuid),
  driverCount: 1, driverVer: SCOPE.driverVer, driverSysSha256: SCOPE.driverSysSha256, driverRunning: true,
  aliasConflict: false, addressOrRouteConflict: false, portalOwnerPids: [], firewallSha256: 'firewall', default4Sha256: 'v4', default6Sha256: 'v6', categories: [{ id: 'old-profile', category: 0 }],
  adapters: [{ guid: SCOPE.protectedGuid, ifIndex: 30, alias: 'et_7_hvb5', status: 'Up', addresses: [{ family: 4, ip: SCOPE.protectedAddress, prefix: 24 }], fingerprint: 'old-interface' }] });
const receipt = { pid: 123, interfaces: [{ guid: '00000000-0000-4000-8000-000000000001', luid: '9999999999999999999', ifIndex: 77 }] };
function during() {
  const s = before(); Object.assign(s,fakeSocketSnapshot(123));
  s.semanticFacts.interfaces[receipt.interfaces[0].guid]=fakeFacts(receipt.interfaces[0].guid).interfaces[receipt.interfaces[0].guid];
  s.adapters.push({ guid: receipt.interfaces[0].guid, alias: SCOPE.alias, ifIndex: 77, luid: receipt.interfaces[0].luid,
    status: 'Up', addresses: [{ family: 4, ip: SCOPE.virtualAddress, prefix: 30 }], fingerprint: 'new-interface', hasDefault: false, safeTrialRoutes: true });
  return s;
}
const reports = [{ outcome: 'graceful', ownedPid: 123, interfaces: receipt.interfaces, residualCheckRequired: true }];
let tests = 0;
async function test(name, action) { await action(); console.log(`ok ${++tests} ${name}`); }
await test('explicit scope approval required; no substitutions or extra flags', () => {
  for (const args of [[], ['--execute'], ['--execute', '--approved-scope-sha256', 'wrong'], ['--execute', '--approved-scope-sha256', SCOPE_SHA256, '--config', 'foreign']]) assert.throws(() => validateApproval(args));
  assert.equal(TRIAL_SUSPENDED, false);
  validateApproval(['--execute', '--approved-scope-sha256', SCOPE_SHA256]);
  assert.throws(() => validateApproval(['--execute', '--approved-scope-sha256', '84ab28ae877cb7e99c3485a18bdd057802e480e13227eb4aa379c91d1b6e9acc']));
});
await test('config encoder has no credentials, external peers/listeners/STUN or network policy features', () => {
  const text = buildIsolatedConfig('00000000-0000-4000-8000-000000000001');
  for (const key of ['peer', 'listeners', 'mapped_listeners', 'stun_servers', 'tcp_stun_servers', 'stun_servers_v6', 'exit_nodes', 'routes', 'proxy_network', 'port_forward']) assert.ok(text.includes(`${key} = []\n`));
  for (const field of ['network_identity', 'network_secret', 'secure_mode', 'config_server', 'vpn_portal', 'http://', 'https://', 'tcp://', 'udp://']) assert.ok(!text.includes(field));
  assert.ok(text.includes('enable_udp_broadcast_relay = false\n'));
  assert.throws(() => buildIsolatedConfig('"\npeer = ["evil"]'));
});
await test('unknown categories/firewall/driver read cannot pass preflight', () => {
  assert.throws(() => validateBefore({ ...before(), complete: false }));
  for (const diff of [{ administrator: false }, { driverCount: 2 }, { driverVer: 'newer' }, { driverSysSha256: 'changed' }, { driverRunning: false }]) assert.throws(() => validateBefore({ ...before(), ...diff }));
});
await test('exact old GUI/NIC/address and zero port/subnet/name conflict required', () => {
  for (const diff of [{ guiAlive: false }, { aliasConflict: true }, { addressOrRouteConflict: true }, { portalOwnerPids: [6424] }, { adapters: [] }]) assert.throws(() => validateBefore({ ...before(), ...diff }));
});
await test('actual receipt GUID/LUID/index must match new OS interface', () => {
  assert.equal(validateDuring(before(), during(), receipt), true);
  for (const field of ['guid', 'luid', 'ifIndex']) { const wrong = copy(receipt); wrong.interfaces[0][field] = field === 'ifIndex' ? 78 : 'wrong'; assert.throws(() => validateDuring(before(), during(), wrong)); }
  assert.equal(validateDuring(before(), during(), { ...receipt, interfaces: [] }), false);
});
await test('actual global configuration, foreign RPC and any peer socket trigger failure', () => {
  for(const edit of [s=>{s.semanticFacts.tables.rules.rows[0][3]='n:4';},s=>{s.semanticFacts.tables.default4.rows[0][2]='n:99';},s=>{s.semanticFacts.tables.default6.rows.push(['n:1','z:null','n:1','n:1']);}]) {
    const wrong=during();edit(wrong);assert.throws(()=>validateDuring(before(),wrong,receipt));
  }
  for (const change of [{ portalOwnerPids: [6424] }, { ownedForbiddenSocketCount: 1 }, { guiFingerprint: 'reused-pid' }]) assert.throws(() => validateDuring(before(), { ...during(), ...change }, receipt));
});
await test('old interface/category changes and broad new routes are rejected', () => {
  const oldChanged = during(); oldChanged.semanticFacts.interfaces[SCOPE.protectedGuid].dns.rows[0][1].reverse(); assert.throws(() => validateDuring(before(), oldChanged, receipt));
  const categoryChanged = during(); categoryChanged.categories[0].category = 1; assert.throws(() => validateDuring(before(), categoryChanged, receipt));
  for (const change of [{ hasDefault: true }, { safeTrialRoutes: false }, { alias: 'et_7_hvb5' }, { addresses: [{ family: 4, ip: '10.126.126.3', prefix: 24 }] }]) {
    const wrong = during(); Object.assign(wrong.adapters[1], change); assert.throws(() => validateDuring(before(), wrong, receipt));
  }
});
await test('legacy hash/order differences do not override equal complete semantic configuration',()=>{
  const s=during();s.firewallSha256='different-serialization';s.default4Sha256='different-order';s.default6Sha256='different-order';s.adapters[0].fingerprint='different-order';
  assert.equal(validateDuring(before(),s,receipt),true);
  delete s.semanticFacts;assert.throws(()=>validateDuring(before(),s,receipt));
});
await test('ACK cannot prove OS disappearance; forced/unconfirmed cleanup fails', () => {
  assert.throws(() => validateAfter(before(), during(), reports));
  for (const outcome of ['forced', 'unconfirmed']) assert.throws(() => validateAfter(before(), before(), [{ ...reports[0], outcome }]));
  validateAfter(before(), before(), reports);
});
function evidence() {
  return { build: { schemaVersion: 2, sourceCommit: SCOPE.sourceCommit, sourceTree: SCOPE.sourceTree, sourcePatchSHA256: SCOPE.sourcePatchSha256,
    cargoLockSHA256: SCOPE.cargoLockSha256, buildProfile: SCOPE.buildProfile, noDefaultFeatures: true, features: copy(SCOPE.features), toolchain: '1.95.0',
    target: 'x86_64-pc-windows-msvc', rustflags: '-C target-feature=+crt-static', coreOrCliExecuted: false, nativeActivation: false, activePnetPackages: 0,
    sameFunctionalityAsOfficialClaim: false, normalAndDelayImportsBothPassed: true, actualPnetIdentifierScansBothPassed: true,
    files: SCOPE.payload.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })) },
  audit: { status: 'passed', normalAndDelayImportsParsed: true, dumpbinHeadersImportsDependentsPassed: true, binaryIdentifierScansPassed: true,
    coreAndCliExecuted: false, coreAndCli: SCOPE.payload.filter(file => file.name.endsWith('.exe')).map(file => ({file:file.path, bytes:file.bytes, sha256:file.sha256,
      machine:'AMD64', optionalMagic:'PE32+', executed:false, normalImports:['kernel32.dll'], delayImports:[], forbiddenImports:[],
      forbiddenIdentifierByteSearch:Object.fromEntries(['Packet.dll','wpcap.dll','Npcap','pnet_datalink','pnet_sys','pnet_base','pnet_packet'].map(name => [name,{asciiMatches:0,utf16leMatches:0}])) })) } };
}
await test('final four-file scope is immutable and does not require an installed Npcap service', () => {
  assert.deepEqual(SCOPE.payload.map(file => file.name), ['easytier-core.exe','easytier-cli.exe','wintun.dll','WinDivert64.sys']);
  assert.equal(SCOPE.features.length, 17); assert.ok(!SCOPE.features.includes('faketcp'));
  assert.throws(() => { SCOPE.payload[0].sha256 = 'changed'; }); assert.throws(() => SCOPE.features.push('faketcp'));
  validateBefore(before()); assert.equal(validateDuring(before(), during(), receipt), true);
  const snapshot = fs.readFileSync(new URL('./owned-tun-trial-snapshot.ps1', import.meta.url), 'utf8');
  assert.ok(!/npcap|npcap_wifi|Packet\.dll/i.test(snapshot));
});
await test('fixed source/features and both actual PE audit records are required before staging', () => {
  const good = evidence(); validateBuildEvidence(good.build, good.audit);
  for (const change of [{features:[...SCOPE.features,'faketcp']}, {activePnetPackages:1}, {sourceCommit:'other-source'}, {files:good.build.files.slice(1)}, {coreOrCliExecuted:true}, {sameFunctionalityAsOfficialClaim:true}, {normalAndDelayImportsBothPassed:false}]) {
    assert.throws(() => validateBuildEvidence({...good.build,...change},good.audit),/unreviewed-build-delivery/);
  }
  for (const edit of [r => r.coreAndCli.pop(), r => {r.coreAndCli[0].delayImports=['Packet.dll'];}, r => {r.coreAndCli[1].sha256='old-cli';},
    r => {r.coreAndCli[1].forbiddenIdentifierByteSearch.pnet_sys.utf16leMatches=1;}]) {
    const wrong = copy(good.audit); edit(wrong); assert.throws(() => validateBuildEvidence(good.build,wrong),/unreviewed-import-audit/);
  }
});
await test('missing or unexpected payload and absent notices cannot pass the source hash gate', () => {
  assert.throws(() => verifyTrialPayload({},Buffer.from('{}'),Buffer.from('{}')),/unexpected-runtime-payload/);
  const payload = Object.fromEntries(SCOPE.payload.map(file => [file.name,Buffer.from('wrong-bytes')]));
  assert.throws(() => verifyTrialPayload(payload,Buffer.from('{}'),Buffer.from('{}')),/approved-binary-hash-mismatch/);
  payload['Packet.dll']=Buffer.from('excluded'); assert.throws(() => verifyTrialPayload(payload,Buffer.from('{}'),Buffer.from('{}')),/unexpected-runtime-payload/);
  assert.throws(() => verifyTrialDocuments({}),/approved-notices-hash-mismatch/);
});

async function fixture(mode='normal') {
 let now=0,sequence=0,stopped=false,starts=0,prepared=false,shutdowns=0,cancel;
 const timers=new Map(),calls=[];
 const setTimer=(cb,ms)=>{const id=++sequence;timers.set(id,{at:now+ms,cb});return id;};
 const advance=async ms=>{now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.cb();}await Promise.resolve();};
 const processes={shutdownOwned(){shutdowns++;stopped=true;calls.push('stored-owned-child-stop');},async drainOwned(){calls.push('drain-owned');if(mode==='cleanup-error')throw new Error('cleanup');},cleanupReports(){return mode==='startup-hang'?[]:copy(reports).map(r=>({...r,outcome:mode==='forced'?'forced':'graceful'}));}};
 const p={processes,setTimer,clearTimer:id=>timers.delete(id),onCancel:cb=>{cancel=cb;return()=>{cancel=null;};},cancelReads:()=>calls.push('cancel-readers'),
 prepare:async()=>{prepared=true;},
 start:async()=>{starts++;if(mode==='startup-error')throw new Error('synthetic-startup-error');if(mode==='startup-hang'){await advance(SCOPE.maximumRunMs);return new Promise(()=>{});}return{isAlive:()=>mode!=='early-exit',ownedResources:()=>copy(receipt)};},
 full:async args=>{calls.push('full-'+args.stage);if(args.stage==='before'&&mode==='bad-baseline')throw new Error('baseline-incomplete');if(args.stage==='prepared'&&mode==='write-error')throw new Error('observation-evidence-write-failed');if(args.stage==='during'){
 if(mode==='read-hang'){await advance(SCOPE.maximumRunMs);return new Promise(()=>{});}
 if(mode==='policy-change')throw new Error('global-network-configuration-drift');
 if(mode==='cancel')cancel();return{ready:true};}
 if(args.stage==='after'){assert.equal(args.owned,null);if(mode==='residual-hang'){await advance(SCOPE.residualObservationMs);return new Promise(()=>{});}if(mode==='residual-slow'){await advance(27621);}if(mode==='forced')throw new Error('owned-stop-unconfirmed');}return{ready:false};},
 light:async args=>{calls.push('light-'+args.stage);if(args.stage==='warmup')return{ready:false};if(args.stage==='settling'){assert.equal(args.owned,null);if(mode==='residual'){await advance(SCOPE.residualSettleMs);return new Promise(()=>{});}return{ready:true};}return{ready:true};},
 pause:async ms=>{await advance(ms);}};
 let result,error;try{result=await runBoundedTrial(p);}catch(e){error=e;}return{result,error,now,calls,starts,prepared,shutdowns,timers};
}
await test('evidence completion stops early; one during full and two clean post samples required',async()=>{
 const f=await fixture();assert.equal(f.result.outcome,'passed');assert.equal(f.result.reason,'evidence-complete');assert.equal(f.result.duringComplete,true);assert.equal(f.result.freshLightBeforeStop,true);assert.equal(f.result.cleanResidualSamples,2);assert.equal(f.calls.filter(c=>c==='full-during').length,1);assert.equal(f.shutdowns,1);assert.equal(f.timers.size,0);assert.ok(f.calls.indexOf('stored-owned-child-stop')<f.calls.indexOf('cancel-readers'));assert.ok(f.calls.indexOf('stored-owned-child-stop')<f.calls.indexOf('drain-owned'));
});
await test('unavailable baseline or preflight persistence prevents preparation/start as applicable',async()=>{
 const bad=await fixture('bad-baseline');assert.ok(bad.error);assert.equal(bad.prepared,false);assert.equal(bad.starts,0);
 const disk=await fixture('write-error');assert.ok(disk.error);assert.equal(disk.starts,0);assert.equal(disk.shutdowns,0);
});
await test('startup/read hangs cannot block independent 65s stored-handle shutdown',async()=>{
 for(const mode of ['startup-hang','read-hang']){const f=await fixture(mode);assert.equal(f.shutdowns,1);assert.equal(f.result.outcome,'failed');assert.ok(f.calls.includes('full-after'));assert.equal(f.timers.size,0);}
});
await test('cancel, early exit, configuration drift, start error stop early and retain final observation',async()=>{
 for(const mode of ['cancel','early-exit','policy-change','startup-error']){const f=await fixture(mode);assert.equal(f.shutdowns,1);assert.equal(f.result.outcome,'failed');assert.ok(f.now<SCOPE.maximumRunMs);assert.ok(f.calls.includes('full-after'));}
});
await test('forced/unconfirmed owned cleanup cannot pass even with clean OS samples',async()=>{
 for(const mode of ['forced','cleanup-error'])assert.equal((await fixture(mode)).result.outcome,'failed');
});
await test('post-stop reads use no former numeric PID; settling/full deadlines fail closed',async()=>{
 for(const mode of ['residual','residual-hang']){const f=await fixture(mode);assert.equal(f.result.outcome,'failed');assert.ok(f.calls.includes('full-after'));assert.equal(f.timers.size,0);}
 const f=await fixture('residual-slow');assert.equal(f.result.outcome,'passed');assert.ok(f.now<65000);
});
await test('frozen 65s scope pins all observation/adapter sources and rejects former scope',()=>{
 assert.equal(SCOPE.maximumRunMs,65000);assert.equal(SCOPE.light.timeoutMs,5000);assert.equal(SCOPE.fullDuringCount,1);assert.equal(SCOPE.residualSettleMs,15000);assert.equal(SCOPE.residualObservationMs,40000);assert.equal(SCOPE.observationWorker.independentSupervisor,true);
 assert.equal(Object.keys(SCOPE.observationSources).length,17);
 assert.equal(SCOPE.schema,5);assert.equal(SCOPE.light.socketEndpointLimit,256);assert.equal(SCOPE.light.maxOutputBytes,524288);
 assert.throws(()=>validateApproval(['--execute','--approved-scope-sha256','2392f12f7284d982a1a3b6e179c7becbe294449e519f7832a090aadbeb99bd5b']));
 for(const [file,hash] of Object.entries(SCOPE.observationSources))assert.equal(sha256(fs.readFileSync(new URL('./'+file,import.meta.url))),hash,file);
 assert.throws(()=>validateApproval(['--execute','--approved-scope-sha256','bd107b2ae27d9e2d45c817eedec4f99b99e3030f62e66188e2ffc65942ea2c72']));
});
await test('entry point is opt-in; full/light collectors contain no OS mutation commands',()=>{
 const runner=fs.readFileSync(new URL('./run-owned-tun-trial.mjs',import.meta.url),'utf8');assert.ok(runner.indexOf('validateApproval(process.argv.slice(2))')<runner.indexOf('new EasyTierWindowsProcesses(15897)'));
 for(const file of ['owned-tun-trial-snapshot.ps1','owned-tun-light-snapshot.ps1','owned-tun-socket-evidence.ps1'])assert.ok(!/\b(?:Start-Process|Stop-Process|New-Net\w*|Set-Net\w*|Remove-Net\w*|Enable-Net\w*|Disable-Net\w*|netsh|pnputil|WintunCreateAdapter)\b/i.test(fs.readFileSync(new URL('./'+file,import.meta.url),'utf8')));
});
console.log(`${tests} pure trial checks passed; no candidate, driver, UAC, socket or OS snapshot executed`);
