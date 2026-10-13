import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {PassThrough, Writable} from 'node:stream';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url), ts = require('typescript');
function fixture() {
  const children = [], writes = [], binary = Buffer.from('synthetic-broker-not-executable');
  const receipt = {schemaVersion: 1, bytes: binary.length, sha256: require('node:crypto').createHash('sha256').update(binary).digest('hex')};
  class FakeChild extends EventEmitter {
    pid = 321; exitCode = null; signalCode = null; stdout = new PassThrough();
    stdin = new Writable({write(chunk, _encoding, done) { writes.push(chunk.toString()); done(); }});
    kill() { if (this.signalCode) return true; this.signalCode = 'SIGTERM'; this.emit('exit', null, 'SIGTERM'); return true; }
  }
  const module = {exports: {}};
  const code = ts.transpileModule(readFileSync(new URL('./easyTierElevationBroker.ts', import.meta.url), 'utf8'), {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
  }).outputText;
  vm.runInThisContext('(function(require,module,exports,process){' + code + '\n})')(name => {
    if (name === 'node:child_process') return {spawn(_binary, args, options) {
      assert.deepEqual(args, ['--parent', String(process.pid)]); assert.equal(options.shell, false);
      const child = new FakeChild(); children.push(child);
      queueMicrotask(() => child.stdout.write('LAOKUAI_BROKER_READY_V1\n')); return child;
    }};
    if (name === 'node:fs/promises') return {stat: async () => ({size: binary.length}),
      readFile: async path => path.endsWith('.json') ? JSON.stringify(receipt) : binary};
    if (name === './easyTierCommunityManager') return {EasyTierOperationError: class extends Error {}};
    assert.ok(['node:crypto', 'node:events', 'node:path', 'node:stream'].includes(name)); return require(name);
  }, module, module.exports, {platform: 'win32', pid: process.pid});
  return {broker: new module.exports.EasyTierElevationBroker(() => 'C:/fixture'), children, writes, receipt};
}
test('permission requests coalesce; sequential native sessions use one app-session broker', async () => {
  const f = fixture(); assert.deepEqual(await Promise.all([f.broker.prepare(), f.broker.prepare()]), [true, true]);
  assert.equal(f.children.length, 1);
  const child = f.children[0], first = f.broker.take(), lines = [];
  first.stdout.on('data', bytes => lines.push(bytes.toString())); let exit;
  first.once('exit', code => {exit = code;}); first.stdin.write('synthetic-request\n');
  child.stdout.write('LAOKUAI_BROKER_STARTED_V1 456\n'); assert.equal(first.pid, 456);
  assert.throws(() => f.broker.take());
  first.stdin.end('LAOKUAI_OWNED_STOP_V1\n');
  child.stdout.write('LAOKUAI_OWNED_STOPPED_V1\nLAOKUAI_BROKER_FINISHED_V1 0\n');
  assert.equal(exit, 0); assert.ok(lines.includes('LAOKUAI_OWNED_STOPPED_V1\n'));
  assert.equal(await f.broker.prepare(), true); const second = f.broker.take(); assert.notEqual(second, first);
  assert.equal(f.children.length, 1, 'reconnect must not display a second UAC prompt');
  child.stdout.write('LAOKUAI_BROKER_FINISHED_V1 0\n'); f.broker.releasePreparation();
  assert.equal(f.broker.available(), false); assert.equal(child.signalCode, 'SIGTERM');
});
test('a broker exit retires the exact active logical process', async () => {
  const f = fixture(); await f.broker.prepare(); const core = f.broker.take(); let exit;
  core.once('exit', (_code, signal) => {exit = signal;}); core.kill();
  assert.equal(exit, 'SIGTERM'); assert.equal(f.broker.available(), false);
});
test('release after a cancelled permission preparation cannot leak a launcher', async () => {
  const f = fixture(), pending = f.broker.prepare(); f.broker.releasePreparation();
  assert.equal(await pending, false); assert.equal(f.children.length, 0);
});
test('tampered helper bytes are rejected before any process launch', async () => {
  const f = fixture(); f.receipt.sha256 = '0'.repeat(64);
  await assert.rejects(f.broker.prepare()); assert.equal(f.children.length, 0);
});
