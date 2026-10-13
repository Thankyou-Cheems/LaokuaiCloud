import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import {setImmediate} from 'node:timers';
import vm from 'node:vm';

const require = createRequire(import.meta.url), ts = require('typescript'), cache = new Map();
const denied = () => { throw new Error('native-and-network-forbidden'); };
function load(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  const mod = {exports: {}}; cache.set(url.href, mod.exports);
  const code = ts.transpileModule(readFileSync(url, 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
  const local = name => {
    if (['node:crypto', 'node:path'].includes(name)) return require(name);
    if (name === 'node:https') return {request: denied};
    if (name === 'node:net') return {createServer: denied};
    if (name === 'node:dgram') return {createSocket: denied};
    if (name === 'node:child_process') return {execFile: denied, spawn: denied};
    if (name === 'node:fs/promises') return new Proxy({}, {get: () => denied});
    assert.ok(name.startsWith('./') || name.startsWith('../src/lib/'));
    return load(new URL(name + '.ts', url));
  };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', {filename: url.pathname})(local, mod, mod.exports);
  return mod.exports;
}
const {CommunityRelayRuntime, parseRelayResponse, parseRelayBudgetReceipt, parseRelayPreference} = load(new URL('./communityRelayRuntime.ts', import.meta.url));
const {easyTierCliRelayArguments} = load(new URL('./easyTierWindowsProcesses.ts', import.meta.url));
const {grantShape} = load(new URL('./communityEtGrant.ts', import.meta.url));
const UUID = '11111111-1111-4111-8111-111111111111', clone = structuredClone;
function fixture(stored = null) {
  const now = {mono: 10000, wall: 2000000}, calls = [], budgets = [], saved = [];
  const intent = {serverInstanceId: 'backend', accountId: 'account', communityId: 'community', deviceId: 'device', nativeInstanceId: UUID,
    networkName: 'network', networkRevision: 1, virtualIp: '10.77.1.2', bootstrapProfileId: 'bootstrap'};
  const scope = Object.fromEntries(['serverInstanceId', 'accountId', 'communityId', 'deviceId', 'nativeInstanceId'].map(k => [k, intent[k]]));
  let grant = {v: 1, requestId: 'initial', scope, grantId: 'grant', credentialId: 'credential', revision: 1,
    networkName: 'network', networkRevision: 1, virtualIp: '10.77.1.2', bootstrapProfileId: 'bootstrap', issuedAtMs: now.wall,
    serverTimeMs: now.wall, renewAfterMs: now.wall + 30000, expiresAtMs: now.wall + 60000,
    publicKeyFingerprint: 'a'.repeat(64), credentialSecretB64: Buffer.alloc(32, 7).toString('base64'),
    policy: {reusable: false, allowRelay: false, allowedProxyCidrs: []}};
  let backend = clone(grant), consent = {v: 2, enabled: false, revision: 0, bytesPerSecond: 0};
  let confirmed = clone(consent), gateEnabled = true, replyMutator = null, postHook = null, nativeHook = null;
  const receipt = (budget, lease) => ({schemaVersion: 1, capability: 'member-relay-budget-lease-v1', instanceId: UUID,
    bytesPerSec: budget, leaseRemainingMs: lease, maxLeaseMs: 15000, applied: true});
  const apply = async (budget, lease, signal) => { budgets.push([budget, lease]); return nativeHook ? nativeHook(budget, lease, signal) : receipt(budget, lease); };
  const ports = {serverId: 'community', intent, grant: () => clone(grant), wallMs: () => now.wall, monoMs: () => now.mono,
    save: p => saved.push(clone(p)), accept: g => { grantShape(g); grant = clone(g); },
    post: async (op, body, signal) => {
      calls.push({op, body: clone(body)});
      if (postHook) await postHook(op, body, signal);
      if (op === 'relay') {
        assert.equal(body.expectedConsentRevision, consent.revision);
        consent = {v: 2, enabled: body.enabled, revision: consent.revision + 1, bytesPerSecond: body.bytesPerSecond};
        confirmed = gateEnabled ? clone(consent) : {...consent, enabled: false, bytesPerSecond: 0};
        backend.revision++;
      } else if (op === 'relay-renew') {
        confirmed = gateEnabled ? clone(consent) : {...consent, enabled: false, bytesPerSecond: 0};
        backend.revision++; backend.issuedAtMs = now.wall; backend.renewAfterMs = now.wall + 30000; backend.expiresAtMs = now.wall + 60000;
      }
      const result = {v: 2, consent: clone(consent), grant: {...clone(backend), v: 2, requestId: body.requestId, serverTimeMs: now.wall,
        policy: {reusable: false, allowRelay: confirmed.enabled, allowedProxyCidrs: [], relay: clone(confirmed)}}};
      replyMutator?.(result); return result;
    }};
  const controller = new CommunityRelayRuntime(ports, stored);
  return {controller, ports, now, calls, budgets, saved, apply, receipt, intent, grant: () => clone(grant),
    response: () => ({v: 2, consent: clone(consent), grant: {...clone(backend), v: 2, requestId: 'request', serverTimeMs: now.wall,
      policy: {reusable: false, allowRelay: confirmed.enabled, allowedProxyCidrs: [], relay: clone(confirmed)}}}),
    setGate: value => gateEnabled = value, mutate: value => replyMutator = value, postHook: value => postHook = value, nativeHook: value => nativeHook = value,
    sample: () => controller.observe(now.mono, now.wall, new AbortController().signal),
    advance: ms => { now.mono += ms; now.wall += ms; }};
}
test('default attach confirms zero; no consent causes no backend request or positive budget', async () => {
  const f = fixture(); await f.controller.attach(f.apply); await f.sample();
  assert.deepEqual(f.budgets, [[0, 0]]); assert.equal(f.calls.length, 0); assert.equal(f.controller.snapshot().status, 'off'); await f.controller.detach();
});
test('persisted explicit scope consent still requires zero, fresh sample, server qualification and native readback', async () => {
  const f = fixture({enabled: true, bytesPerSecond: 32000});
  assert.equal(f.controller.snapshot().localBudgetApplied, false); await f.controller.attach(f.apply);
  assert.deepEqual(f.budgets, [[0, 0]]); await f.sample();
  assert.deepEqual(f.calls.map(c => c.op), ['relay-status', 'relay']); assert.deepEqual(f.budgets.at(-1), [32000, 10000]);
  const state = f.controller.snapshot(); assert.equal(state.status, 'active'); assert.equal(state.confirmedEnabled, true);
  assert.equal(JSON.stringify(state).includes(f.grant().credentialSecretB64), false);
  assert.equal(f.grant().policy.allowRelay, false); await f.controller.detach();
});
test('renew only after new fresh sample; polling public state cannot renew', async () => {
  const f = fixture({enabled: true, bytesPerSecond: 32000}); await f.controller.attach(f.apply); await f.sample();
  f.advance(1000); for (let i = 0; i < 20; i++) f.controller.snapshot(); await f.sample();
  assert.equal(f.calls.length, 2); f.advance(3000); await f.sample();
  assert.deepEqual(f.calls.map(c => c.op), ['relay-status', 'relay', 'relay-status', 'relay-renew']);
  assert.equal(f.grant().revision, 3); await f.controller.detach();
});
test('telemetry failure immediately zeros budget and never owns LAN/core close', async () => {
  const f = fixture({enabled: true, bytesPerSecond: 32000}); await f.controller.attach(f.apply); await f.sample(); await f.controller.suspend();
  assert.deepEqual(f.budgets.at(-1), [0, 0]); assert.equal(f.controller.snapshot().status, 'suspended'); await f.controller.detach();
});
test('disabled deployment gate is reported unavailable and cannot get positive budget', async () => {
  const f = fixture({enabled: true, bytesPerSecond: 32000}); f.setGate(false); await f.controller.attach(f.apply); await f.sample();
  assert.equal(f.controller.snapshot().status, 'unavailable'); assert.ok(f.budgets.every(([b]) => b === 0)); await f.controller.detach();
});
test('old native rejection remains native-unsupported without contacting backend', async () => {
  const f = fixture({enabled: true, bytesPerSecond: 32000}); f.nativeHook(async () => { throw Error('unknown command'); });
  await f.controller.attach(f.apply); await f.sample(); assert.equal(f.controller.snapshot().reason, 'native-unsupported'); assert.equal(f.calls.length, 0); await f.controller.detach();
});
test('old backend is unavailable, never a fallback to unbounded native relay', async () => {
  const f = fixture({enabled: true, bytesPerSecond: 32000}); f.postHook(async () => { throw Error('404'); });
  await f.controller.attach(f.apply); await f.sample(); assert.equal(f.controller.snapshot().reason, 'backend-unavailable');
  assert.ok(f.budgets.every(([b]) => b === 0)); await f.controller.detach();
});
test('server malformed response zeros local budget instead of accepting changed IP/key', async () => {
  const f = fixture({enabled: true, bytesPerSecond: 32000}); f.mutate(r => r.grant.virtualIp = '10.77.1.3');
  await f.controller.attach(f.apply); await f.sample(); assert.equal(f.controller.snapshot().reason, 'grant-mismatch'); assert.ok(f.budgets.every(([b]) => b === 0)); await f.controller.detach();
});
test('clock rollback and monotonic expiry invalidate public readiness and issue zero', async () => {
  for (const change of [f => f.advance(5000), f => f.now.wall--, f => f.now.mono = 9999]) {
    const f = fixture({enabled: true, bytesPerSecond: 32000}); await f.controller.attach(f.apply); await f.sample(); change(f);
    assert.equal(f.controller.snapshot().localBudgetApplied, false); await f.controller.detach(); assert.deepEqual(f.budgets.at(-1), [0, 0]);
  }
});
test('stale/future sample cannot request qualification', async () => {
  const f = fixture({enabled: true, bytesPerSecond: 32000}); await f.controller.attach(f.apply);
  for (const [mono, wall] of [[5000, 2000000], [10001, 2000000], [10000, 2000001], [10000, 1995000]])
    await f.controller.observe(mono, wall, new AbortController().signal);
  assert.equal(f.calls.length, 0); assert.ok(f.budgets.every(([b]) => b === 0)); await f.controller.detach();
});
test('disable invalidates late backend enable and immediately confirms zero', async () => {
  const f = fixture({enabled: true, bytesPerSecond: 32000}); let release, entered;
  const started = new Promise(r => entered = r), pending = new Promise(r => release = r);
  f.postHook(async op => { if (op === 'relay') { entered(); await pending; } });
  await f.controller.attach(f.apply); const sample = f.sample(); await started;
  await f.controller.set({enabled: false, bytesPerSecond: 0}); release(); await sample;
  assert.equal(f.controller.snapshot().desiredEnabled, false); assert.equal(f.controller.snapshot().localBudgetApplied, false);
  assert.ok(f.budgets.every(([b]) => b === 0)); f.postHook(null); await f.sample();
  assert.equal(f.controller.snapshot().status, 'off'); assert.equal(f.calls.at(-1).body.enabled, false); await f.controller.detach();
});
test('disable queues zero after in-flight native positive ACK and late ACK never marks active', async () => {
  const f = fixture({enabled: true, bytesPerSecond: 32000}); let release, entered;
  const started = new Promise(r => entered = r), pending = new Promise(r => release = r);
  f.nativeHook(async (b, l) => { if (b) { entered(); await pending; } return f.receipt(b, l); });
  await f.controller.attach(f.apply); const sample = f.sample(); await started;
  const disabled = f.controller.set({enabled: false, bytesPerSecond: 0}); release(); await Promise.all([sample, disabled]);
  assert.deepEqual(f.budgets.at(-1), [0, 0]); assert.equal(f.controller.snapshot().status, 'off'); await f.controller.detach();
});
test('positive native readback mismatch fails closed', async () => {
  const f = fixture({enabled: true, bytesPerSecond: 32000}); f.nativeHook(async (b, l) => ({...f.receipt(b, l), bytesPerSec: 0}));
  await f.controller.attach(f.apply); await f.sample(); assert.equal(f.controller.snapshot().localBudgetApplied, false);
  assert.deepEqual(f.budgets.at(-1), [0, 0]); await f.controller.detach();
});
test('preference save is explicit and bounded; malformed renderer fields are rejected', () => {
  for (const value of [{v: 1, serverId: 'community', enabled: true, bytesPerSecond: 0}, {v: 1, serverId: 'community', enabled: false, bytesPerSecond: 32000},
    {v: 1, serverId: 'community', enabled: true, bytesPerSecond: 1048577}, {v: 1, serverId: 'community', enabled: true, bytesPerSecond: 32000, accountId: 'other'}])
    assert.throws(() => parseRelayPreference(value));
});
for (const [name, mutate] of [
  ['scope', r => r.grant.scope.accountId = 'other'], ['secret', r => r.grant.credentialSecretB64 = Buffer.alloc(32, 3).toString('base64')],
  ['grant ID', r => r.grant.grantId = 'other'], ['fingerprint', r => r.grant.publicKeyFingerprint = 'b'.repeat(64)],
  ['IP', r => r.grant.virtualIp = '10.77.1.3'], ['expiry', r => r.grant.expiresAtMs = r.grant.serverTimeMs],
  ['proxy', r => r.grant.policy.allowedProxyCidrs = ['0.0.0.0/0']], ['policy mismatch', r => r.grant.policy.allowRelay = true],
  ['extra', r => r.extra = true], ['nonce', r => r.grant.requestId = 'other'], ['stale revision', r => r.grant.revision = 0],
  ['accessor', r => Object.defineProperty(r, 'consent', {get: denied, enumerable: true})],
]) test('strict V2 envelope rejects ' + name, () => {
  const f = fixture(), r = f.response(); mutate(r);
  assert.throws(() => parseRelayResponse(r, f.grant(), f.intent, 'request', 10000, f.now.wall, f.now.mono));
});
test('valid pending desired/confirmed divergence never fabricates current consent qualification', () => {
  const f = fixture(), r = f.response(); r.consent = {v: 2, enabled: true, revision: 1, bytesPerSecond: 32000};
  const result = parseRelayResponse(r, f.grant(), f.intent, 'request', 10000, f.now.wall, f.now.mono);
  assert.equal(result.consent.enabled, true); assert.equal(result.confirmed.enabled, false); assert.equal(result.grant.policy.allowRelay, false);
});
test('native argv is exact UUID-only loopback and never fans out or injects config', () => {
  assert.deepEqual(easyTierCliRelayArguments(UUID, '127.0.0.1:15353', 32000, 10000), ['--rpc-portal', '127.0.0.1:15353', '--instance-id', UUID,
    '--output', 'json', 'member-relay', 'apply', '--bytes-per-sec', '32000', '--lease-ms', '10000']);
  for (const args of [['all', '127.0.0.1:15353', 32000, 10000], [UUID, '0.0.0.0:15353', 32000, 10000], [UUID, '127.0.0.1:65536', 32000, 10000],
    [UUID, '127.0.0.1:15353', 32000, 15001], [UUID, '127.0.0.1:15353', 0, 10000]]) assert.throws(() => easyTierCliRelayArguments(...args));
});
test('native capability DTO rejects missing lease support, false ACK, stale or unrelated instance', () => {
  const f = fixture(), base = f.receipt(32000, 10000);
  for (const mutate of [r => delete r.leaseRemainingMs, r => r.applied = false, r => r.instanceId = 'other', r => r.leaseRemainingMs = 0,
    r => r.leaseRemainingMs = 10001, r => r.bytesPerSec = null, r => r.maxLeaseMs = 60000, r => r.config = 'private']) {
    const r = clone(base); mutate(r); assert.throws(() => parseRelayBudgetReceipt(r, UUID, 32000, 10000));
  }
});
test('optional backend timeout zeros budget and settles without replacing LAN authorization', async () => {
  const f = fixture({enabled: true, bytesPerSecond: 32000});
  f.postHook((_op, _body, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('cancelled')), {once: true})));
  await f.controller.attach(f.apply); await f.sample();
  assert.equal(f.controller.snapshot().reason, 'backend-unavailable'); assert.equal(f.grant().revision, 1);
  assert.ok(f.budgets.every(([budget]) => budget === 0)); await f.controller.detach();
});
test('native abort deadline cannot claim applied; positive timeout is followed by zero', async () => {
  const f = fixture({enabled: true, bytesPerSecond: 32000});
  f.nativeHook((budget, lease, signal) => budget === 0 ? Promise.resolve(f.receipt(budget, lease)) :
    new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('native-cancelled')), {once: true})));
  await f.controller.attach(f.apply); await f.sample();
  assert.equal(f.controller.snapshot().localBudgetApplied, false); assert.deepEqual(f.budgets.at(-1), [0, 0]); await f.controller.detach();
});
test('explicit disable withdraws backend immediately without requiring another ET sample', async () => {
  const f = fixture({enabled: true, bytesPerSecond: 32000}); await f.controller.attach(f.apply); await f.sample();
  f.advance(6000); await f.controller.set({enabled: false, bytesPerSecond: 0});
  assert.equal(f.response().consent.enabled, false); assert.equal(f.calls.at(-1).body.enabled, false);
  assert.deepEqual(f.budgets.at(-1), [0, 0]); await f.controller.detach();
});
test('failed withdrawal retains false intent and retries without telemetry', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const f = fixture({enabled: true, bytesPerSecond: 32000}); await f.controller.attach(f.apply); await f.sample();
  f.postHook(async () => {throw Error('backend-offline');}); await f.controller.set({enabled: false, bytesPerSecond: 0});
  assert.equal(f.controller.snapshot().desiredEnabled, false); assert.equal(f.response().consent.enabled, true);
  f.postHook(null); f.advance(5000); t.mock.timers.tick(5000);
  await new Promise(setImmediate); await new Promise(setImmediate);
  assert.equal(f.response().consent.enabled, false); assert.ok(f.budgets.slice(2).every(([budget]) => budget === 0)); await f.controller.detach();
});
test('late backend renewal after disable is reconciled and cannot revive native lease', async () => {
  const f = fixture({enabled: true, bytesPerSecond: 32000}); await f.controller.attach(f.apply); await f.sample(); f.advance(4000);
  let release, entered; const started = new Promise(r => entered = r), pending = new Promise(r => release = r);
  f.postHook(async op => {if (op === 'relay-renew') {entered(); await pending;}});
  const renewal = f.sample(); await started; await f.controller.set({enabled: false, bytesPerSecond: 0}); release(); await renewal;
  assert.equal(f.response().consent.enabled, false); assert.equal(f.controller.snapshot().localBudgetApplied, false);
  assert.deepEqual(f.budgets.at(-1), [0, 0]); await f.controller.detach();
});
test('storage failure never authorizes enable and cannot prevent live withdrawal', async () => {
  const f = fixture(); await f.controller.attach(f.apply);
  f.ports.save = () => {throw Error('disk-unavailable');};
  await assert.rejects(f.controller.set({enabled: true, bytesPerSecond: 32000}));
  assert.equal(f.controller.snapshot().desiredEnabled, false); assert.equal(f.calls.length, 0);
  f.ports.save = () => undefined; await f.controller.set({enabled: true, bytesPerSecond: 32000}); await f.sample();
  f.ports.save = () => {throw Error('disk-unavailable');};
  await assert.rejects(f.controller.set({enabled: false, bytesPerSecond: 0}));
  assert.equal(f.controller.snapshot().desiredEnabled, false); assert.equal(f.response().consent.enabled, false);
  assert.deepEqual(f.budgets.at(-1), [0, 0]); await f.controller.detach();
});
