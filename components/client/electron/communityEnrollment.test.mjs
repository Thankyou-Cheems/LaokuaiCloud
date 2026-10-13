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
    assert.ok(name.startsWith('./')); return load(new URL(name + '.ts', url));
  }, module, module.exports);
  return module.exports;
}
const {CommunityEnrollment} = load(new URL('./communityEnrollment.ts', import.meta.url));
const {EasyTierCommunityManager} = load(new URL('./easyTierCommunityManager.ts', import.meta.url));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
const member = {serverId: 'community', host: 'voice.test.invalid', accessToken: 'fixture-only'};
const snapshot = (members = [member], enabled = true, retry) => ({members, enabled, ...(retry ? {retry} : {})});
function fixture() {
  const calls = []; let auth = null, approval = async () => ({accepted: true}), authHook = async () => {};
  const manager = new EasyTierCommunityManager({activationReason: () => null, shutdownOwned() {},
    connect: async ({serverId}) => {
      assert.ok(auth, 'no native start before verified membership'); calls.push('connect:' + serverId);
      return {instanceId: 'fixture-instance', read() { throw Error('not-polled'); }, close: async () => {calls.push('close');}};
    }}, () => {}, () => 0, 1000);
  const enrollment = new CommunityEnrollment({manager, supports: m => m.host === member.host,
    approve: async id => {calls.push('approve:' + id); return approval();},
    authenticate: async m => {
      calls.push(m.accessToken === null ? 'clear-auth' : 'auth:' + m.accessToken);
      const changed = auth !== m.accessToken; auth = m.accessToken; await authHook(m); return {changed};
    }, releasePreparation: () => calls.push('release')});
  return {enrollment, manager, calls, approval: f => {approval = f;}, authHook: f => {authHook = f;}};
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
