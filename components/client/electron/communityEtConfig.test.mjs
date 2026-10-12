/* eslint-env node */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { inspect } from 'node:util';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const cache = new Map();
function load(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  const js = ts.transpileModule(readFileSync(url, 'utf8'), {compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }}).outputText;
  const mod = {exports: {}};
  const localRequire = name => {
    if (name === 'node:crypto') return require(name);
    assert.equal(name, './communityEtGrant', 'No product/native/I/O imports allowed');
    return load(new URL(name + '.ts', url));
  };
  vm.runInThisContext('(function(require,module,exports){' + js + '\n})', {filename: url.pathname})(localRequire, mod, mod.exports);
  cache.set(url.href, mod.exports);
  return mod.exports;
}
const {MainGrantGate, publicKeyFingerprint, COMMUNITY_ET_UPSTREAM_COMMIT, ContractError} = load(new URL('./communityEtGrant.ts', import.meta.url));
const {buildCommunityEtConfig} = load(new URL('./communityEtConfig.ts', import.meta.url));
const SECRET = Buffer.alloc(32, 0x42).toString('base64'); // Unissued, intentionally not a keypair.
function fixture() {
  const scope = {serverInstanceId: 'backend', accountId: 'a', communityId: 'c', deviceId: 'd', nativeInstanceId: '11111111-1111-4111-8111-111111111111'};
  const trusted = {...scope, networkName: 'network', networkRevision: 1, virtualIp: '10.77.1.2', bootstrapProfileId: 'profile'};
  const now = {wallMs: 1000, monoMs: 1000};
  const gate = new MainGrantGate(trusted, () => ({...now}));
  const grant = {v: 1, requestId: 'req', scope, grantId: 'g', credentialId: 'opaque-id', revision: 1,
    networkName: trusted.networkName, networkRevision: 1, virtualIp: trusted.virtualIp, bootstrapProfileId: 'profile',
    issuedAtMs: 1000, serverTimeMs: 1000, renewAfterMs: 31000, expiresAtMs: 61000,
    publicKeyFingerprint: publicKeyFingerprint(Buffer.alloc(32, 0x31).toString('base64')),
    credentialSecretB64: SECRET, policy: {reusable: false, allowRelay: false, allowedProxyCidrs: []}};
  gate.accept(gate.begin('acquire', 'req'), grant);
  const issuerPublicKeyB64 = Buffer.alloc(32, 0x33).toString('base64');
  const profile = {bootstrapProfileId: 'profile', upstreamCommit: COMMUNITY_ET_UPSTREAM_COMMIT,
    peerEndpoints: ['tcp://issuer.example:11010', 'udp://relay.example:11010', 'quic://relay.example:11011'],
    ipv4PrefixLength: 24, issuerPublicKeyB64, issuerPublicKeyFingerprint: publicKeyFingerprint(issuerPublicKeyB64)};
  return {gate, trusted, profile, now, grant, scope};
}
function rejects(fn, code) { assert.throws(fn, e => e instanceof ContractError && e.code === code && !e.message.includes(SECRET)); }
function build(f) { return buildCommunityEtConfig(f.gate, f.trusted, f.profile); }
test('config uses credential secure-mode and exact instance/network/IP without admin secret', () => {
  const draft = build(fixture());
  draft.withPrivateToml(toml => {
    assert.ok(toml.includes('[secure_mode]\nenabled = true\nlocal_private_key = "' + SECRET + '"'));
    assert.ok(toml.includes('[network_identity]\nnetwork_name = "network"'));
    assert.ok(toml.includes('ipv4 = "10.77.1.2/24"'));
    assert.ok(toml.includes('dhcp = false')); assert.ok(toml.includes('listeners = []'));
    for (const forbidden of ['network_secret', 'managed_credentials', 'credential_file', 'reusable', 'issuer_pin']) assert.equal(toml.includes(forbidden), false);
    assert.equal((toml.match(/\[\[peer\]\]/g) ?? []).length, 3);
  });
  assert.equal(draft.requirements().activationReady, false);
  assert.equal(draft.requirements().issuerPinMustBeVerified, true);
});
test('ordinary object spread, inspect and JSON cannot expose config secrets', () => {
  const draft = build(fixture());
  assert.deepEqual({...draft}, {});
  assert.equal(JSON.stringify(draft).includes(SECRET), false);
  assert.equal(inspect(draft).includes(SECRET), false);
});
test('disable/close/revoke prevent new config consumption', () => {
  for (const stop of [f => f.gate.setEnabled(false), f => f.gate.close(), f => f.gate.revokeTrusted({v: 1, scope: f.scope, grantId: 'g'})]) {
    const f = fixture(); stop(f); rejects(() => build(f), 'no-active-grant');
  }
});
test('wall or monotonic expiry prevents config even after local rollback', () => {
  const f = fixture(); f.now.wallMs = 0; f.now.monoMs = 61000; rejects(() => build(f), 'no-active-grant');
});
test('prepared config cannot reach private writer after disable, close, revoke or expiry', () => {
  for (const stop of [f => f.gate.setEnabled(false), f => f.gate.close(),
    f => f.gate.revokeTrusted({v: 1, scope: f.scope, grantId: 'g'}), f => { f.now.monoMs = 61000; }]) {
    const f = fixture(); const draft = build(f); stop(f);
    rejects(() => draft.withPrivateToml(() => assert.fail('stale draft reached writer')), 'stale-config');
  }
});
test('new revision invalidates old prepared config even with same credential', () => {
  const f = fixture(); const draft = build(f);
  const renewed = {...f.grant, requestId: 'renew', revision: 2, expiresAtMs: 91000, renewAfterMs: 51000};
  f.gate.accept(f.gate.begin('renew', 'renew'), renewed);
  rejects(() => draft.withPrivateToml(() => assert.fail('old revision reached writer')), 'stale-config');
  build(f).withPrivateToml(toml => assert.ok(toml.includes(SECRET)));
});
for (const field of ['communityId', 'deviceId', 'serverInstanceId', 'networkName', 'networkRevision', 'virtualIp', 'bootstrapProfileId']) {
  test(`config cannot cross trusted ${field}`, () => {
    const f = fixture(); f.trusted[field] = field === 'networkRevision' ? 2 : field === 'virtualIp' ? '10.77.1.3' : 'other';
    rejects(() => build(f), 'network-intent-mismatch');
  });
}
for (const endpoint of ['tcp://user:secret@issuer.example:11010', 'tcp://issuer.example:11010/../../file',
  'tcp://issuer.example:11010?pin=other', 'tcp://issuer.example:65536', 'https://issuer.example:443',
  'udp://issuer.example:0', 'tcp://issuer.example:11010\nnetwork_secret="bad"']) {
  test(`reject endpoint injection ${JSON.stringify(endpoint)}`, () => {
    const f = fixture(); f.profile.peerEndpoints = [endpoint]; rejects(() => build(f), 'invalid-bootstrap-endpoint');
  });
}
test('profile pin mismatch and unknown path/config options are rejected', () => {
  const f = fixture(); f.profile.issuerPublicKeyFingerprint = 'f'.repeat(64); rejects(() => build(f), 'invalid-bootstrap-profile');
  const other = fixture(); other.profile.configFile = '../../private.toml'; rejects(() => build(other), 'invalid-bootstrap-profile');
});
test('private grant copy mutations do not replace trusted active secret', () => {
  const f = fixture(); const copy = f.gate.privateGrantForConfig(); copy.credentialSecretB64 = 'bad';
  build(f).withPrivateToml(toml => assert.ok(toml.includes(SECRET)));
});
test('bootstrap array accessor is rejected before reading endpoint', () => {
  const f = fixture(); Object.defineProperty(f.profile.peerEndpoints, '0', {get: () => assert.fail('getter evaluated')});
  rejects(() => build(f), 'invalid-bootstrap-profile');
});
