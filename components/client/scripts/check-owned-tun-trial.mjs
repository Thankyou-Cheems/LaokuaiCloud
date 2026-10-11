import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCOPE, SCOPE_SHA256, TRIAL_SUSPENDED, validateApproval, validateBuildEvidence, verifyTrialPayload, verifyTrialDocuments, buildIsolatedConfig, validateBefore, validateDuring, validateAfter, runBoundedTrial } from './owned-tun-trial-policy.mjs';

// Pure observations, fake clocks/children only. No execute adapter, OS reads or sockets.
const copy = value => structuredClone(value);
const before = () => ({ complete: true, administrator: true, guiAlive: true, guiFingerprint: 'old-gui', ownedForbiddenSocketCount: 0,
  driverCount: 1, driverVer: SCOPE.driverVer, driverSysSha256: SCOPE.driverSysSha256, driverRunning: true,
  aliasConflict: false, addressOrRouteConflict: false, portalOwnerPids: [], firewallSha256: 'firewall', default4Sha256: 'v4', default6Sha256: 'v6', categories: [{ id: 'old-profile', category: 0 }],
  adapters: [{ guid: SCOPE.protectedGuid, ifIndex: 30, alias: 'et_7_hvb5', status: 'Up', addresses: [{ family: 4, ip: SCOPE.protectedAddress, prefix: 24 }], fingerprint: 'old-interface' }] });
const receipt = { pid: 123, interfaces: [{ guid: '00000000-0000-4000-8000-000000000001', luid: '9999999999999999999', ifIndex: 77 }] };
function during() {
  const s = before(); s.portalOwnerPids = [123];
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
await test('global settings, foreign RPC and any peer socket trigger failure', () => {
  for (const change of [{ firewallSha256: 'changed' }, { default4Sha256: 'changed' }, { default6Sha256: 'changed' }, { portalOwnerPids: [6424] }, { ownedForbiddenSocketCount: 1 }, { guiFingerprint: 'reused-pid' }]) assert.throws(() => validateDuring(before(), { ...during(), ...change }, receipt));
});
await test('old interface/category changes and broad new routes are rejected', () => {
  const oldChanged = during(); oldChanged.adapters[0].fingerprint = 'changed'; assert.throws(() => validateDuring(before(), oldChanged, receipt));
  const categoryChanged = during(); categoryChanged.categories[0].category = 1; assert.throws(() => validateDuring(before(), categoryChanged, receipt));
  for (const change of [{ hasDefault: true }, { safeTrialRoutes: false }, { alias: 'et_7_hvb5' }, { addresses: [{ family: 4, ip: '10.126.126.3', prefix: 24 }] }]) {
    const wrong = during(); Object.assign(wrong.adapters[1], change); assert.throws(() => validateDuring(before(), wrong, receipt));
  }
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

async function fixture(mode = 'normal') {
  let now = 0, stopped = false, prepared = false, snapshots = 0, starts = 0, shutdowns = 0, cancel;
  let sequence = 0; const timers = new Map(), calls = [];
  const setTimer = (cb, ms) => { const id = ++sequence; timers.set(id, { at: now + ms, cb }); return id; };
  async function advance(ms) {
    now += ms;
    for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.cb(); }
    await Promise.resolve();
  }
  const processes = { shutdownOwned() { shutdowns++; stopped = true; calls.push('shutdown-owned'); }, async drainOwned() { calls.push('drain-owned'); if (mode === 'cleanup-error') throw new Error('fake'); }, cleanupReports() { return mode === 'startup-hang' ? [] : copy(reports).map(r => ({ ...r, outcome: mode === 'forced' ? 'forced' : 'graceful' })); } };
  const p = { processes, setTimer, clearTimer: id => timers.delete(id), onCancel: cb => { cancel = cb; return () => { cancel = null; }; }, cancelReads: () => calls.push('cancel-reads'),
    prepare: async () => { prepared = true; },
    start: async () => { starts++; if (mode === 'startup-error') throw new Error('synthetic-startup-error'); if (mode === 'startup-hang') { await advance(30000); return new Promise(() => {}); } return { isAlive: () => mode !== 'early-exit', ownedResources: () => copy(receipt) }; },
    snapshot: async () => {
      snapshots++;
      if (snapshots <= 2) { const s = before(); if (mode === 'bad-baseline') s.complete = false; return s; }
      if (stopped) {
        if (mode === 'residual-hang') { await advance(10000); return new Promise(() => {}); }
        if (mode === 'residual') return during();
        return before();
      }
      if (mode === 'read-hang') { await advance(30000); return new Promise(() => {}); }
      const s = during(); if (mode === 'policy-change') s.firewallSha256 = 'changed'; return s;
    },
    pause: async ms => { if (mode === 'cancel' && cancel) cancel(); await advance(ms); },
  };
  let result, error;
  try { result = await runBoundedTrial(p); } catch (e) { error = e; }
  return { result, error, calls, now, starts, shutdowns, prepared, timers };
}
await test('30-second deadline always shuts down exactly the owned process before drain', async () => {
  const f = await fixture(); assert.equal(f.result.outcome, 'passed'); assert.equal(f.now, 30000); assert.equal(f.starts, 1); assert.equal(f.shutdowns, 1); assert.equal(f.timers.size, 0); assert.ok(f.calls.indexOf('shutdown-owned') < f.calls.indexOf('drain-owned'));
});
await test('preflight failure does not prepare config or spawn', async () => {
  const f = await fixture('bad-baseline'); assert.ok(f.error); assert.equal(f.prepared, false); assert.equal(f.starts, 0); assert.equal(f.shutdowns, 0);
});
await test('startup and read hangs still reach the 30-second owned shutdown', async () => {
  for (const mode of ['startup-hang', 'read-hang']) { const f = await fixture(mode); assert.equal(f.shutdowns, 1); assert.equal(f.now, 30000); assert.equal(f.result.outcome, 'failed'); }
});
await test('cancel, early exit, policy change and start failure stop without success claims', async () => {
  for (const mode of ['cancel', 'early-exit', 'policy-change', 'startup-error']) { const f = await fixture(mode); assert.equal(f.shutdowns, 1); assert.equal(f.result.outcome, 'failed'); assert.ok(f.now < 30000); }
});
await test('cleanup errors/forced exits never claim success', async () => {
  for (const mode of ['forced', 'cleanup-error']) { const f = await fixture(mode); assert.equal(f.result.outcome, 'failed'); }
});
await test('10-second residual observation has its own hard deadline, including a stalled read', async () => {
  const f = await fixture('residual-hang'); assert.equal(f.now, 40000); assert.equal(f.result.outcome, 'failed'); assert.equal(f.timers.size, 0);
});
await test('entry point is opt-in, snapshot contains no OS mutation commands', () => {
  const runner = fs.readFileSync(new URL('./run-owned-tun-trial.mjs', import.meta.url), 'utf8');
  assert.ok(runner.indexOf('validateApproval(process.argv.slice(2))') < runner.indexOf('new EasyTierWindowsProcesses(15897)'));
  const snapshot = fs.readFileSync(new URL('./owned-tun-trial-snapshot.ps1', import.meta.url), 'utf8');
  assert.ok(!/\b(?:Start-Process|Stop-Process|New-Net\w*|Set-Net\w*|Remove-Net\w*|Enable-Net\w*|Disable-Net\w*|netsh|pnputil|WintunCreateAdapter)\b/i.test(snapshot));
});
console.log(`${tests} pure trial checks passed; no candidate, driver, UAC, socket or OS snapshot executed`);
