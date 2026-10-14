/* eslint-env node */
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
const {networkDiagnostic} = load('electron/networkDiagnostics.ts', {'../src/lib/localDiagnostics':schema});
assert.deepEqual(JSON.parse(JSON.stringify(networkDiagnostic({event:'state',action:'finish',generation:2,phase:'connected',code:'status-unavailable'}))),
  {phase:'lan',operation:'lan-state',action:'finish',code:'status-unavailable',generation:2,status:'connected',reason:null});
const pathEvent = {phase:'voice',operation:'hybrid-path',action:'finish',code:'ok',scopeGeneration:1,pathClass:'non-turn-candidate',pathReason:'selected-pair',localCandidateType:'host',remoteCandidateType:'srflx',underlayClass:'not-easytier',decodeProof:'fresh',decodeReason:'fresh_decode',failureReason:null};
assert.ok(schema.safeDiagnostic(pathEvent));
for (const extra of [{pathReason:'raw candidate'}, {localCandidateType:'10.0.0.1'}, {failureReason:'secret'}, {selectedPair:'private'}]) assert.equal(schema.safeDiagnostic({...pathEvent,...extra}),null);
assert.ok(schema.safeDiagnostic({phase:'voice',operation:'hybrid-forwarding',action:'finish',code:'ok',forwardingAction:'restore',result:'acknowledged',reason:'validated_ack'}));
const handoff = {phase:'voice',operation:'hybrid-handoff',action:'finish',code:'ok',handoffStage:'local_handoff_completed',reason:'local_handoff_before_pause',elapsedMs:24};
assert.ok(schema.safeDiagnostic(handoff));
const quit = {phase:'cleanup',operation:'app-quit',action:'finish',code:'ok',quitStage:'owned-core',elapsedMs:4000};
for (const quitStage of schema.QUIT_DIAGNOSTIC_STAGES) assert.ok(schema.safeDiagnostic({...quit,quitStage}));
for (const extra of [{quitStage:'private-host'}, {elapsedMs:Infinity}, {elapsedMs:-1}, {elapsedMs:3_600_001},
  {phase:'socket'}, {operation:'core-stop'}, {token:'secret'}, {exception:'raw-private-error'}]) assert.equal(schema.safeDiagnostic({...quit,...extra}),null);
for (const extra of [{handoffStage:'private-peer'}, {elapsedMs:Infinity}, {reason:'raw exception'}]) assert.equal(schema.safeDiagnostic({...handoff,...extra}),null);
assert.ok(schema.safeDiagnostic(networkDiagnostic({event:'http',action:'finish',operation:'binding',httpStatus:409,code:'provider-unavailable'})));
assert.equal(schema.safeDiagnostic(networkDiagnostic({event:'http',action:'finish',operation:'binding',httpStatus:409,code:'provider-unavailable',reason:'binding-pending'})).reason,'binding-pending');
assert.equal(schema.safeDiagnostic(networkDiagnostic({event:'http',action:'finish',operation:'binding',httpStatus:409,code:'provider-unavailable',reason:'raw-private-message'})),null);
assert.ok(schema.safeDiagnostic(networkDiagnostic({event:'core-stop',action:'finish',generation:3,code:'success'})));
const event = {phase: 'socket', operation: 'server:error', action: 'receive', code: 'rate_limited', retryAfterMs: 1000};
assert.ok(schema.safeDiagnostic(event));
const route = {phase:'voice', operation:'hybrid-route', action:'finish', code:'ok', status:'p2p',
  selected:'p2p', reason:null, scopeGeneration:2, routeOrdinal:1, routeGeneration:3, selectionRevision:4, forwardingPaused:true};
assert.ok(schema.safeDiagnostic(route), 'bounded voice routing observations must be accepted');
for (const reason of ['peer_path_inconsistent', 'invalid_receive_candidate', 'invalid_receive_node']) {
  assert.equal(schema.safeDiagnostic({...route, reason}).reason, reason, 'controller reason must reach disk schema');
}
for (const extra of [{reason:'token=private'}, {status:'raw SDP'}, {routeOrdinal:-1}, {forwardingPaused:'yes'}, {peerId:'private'}, {ip:'10.0.0.1'}])
  assert.equal(schema.safeDiagnostic({...route,...extra}), null);
assert.ok(schema.safeDiagnostic({phase:'lan',operation:'lan-telemetry',action:'finish',code:'provider-unavailable',httpStatus:409,generation:3}));
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
  writer.record(route); writer.record({...route,selected:'sfu',status:'recovering',forwardingPaused:false}); writer.flush();
  const transitions = fs.readFileSync(path.join(dir,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(transitions.filter(row=>row.event.operation==='hybrid-route').length,2,'route transitions must not aggregate away');
  writer.record(quit); writer.record({...quit,quitStage:'dns-stop',elapsedMs:1200}); writer.flush();
  const quitRows = fs.readdirSync(dir).flatMap(name=>fs.readFileSync(path.join(dir,name),'utf8').trim().split('\n').map(JSON.parse)).filter(row=>row.event.quitStage);
  assert.equal(quitRows.length,2,'parallel quit stages must not aggregate away');
  assert.deepEqual(quitRows.map(row=>row.event.quitStage).sort(),['dns-stop','owned-core']);
  for (let i = 0; i < 50; i++) {writer.record({...event, elapsedMs: i}); writer.flush();}
  assert.deepEqual(ioErrors, []);
  const files = fs.readdirSync(dir); assert.equal(files.length, 3);
  for (const name of files) {assert.ok(/^events(?:\.[12])?\.jsonl$/.test(name)); assert.ok(fs.statSync(path.join(dir, name)).size <= 1024); assert.ok(!fs.readFileSync(path.join(dir, name), 'utf8').includes('secret'));}
  console.log('PASS: fixed schema, secret rejection, repeat aggregation, bounded three-file rotation');
} finally {writer.close(); fs.rmSync(dir, {recursive: true});}
