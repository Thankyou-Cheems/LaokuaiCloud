import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const root = path.resolve(import.meta.dirname, '..');
function load(file, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {exports, require: name => imports[name] ?? process.getBuiltinModule(name), Buffer, setInterval, clearInterval, Date});
  return exports;
}
const schema = load('src/lib/localDiagnostics.ts');
const event = {phase: 'socket', operation: 'server:error', action: 'receive', code: 'rate_limited', retryAfterMs: 1000};
assert.ok(schema.safeDiagnostic(event));
for (const extra of [{token: 'secret'}, {payload: {}}, {host: 'identity'}, {retryAfterMs: Infinity}, {code: 'raw-secret'}, {phase: 'private'}]) assert.equal(schema.safeDiagnostic({...event, ...extra}), null);
const ioErrors = [];
const checkedFs = Object.fromEntries(['appendFileSync', 'existsSync', 'mkdirSync', 'renameSync', 'rmSync', 'statSync'].map(name => [name, (...args) => {try {return fs[name](...args);} catch (error) {ioErrors.push({operation: name, code: error.code}); throw error;}}]));
const {LocalDiagnosticWriter} = load('electron/localDiagnostics.ts', {'../src/lib/localDiagnostics': schema, 'node:fs': checkedFs});
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'laokuai-diagnostics-test-'));
const writer = new LocalDiagnosticWriter(dir, 1024);
try {
  writer.record(event); writer.record({...event, retryAfterMs: 900}); writer.record({...event, token: 'must-never-persist'}); writer.flush();
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'));
  assert.equal(record.count, 2); assert.equal(record.event.retryAfterMs, 900);
  for (let i = 0; i < 50; i++) {writer.record({...event, elapsedMs: i}); writer.flush();}
  assert.deepEqual(ioErrors, []);
  const files = fs.readdirSync(dir); assert.equal(files.length, 3);
  for (const name of files) {assert.ok(/^events(?:\.[12])?\.jsonl$/.test(name)); assert.ok(fs.statSync(path.join(dir, name)).size <= 1024); assert.ok(!fs.readFileSync(path.join(dir, name), 'utf8').includes('secret'));}
  console.log('PASS: fixed schema, secret rejection, repeat aggregation, bounded three-file rotation');
} finally {writer.close(); fs.rmSync(dir, {recursive: true});}
