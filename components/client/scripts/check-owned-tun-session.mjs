/* eslint-env node */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(file, imports = require) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL(`../electron/${file}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText;
  vm.runInNewContext(source, {exports, require: imports, Buffer, BigInt, AbortController});
  return exports;
}
const real = load('windowsFirewallRules'); // Only the pure validator is called.
const calls = [];
let fail = false;
let retryFailures = 0;
let failureCode = 'tun-not-ready';
const api = {
  validLaokuaiOwnedTunFirewallEvidence: real.validLaokuaiOwnedTunFirewallEvidence,
  prepareLaokuaiOwnedTunFirewallRules: async (_options, evidence) => {
    calls.push(['prepare', evidence]);
    if (fail) throw new Error('synthetic COM failure');
    if (retryFailures-- > 0) return {status: 'failed', installed: [], failures: [{code: failureCode}]};
    return {status: 'prepared', installed: [{ownershipId: 'synthetic-owned-handle'}], failures: []};
  },
  releaseLaokuaiOwnedTunFirewallRules: async (_options, handles) => {
    calls.push(['release', handles]); return {status: 'prepared', removed: ['owned'], failures: []};
  },
  cleanupLaokuaiOwnedTunFirewallRules: async () => { calls.push(['cleanup']); return {status: 'prepared'}; },
};
const {ownedTunFirewallEvidence, createOwnedTunFirewallSession} = load('ownedTunFirewallSession', name => {
  if (name === 'node:timers/promises') return {setTimeout: async (_ms, _value, {signal}) => {
    if (signal.aborted) throw new Error('aborted');
  }};
  assert.equal(name, './windowsFirewallRules'); return api;
});
const config = {ownedFirewallScope: {localAddress: '10.44.7.3', prefixLength: 24}, credentialIdentity: {virtualIp: '10.44.7.3'}};
const nic = {guid: '11111111-2222-4333-8444-555555555555', luid: '123456', ifIndex: 42};
const core = {isAlive: () => true, ownedResources: () => ({interfaces: [nic]})};
const plain = value => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(ownedTunFirewallEvidence(config, core)), {...nic, localAddress: '10.44.7.3', remoteSubnet: '10.44.7.0/24'});
assert.equal(ownedTunFirewallEvidence({...config, credentialIdentity: {virtualIp: '10.44.7.4'}}, core), null);
assert.equal(ownedTunFirewallEvidence(config, {...core, isAlive: () => false}), null);
assert.equal(ownedTunFirewallEvidence(config, {...core, ownedResources: () => ({interfaces: [nic, nic]})}), null);
assert.equal(ownedTunFirewallEvidence({...config, ownedFirewallScope: {localAddress: '10.44.7.3', prefixLength: 1}}, core), null);
const log = [], lifecycle = createOwnedTunFirewallSession(() => ({platform: 'win32', product: true}), value => log.push(value));
const release = await lifecycle.prepare(config, core, new AbortController().signal);
await Promise.all([release(), release()]);
assert.deepEqual(calls.map(row => row[0]), ['prepare', 'release']);
assert.deepEqual(plain(calls[1][1]), [{ownershipId: 'synthetic-owned-handle'}]);
fail = true;
const noOp = await lifecycle.prepare(config, core, new AbortController().signal);
await noOp();
assert.match(log.at(-1), /LAN remains running/);
await lifecycle.cleanup();
assert.equal(calls.at(-1)[0], 'cleanup');
assert.equal(calls.filter(row => row[0] === 'release').length, 1);
fail = false; calls.length = 0; retryFailures = 1;
await (await lifecycle.prepare(config, core, new AbortController().signal))();
assert.deepEqual(calls.map(row => row[0]), ['prepare', 'prepare', 'release']);
calls.length = 0; retryFailures = 100;
await lifecycle.prepare(config, core, new AbortController().signal);
assert.equal(calls.length, 3, 'readiness retry is bounded');
calls.length = 0; failureCode = 'tun-scope-unverified';
await lifecycle.prepare(config, core, new AbortController().signal);
assert.equal(calls.length, 1, 'identity/ownership failure is never retried');
console.log('Owned TUN session: trusted scope, no discovery, serialized exact cleanup and nonfatal preparation verified; no native/network actions.');
