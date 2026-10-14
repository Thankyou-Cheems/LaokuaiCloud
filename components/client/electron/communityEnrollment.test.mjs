import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url), ts = require('typescript'), cache = new Map();
function load(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  const module = {exports: {}}; cache.set(url.href, module.exports);
  const code = ts.transpileModule(readFileSync(url, 'utf8'), {compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }}).outputText;
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', {filename: url.pathname})(name => {
    if (name === 'node:https') return {request() { throw Error('network-forbidden'); }};
    if (name.startsWith('node:')) { assert.ok(['node:crypto'].includes(name)); return require(name); }
    assert.ok(name.startsWith('./') || name === '../src/lib/communityDnsNames'); return load(new URL(name + '.ts', url));
  }, module, module.exports);
  return module.exports;
}
const {CommunityEnrollment} = load(new URL('./communityEnrollment.ts', import.meta.url));
const {EasyTierCommunityManager, EasyTierSessionRetiredError} = load(new URL('./easyTierCommunityManager.ts', import.meta.url));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
const member = {serverId: 'community', host: 'voice.test.invalid', accessToken: 'fixture-only'};
const snapshot = (members = [member], enabled = true, retry) => ({members, enabled, ...(retry ? {retry} : {})});
function fixture() {
  const calls = [], timers = []; let auth = null, ready = true, retired = false, readFailure = null, approval = async () => ({accepted: true}), authHook = async () => {};
  const manager = new EasyTierCommunityManager({activationReason: () => null, shutdownOwned() {},
    connect: async ({serverId, generation}) => {
      assert.ok(auth, 'no native start before verified membership'); calls.push('connect:' + serverId);
      return {instanceId: 'fixture-instance', read: async () => {
        if (readFailure) {
          if (readFailure instanceof EasyTierSessionRetiredError) retired = true;
          throw readFailure;
        }
        return {serverId, generation, instanceId: 'fixture-instance', acquiredAtMs: 0, acquiredAtUnixMs: Date.now(),
          freshRpc: true, latencyFirst: false, info: {running: true}, bindings: []};
      }, close: async () => {calls.push('close');}};
    }}, state => enrollment.observe(state), () => 0, 1000);
  const enrollment = new CommunityEnrollment({manager, supports: m => m.host === member.host,
    approve: async id => {calls.push('approve:' + id); const result = await approval(); ready = result.accepted; return result;},
    authenticate: async m => {
      calls.push(m.accessToken === null ? 'clear-auth' : 'auth:' + m.accessToken);
      const changed = retired || auth !== m.accessToken; auth = m.accessToken; await authHook(m); retired = false; return {changed};
    }, releasePreparation: () => calls.push('release'), preparationReady: () => ready,
    schedule: (work, delayMs) => {const timer = {work, delayMs, cancelled: false}; timers.push(timer); return () => {timer.cancelled = true;};}});
  return {enrollment, manager, calls, timers, loseBroker: () => {ready = false;}, failRead: error => {readFailure = error;}, recoverRead: () => {readFailure = null;}, approval: f => {approval = f;}, authHook: f => {authHook = f;},
    retry: async () => {const timer = timers.find(t => !t.cancelled); assert.ok(timer); timer.cancelled = true; timer.work(); await tick();}};
}
test('fresh and restored members enroll automatically without room or toggle input', async () => {
  for (let boot = 0; boot < 2; boot++) {
    const f = fixture(); const states = await f.enrollment.reconcile(snapshot());
    assert.equal(states[0].phase, 'connected');
    assert.deepEqual(f.calls, ['approve:community', 'auth:fixture-only', 'connect:community']);
    await f.enrollment.reconcile(snapshot());
    assert.equal(f.calls.filter(x => x.startsWith('approve')).length, 1);
    assert.equal(f.calls.filter(x => x.startsWith('connect')).length, 1);
    await f.enrollment.reconcile(snapshot([]));
    assert.ok(f.calls.includes('close')); assert.ok(f.calls.includes('clear-auth')); assert.ok(f.calls.includes('release'));
  }
});
test('bearer rotation authenticates before replacement; no repeated consent', async () => {
  const f = fixture(); await f.enrollment.reconcile(snapshot());
  await f.enrollment.reconcile(snapshot([{...member, accessToken: 'fixture-rotated'}]));
  assert.deepEqual(f.calls, ['approve:community', 'auth:fixture-only', 'connect:community', 'auth:fixture-rotated', 'close', 'connect:community']);
});
test('declining prompts once; an explicit retry can approve', async () => {
  const f = fixture(); f.approval(async () => ({accepted: false}));
  assert.equal((await f.enrollment.reconcile(snapshot()))[0].reason, 'needs-permission');
  await f.enrollment.reconcile(snapshot());
  assert.equal(f.calls.filter(x => x.startsWith('approve')).length, 1);
  assert.equal(f.calls.some(x => x.startsWith('auth:')), false);
  f.approval(async () => ({accepted: true}));
  assert.equal((await f.enrollment.reconcile(snapshot([member], true, member.serverId)))[0].phase, 'connected');
});
test('removing membership during a permission prompt never starts auth or a core', async () => {
  const f = fixture(), gate = deferred(); f.approval(() => gate.promise);
  const first = f.enrollment.reconcile(snapshot()); await tick();
  const removal = f.enrollment.reconcile(snapshot([])); gate.resolve({accepted: true});
  await Promise.all([first, removal]);
  assert.equal(f.calls.some(x => x.startsWith('auth:') || x.startsWith('connect:')), false);
  assert.ok(f.calls.includes('release'));
});
test('removal immediately retires an in-flight authentication', async () => {
  const f = fixture(), gate = deferred(); f.authHook(m => m.accessToken ? gate.promise : Promise.resolve());
  const first = f.enrollment.reconcile(snapshot()); await tick();
  const removal = f.enrollment.reconcile(snapshot([]));
  assert.ok(f.calls.includes('clear-auth')); gate.resolve(); await Promise.all([first, removal]);
  assert.equal(f.calls.some(x => x.startsWith('connect:')), false);
});
test('user disable while permission is pending cancels enrollment', async () => {
  const f = fixture(), gate = deferred(); f.approval(() => gate.promise);
  const first = f.enrollment.reconcile(snapshot()); await tick();
  const disabled = f.enrollment.reconcile(snapshot([member], false)); gate.resolve({accepted: true});
  await Promise.all([first, disabled]); assert.equal(f.calls.some(x => x.startsWith('connect:')), false);
});
test('shutdown during permission preparation cannot acquire membership', async () => {
  const f = fixture(), gate = deferred(); f.approval(() => gate.promise);
  const first = f.enrollment.reconcile(snapshot()); await tick(); f.enrollment.shutdown();
  gate.resolve({accepted: true}); await first;
  assert.equal(f.calls.some(x => x.startsWith('auth:') || x.startsWith('connect:')), false);
});
test('unsupported hosts and pending tokens do not prompt or enroll', async () => {
  const f = fixture(); await f.enrollment.reconcile(snapshot([{...member, host: 'other.invalid'}]));
  await f.enrollment.reconcile(snapshot([{...member, accessToken: null}]));
  assert.equal(f.calls.some(x => x.startsWith('approve')), false);
});
test('malformed IPC snapshot is rejected before side effects', () => {
  const f = fixture();
  for (const value of [null, {}, {...snapshot(), extra: true}, snapshot([member, member]), snapshot([{...member, accessToken: 'bad token'}])])
    assert.throws(() => f.enrollment.reconcile(value));
  assert.deepEqual(f.calls, []);
});

test('owned core exit revalidates the same saved token and automatically reconnects', async () => {
  const f = fixture(); await f.enrollment.reconcile(snapshot()); await tick();
  f.failRead(new EasyTierSessionRetiredError('runtime-exited'));
  await f.manager.refresh(member.serverId);
  assert.equal(f.manager.getState(member.serverId).phase, 'error');
  assert.equal(f.timers[0].delayMs, 5000);
  f.recoverRead();
  await f.retry();
  assert.equal(f.manager.getState(member.serverId).phase, 'connected');
  assert.equal(f.calls.filter(x => x.startsWith('auth:')).length, 2);
  assert.equal(f.calls.filter(x => x.startsWith('connect:')).length, 2);
  assert.equal(f.calls.filter(x => x.startsWith('approve:')).length, 1);
});
test('status-unavailable keeps telemetry retries separate from membership recovery', async () => {
  const f = fixture(); await f.enrollment.reconcile(snapshot()); await tick();
  f.failRead(Error('status unavailable')); await f.manager.refresh(member.serverId);
  assert.equal(f.manager.getState(member.serverId).reason, 'status-unavailable');
  assert.equal(f.timers.filter(t => !t.cancelled).length, 0);
  for (let i = 0; i < 5; i++) {
    await f.manager.refresh(member.serverId);
    await f.enrollment.reconcile(snapshot());
  }
  assert.equal(f.manager.getState(member.serverId).phase, 'connected');
  assert.equal(f.calls.filter(x => x.startsWith('approve:')).length, 1);
  assert.equal(f.calls.filter(x => x.startsWith('connect:')).length, 1);
  assert.equal(f.calls.includes('close'), false);
});
test('lost permission broker is prepared again, but a refusal stops automatic prompts', async () => {
  const f = fixture(); await f.enrollment.reconcile(snapshot()); await tick(); f.loseBroker();
  f.failRead(new EasyTierSessionRetiredError('runtime-exited'));
  f.approval(async () => ({accepted: false})); await f.manager.refresh(member.serverId); await f.retry();
  await f.enrollment.reconcile(snapshot());
  assert.equal(f.calls.filter(x => x.startsWith('approve:')).length, 2);
  assert.equal(f.timers.filter(x => !x.cancelled).length, 0);
  assert.equal(f.calls.filter(x => x.startsWith('connect:')).length, 1);
});
test('temporary authentication failure retries with backoff and stops when membership disappears', async () => {
  const f = fixture(); f.authHook(async () => {throw Error('offline');});
  await assert.rejects(f.enrollment.reconcile(snapshot())); await f.retry();
  assert.deepEqual(f.timers.map(t => t.delayMs), [5000, 10000]);
  f.authHook(async () => {}); await f.enrollment.reconcile(snapshot([]));
  assert.equal(f.timers.filter(t => !t.cancelled).length, 0);
  assert.equal(f.calls.filter(x => x.startsWith('connect:')).length, 0);
});
test('shutdown cancels pending automatic recovery', async () => {
  const f = fixture(); await f.enrollment.reconcile(snapshot()); await tick();
  f.failRead(new EasyTierSessionRetiredError('runtime-exited')); await f.manager.refresh(member.serverId);
  assert.equal(f.timers.filter(t => !t.cancelled).length, 1);
  f.enrollment.shutdown(); assert.equal(f.timers.filter(t => !t.cancelled).length, 0);
});
