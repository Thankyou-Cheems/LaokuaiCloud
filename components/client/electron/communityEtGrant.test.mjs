/* eslint-env node */
/** Synthetic boundary tests only. Fixed byte strings are never issued or used by ET. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const cache = new Map();
function load(url) {
  const path = url.pathname;
  if (cache.has(path)) return cache.get(path);
  const source = readFileSync(url, 'utf8');
  const js = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
  const mod = {exports: {}};
  cache.set(path, mod.exports);
  const localRequire = name => {
    if (name === 'node:crypto') return require(name);
    assert.ok(['./communityGrant', '../../server/src/easytier/communityDeviceBinding'].includes(name), 'No product/native/I/O imports allowed');
    return load(new URL(name + '.ts', url));
  };
  vm.runInThisContext('(function(require,module,exports){' + js + '\n})', {filename: path})(localRequire, mod, mod.exports);
  return mod.exports;
}
const {ContractError, MainGrantGate, parseRendererIntent, publicKeyFingerprint, communityIdentity, scope} = load(new URL('./communityEtGrant.ts', import.meta.url));

test('existing CJK community namespace survives while account and native identities remain strict', () => {
  const realId='老蒯聊_5000_default';
  assert.equal(communityIdentity(realId),true);
  assert.deepEqual(parseRendererIntent({v:1,communityId:realId,enabled:true}),{v:1,communityId:realId,enabled:true});
  const value={serverInstanceId:realId,communityId:realId,accountId:'actual-account',deviceId:'device',nativeInstanceId:'11111111-1111-4111-8111-111111111111'};
  assert.doesNotThrow(()=>scope(value));
  assert.throws(()=>scope({...value,accountId:'另一个账号'}));
  for(const communityId of ['../逃逸','社区/另一个','社区\\另一个','社区\u202efoo','社区\nfoo','社'.repeat(129)])assert.throws(()=>scope({...value,communityId}));
});
const binding = load(new URL('../../server/src/easytier/communityDeviceBinding.ts', import.meta.url));
function verifyDeviceBinding(...args) {
  try { return binding.verifyDeviceBinding(...args); }
  catch (error) { throw new ContractError(error.code); }
}

const SECRET = Buffer.alloc(32, 0x42).toString('base64'); // Public, unusable fixture. Never deploy.
const PUBLIC = Buffer.alloc(32, 0x31).toString('base64'); // NOT derived from SECRET.
const FP = publicKeyFingerprint(PUBLIC);
const NATIVE = '11111111-1111-4111-8111-111111111111';
const OTHER_NATIVE = '22222222-2222-4222-8222-222222222222';
const clone = v => structuredClone(v);
function fixture(override = {}, options = {}) {
  const now = {wallMs: 2_000_000, monoMs: 10_000};
  const intended = {serverInstanceId: 'server-one', accountId: 'account-a', communityId: 'community-a', deviceId: 'device-a',
    nativeInstanceId: NATIVE, networkName: 'laokuai-network-a', networkRevision: 1, virtualIp: '10.77.1.2', bootstrapProfileId: 'bootstrap-a', ...override};
  const gate = new MainGrantGate(intended, () => ({...now}), options);
  const scope = Object.fromEntries(['serverInstanceId','accountId','communityId','deviceId','nativeInstanceId'].map(k => [k, intended[k]]));
  const grant = {v: 1, requestId: 'request-one', scope, grantId: 'grant-one', credentialId: 'cred-one', revision: 1,
    networkName: intended.networkName, networkRevision: intended.networkRevision, virtualIp: intended.virtualIp, bootstrapProfileId: intended.bootstrapProfileId,
    issuedAtMs: now.wallMs, serverTimeMs: now.wallMs, renewAfterMs: now.wallMs + 30_000, expiresAtMs: now.wallMs + 60_000,
    publicKeyFingerprint: FP, credentialSecretB64: SECRET, policy: {reusable: false, allowRelay: false, allowedProxyCidrs: []}};
  return {now, intended, scope, gate, grant};
}
function rejects(fn, code) { assert.throws(fn, e => e instanceof ContractError && e.code === code && !e.message.includes(SECRET)); }
function acquired() { const f = fixture(); f.gate.accept(f.gate.begin('acquire', f.grant.requestId), f.grant); return f; }
function renewed(f) {
  const g = clone(f.grant); g.requestId = 'request-renew'; g.revision = 2; g.issuedAtMs += 10_000; g.serverTimeMs += 10_000; g.renewAfterMs += 20_000; g.expiresAtMs += 30_000;
  f.now.wallMs += 10_000; f.now.monoMs += 10_000;
  return {g, ticket: f.gate.begin('renew', g.requestId)};
}
function node(f, patch = {}) { return {nativeInstanceId: NATIVE, runtimeGeneration: 1, networkName: f.intended.networkName,
  peerId: 71, virtualIp: f.intended.virtualIp, publicKeyB64: PUBLIC, observedMonoMs: f.now.monoMs, ...patch}; }
function bindingFixture() {
  const f = fixture();
  const expected = {...f.scope, grantId: f.grant.grantId, credentialId: f.grant.credentialId, publicKeyFingerprint: FP,
    networkName: f.intended.networkName, virtualIp: f.intended.virtualIp, revision: 1};
  const observation = {providerGeneration: 1, observedMonoMs: f.now.monoMs, networkName: f.intended.networkName,
    connections: [{peerId: 71, networkName: f.intended.networkName, isClosed: false, secureAuthLevel: 2, peerIdentityType: 1, remotePublicKeyB64: PUBLIC}],
    routes: [{peerId: 71, nativeInstanceId: NATIVE, virtualIp: f.intended.virtualIp, nextHopPeerId: 71}]};
  return {...f, expected, observation};
}

test('valid acquire gives redacted state and never physical-direct proof', () => {
  const f = acquired(); const s = f.gate.snapshot();
  assert.equal(s.status, 'granted'); assert.equal(s.physicalDirectVerified, false); assert.equal(s.memberBindingVerified, false);
  assert.deepEqual(Object.keys(s), ['v','communityId','status','virtualIp','memberBindingVerified','physicalDirectVerified']);
  assert.equal(JSON.stringify(s).includes(SECRET), false);
  assert.equal(JSON.stringify(f.gate).includes(SECRET), false);
});
test('renderer intent is only community and enabled', () => assert.deepEqual(parseRendererIntent({v: 1, communityId: 'a', enabled: true}), {v: 1, communityId: 'a', enabled: true}));
for (const field of ['credentialSecretB64','config','configFile','command','nativeInstanceId','accountId','deviceId','peerUri']) {
  test(`renderer rejects ${field}`, () => rejects(() => parseRendererIntent({v: 1, communityId: 'a', enabled: true, [field]: SECRET}), 'invalid-renderer-intent'));
}
for (const field of ['serverInstanceId','accountId','communityId','deviceId','nativeInstanceId']) {
  test(`grant cannot cross ${field}`, () => {
    const f = fixture(); const g = clone(f.grant); g.scope[field] = field === 'nativeInstanceId' ? OTHER_NATIVE : 'other';
    rejects(() => f.gate.accept(f.gate.begin('acquire', g.requestId), g), 'scope-mismatch');
  });
}
for (const field of ['networkName','networkRevision','virtualIp','bootstrapProfileId']) {
  test(`grant cannot replace main-owned ${field}`, () => {
    const f = fixture(); const g = clone(f.grant); g[field] = field === 'networkRevision' ? 2 : field === 'virtualIp' ? '10.77.1.3' : 'other';
    rejects(() => f.gate.accept(f.gate.begin('acquire', g.requestId), g), 'network-intent-mismatch');
  });
}
test('unknown grant field rejected', () => {const f = fixture(); rejects(() => f.gate.accept(f.gate.begin('acquire', f.grant.requestId), {...f.grant, exec: 'not-a-command'}), 'invalid-grant-shape');});
test('unknown nested scope field rejected', () => {const f = fixture(); f.grant.scope.extra = SECRET; rejects(() => f.gate.accept(f.gate.begin('acquire', f.grant.requestId), f.grant), 'invalid-scope');});
test('unknown policy field rejected', () => {const f = fixture(); f.grant.policy.exitNode = true; rejects(() => f.gate.accept(f.gate.begin('acquire', f.grant.requestId), f.grant), 'invalid-policy');});
test('accessor properties rejected without evaluating getter', () => {const f = fixture(); let invoked = false; Object.defineProperty(f.grant, 'credentialSecretB64', {get(){invoked=true; return SECRET;}, enumerable:true}); rejects(() => f.gate.accept(f.gate.begin('acquire', 'request-one'), f.grant), 'invalid-grant-shape'); assert.equal(invoked,false);});
test('non-plain prototype rejected', () => {const f = fixture(); Object.setPrototypeOf(f.grant,{evil:1}); rejects(() => f.gate.accept(f.gate.begin('acquire', 'request-one'), f.grant), 'invalid-grant-shape');});
for(const patch of [{reusable:true},{allowRelay:true},{allowedProxyCidrs:['0.0.0.0/0']}]) {
  test(`reject expanded credential policy ${JSON.stringify(patch)}`, () => {const f = fixture(); Object.assign(f.grant.policy,patch); rejects(() => f.gate.accept(f.gate.begin('acquire', 'request-one'),f.grant),'unsafe-policy');});
}
test('request mismatch rejected', () => {const f=fixture(); rejects(() => f.gate.accept(f.gate.begin('acquire','other-request'),f.grant),'request-mismatch');});
test('ticket identity cannot be reconstructed', () => {const f=fixture(); const ticket=f.gate.begin('acquire','request-one'); rejects(() => f.gate.accept({...ticket},f.grant),'stale-response');});
test('late first response cannot overwrite newer request', () => {const f=fixture(); const first=f.gate.begin('acquire','request-one'); f.gate.begin('acquire','request-two'); rejects(() => f.gate.accept(first,f.grant),'stale-response');});
test('duplicate accepted response cannot replay', () => {const f=fixture(); const t=f.gate.begin('acquire','request-one'); f.gate.accept(t,f.grant); rejects(() => f.gate.accept(t,f.grant),'stale-response');});
test('disable cancels outstanding response', () => {const f=fixture(); const t=f.gate.begin('acquire','request-one'); f.gate.setEnabled(false); rejects(() => f.gate.accept(t,f.grant),'stale-response');});
test('disable then enable does not revive old response', () => {const f=fixture(); const t=f.gate.begin('acquire','request-one'); f.gate.setEnabled(false); f.gate.setEnabled(true); rejects(() => f.gate.accept(t,f.grant),'stale-response');});
test('close/account change rejects late response', () => {const f=fixture(); const t=f.gate.begin('acquire','request-one'); f.gate.close(); rejects(() => f.gate.accept(t,f.grant),'stale-response'); assert.equal(f.gate.snapshot().status,'closed');});
for (const patch of [{issuedAtMs:2_000_001},{expiresAtMs:2_000_000},{renewAfterMs:2_060_000},{expiresAtMs:6_000_000}]) {
  test(`invalid expiry or time rejected ${JSON.stringify(patch)}`, () => {const f=fixture(); Object.assign(f.grant,patch); rejects(() => f.gate.accept(f.gate.begin('acquire','request-one'),f.grant),'invalid-grant-time');});
}
test('TTL wall-clock rollback cannot extend monotonic deadline', () => {const f=acquired(); f.now.wallMs-=100_000; f.now.monoMs+=60_000; assert.equal(f.gate.snapshot().status,'expired');});
test('client clock skew does not require matching server wall clock', () => {const f=fixture(); f.now.wallMs+=500_000; f.gate.accept(f.gate.begin('acquire','request-one'),f.grant); assert.equal(f.gate.snapshot().status,'granted'); f.now.monoMs+=60_000; assert.equal(f.gate.snapshot().status,'expired');});
test('long request cannot reset an old grant TTL', () => {const f=fixture(); const t=f.gate.begin('acquire','request-one'); f.now.monoMs+=30_001; rejects(() => f.gate.accept(t,f.grant),'response-too-late');});
test('wall-clock expiry is inclusive', () => {const f=acquired(); f.now.wallMs=f.grant.expiresAtMs; assert.equal(f.gate.snapshot().status,'expired');});
test('renewal response after expiry rejected', () => {const f=acquired(); const {g,ticket}=renewed(f); f.now.monoMs+=60_000; rejects(() => f.gate.accept(ticket,g),'stale-response');});
test('same-grant tombstone rejects in-flight acquire response', () => {const f=fixture(); const t=f.gate.begin('acquire','request-one'); f.gate.revokeTrusted({v:1,scope:f.scope,grantId:'grant-one'}); rejects(() => f.gate.accept(t,f.grant),'grant-revoked');});
test('old revocation does not cancel new acquire without an active grant', () => {const f=fixture(); const t=f.gate.begin('acquire','request-one'); f.gate.revokeTrusted({v:1,scope:f.scope,grantId:'old-grant'}); assert.equal(f.gate.accept(t,f.grant).status,'granted');});
test('tombstone blocks revoked grant on new request', () => {const f=fixture(); f.gate.revokeTrusted({v:1,scope:f.scope,grantId:'grant-one'}); rejects(() => f.gate.accept(f.gate.begin('acquire','request-one'),f.grant),'grant-revoked');});
test('revocation drops active state and binding', () => {const f=acquired(); f.gate.acceptOwnedNode(node(f),1); f.gate.revokeTrusted({v:1,scope:f.scope,grantId:'grant-one'}); assert.equal(f.gate.snapshot().status,'revoked'); assert.equal(f.gate.snapshot().virtualIp,null);});
test('late revocation cannot reopen or relabel closed gate', () => {const f=acquired(); f.gate.close(); f.gate.revokeTrusted({v:1,scope:f.scope,grantId:'grant-one'}); assert.equal(f.gate.snapshot().status,'closed');});
test('closed remains terminal after enable and disable toggles', () => {const f=acquired(); f.gate.close(); f.gate.setEnabled(true); f.gate.setEnabled(false); assert.equal(f.gate.snapshot().status,'closed'); rejects(() => f.gate.begin('acquire','new-request'),'request-not-allowed');});
test('disabled keeps precedence when old revocation arrives', () => {const f=acquired(); f.gate.setEnabled(false); f.gate.revokeTrusted({v:1,scope:f.scope,grantId:'old-grant'}); assert.equal(f.gate.snapshot().status,'disabled');});
test('disabled stores matching tombstone without relabeling intent', () => {const f=fixture(); f.gate.setEnabled(false); f.gate.revokeTrusted({v:1,scope:f.scope,grantId:'grant-one'}); assert.equal(f.gate.snapshot().status,'disabled'); f.gate.setEnabled(true); rejects(() => f.gate.accept(f.gate.begin('acquire','request-one'),f.grant),'grant-revoked');});
test('matching revocation cancels active renewal', () => {const f=acquired(); const {g,ticket}=renewed(f); f.gate.revokeTrusted({v:1,scope:f.scope,grantId:'grant-one'}); assert.equal(f.gate.snapshot().status,'revoked'); rejects(() => f.gate.accept(ticket,g),'stale-response');});
test('cross-community revocation cannot affect gate', () => {const f=acquired(); rejects(() => f.gate.revokeTrusted({v:1,scope:{...f.scope,communityId:'other'},grantId:'grant-one'}),'scope-mismatch'); assert.equal(f.gate.snapshot().status,'granted');});
test('old grant revocation preserves current renewal ticket', () => {const f=acquired(); const {g,ticket}=renewed(f); f.gate.revokeTrusted({v:1,scope:f.scope,grantId:'old-grant'}); assert.equal(f.gate.accept(ticket,g).status,'granted');});
test('real renewal requires same identity and a later expiry', () => {const f=acquired(); const {g,ticket}=renewed(f); assert.equal(f.gate.accept(ticket,g).status,'granted');});
test('Generate with old expiry cannot masquerade as renew', () => {const f=acquired(); const {g,ticket}=renewed(f); g.expiresAtMs=f.grant.expiresAtMs; rejects(() => f.gate.accept(ticket,g),'renewal-not-extended');});
for(const field of ['grantId','credentialId','publicKeyFingerprint','credentialSecretB64']) {
  test(`renew cannot silently rotate ${field}`, () => {const f=acquired(); const {g,ticket}=renewed(f); g[field]=field==='publicKeyFingerprint'?'f'.repeat(64):field==='credentialSecretB64'?Buffer.alloc(32,0x43).toString('base64'):'other'; rejects(() => f.gate.accept(ticket,g),'renewal-identity-changed');});
}
test('revision floor blocks old response after restart', () => {const f=fixture({}, {revisionFloor:2}); rejects(() => f.gate.accept(f.gate.begin('acquire','request-one'),f.grant),'stale-revision');});
test('response object mutation cannot alter accepted state', () => {const f=acquired(); f.grant.expiresAtMs=0; f.grant.scope.communityId='other'; assert.equal(f.gate.snapshot().status,'granted');});
test('independent communities do not share tickets', () => {const a=fixture(); const b=fixture({communityId:'community-b',networkName:'laokuai-network-b',virtualIp:'10.78.1.2',nativeInstanceId:OTHER_NATIVE}); const t=a.gate.begin('acquire','request-one'); b.gate.begin('acquire','request-one'); rejects(() => b.gate.accept(t,a.grant),'stale-response'); assert.equal(a.gate.accept(t,a.grant).status,'granted');});
test('invalid base64 secret rejected without echo', () => {const f=fixture(); f.grant.credentialSecretB64='not-secret'; rejects(() => f.gate.accept(f.gate.begin('acquire','request-one'),f.grant),'invalid-key-format');});
test('noncanonical base64 rejected', () => {const f=fixture(); f.grant.credentialSecretB64=SECRET.replace(/=$/,''); rejects(() => f.gate.accept(f.gate.begin('acquire','request-one'),f.grant),'invalid-key-format');});
test('owned observation still does not prove member or media path', () => {const f=acquired(); const s=f.gate.acceptOwnedNode(node(f),1); assert.equal(s.status,'native-observed'); assert.equal(s.virtualIp,f.intended.virtualIp); assert.equal(s.memberBindingVerified,false); assert.equal(s.physicalDirectVerified,false);});
for (const patch of [{nativeInstanceId:OTHER_NATIVE},{runtimeGeneration:2},{virtualIp:'10.77.1.9'},{networkName:'other'},{peerId:0},{observedMonoMs:1},{observedMonoMs:10_001}]) {
  test(`reject stale/wrong local observation ${JSON.stringify(patch)}`, () => {const f=acquired(); rejects(() => f.gate.acceptOwnedNode(node(f,patch),1),'node-observation-mismatch');});
}
test('wrong local public key rejected', () => {const f=acquired(); rejects(() => f.gate.acceptOwnedNode(node(f,{publicKeyB64:Buffer.alloc(32,0x32).toString('base64')}),1),'key-mismatch');});
test('restart invalidates local observations and pending replies', () => {const f=acquired(); f.gate.acceptOwnedNode(node(f),1); const {g,ticket}=renewed(f); f.gate.invalidateNativeRuntime(); assert.equal(f.gate.snapshot().virtualIp,null); rejects(() => f.gate.accept(ticket,g),'stale-response');});
test('observation TTL expires even when grant remains valid', () => {const f=acquired(); f.gate.acceptOwnedNode(node(f),1); f.now.monoMs+=5_001; assert.equal(f.gate.snapshot().virtualIp,null); assert.equal(f.gate.snapshot().status,'granted');});
test('provider joins exact authenticated key with route', () => {const f=bindingFixture(); const b=verifyDeviceBinding(f.expected,f.observation,f.now.monoMs,1); assert.equal(b.peerId,71); assert.equal(b.physicalDirectVerified,false); assert.equal(JSON.stringify(b).includes(SECRET),false);});
test('route-only observation cannot authenticate device', () => {const f=bindingFixture(); f.observation.connections=[]; rejects(() => verifyDeviceBinding(f.expected,f.observation,f.now.monoMs,1),'binding-unproven');});
for(const level of [0,1,3]) test(`credential binding rejects unsuitable auth level ${level}`, () => {const f=bindingFixture(); f.observation.connections[0].secureAuthLevel=level; rejects(() => verifyDeviceBinding(f.expected,f.observation,f.now.monoMs,1),'binding-unproven');});
test('nonexistent CredentialAuthenticated enum rejected', () => {const f=bindingFixture(); f.observation.connections[0].secureAuthLevel=4; rejects(() => verifyDeviceBinding(f.expected,f.observation,f.now.monoMs,1),'invalid-connection');});
test('admin identity cannot impersonate ordinary device', () => {const f=bindingFixture(); f.observation.connections[0].peerIdentityType=0; rejects(() => verifyDeviceBinding(f.expected,f.observation,f.now.monoMs,1),'binding-unproven');});
test('closed connection cannot bind', () => {const f=bindingFixture(); f.observation.connections[0].isClosed=true; rejects(() => verifyDeviceBinding(f.expected,f.observation,f.now.monoMs,1),'binding-unproven');});
test('duplicate key on two peer IDs cannot bind', () => {const f=bindingFixture(); f.observation.connections.push({...f.observation.connections[0],peerId:72}); rejects(() => verifyDeviceBinding(f.expected,f.observation,f.now.monoMs,1),'duplicate-key-owner');});
test('two authenticated connections of same peer are not two devices', () => {const f=bindingFixture(); f.observation.connections.push({...f.observation.connections[0]}); assert.equal(verifyDeviceBinding(f.expected,f.observation,f.now.monoMs,1).peerId,71);});
test('contradictory adapter sample with two keys for one peer fails closed', () => {const f=bindingFixture(); f.observation.connections.push({...f.observation.connections[0],remotePublicKeyB64:Buffer.alloc(32,0x33).toString('base64')}); rejects(() => verifyDeviceBinding(f.expected,f.observation,f.now.monoMs,1),'connection-evidence-conflict');});
test('contradictory adapter sample with two identity types for one peer fails closed', () => {const f=bindingFixture(); f.observation.connections.push({...f.observation.connections[0],peerIdentityType:0}); rejects(() => verifyDeviceBinding(f.expected,f.observation,f.now.monoMs,1),'connection-evidence-conflict');});
test('closed old-key connection does not conflict with current active evidence', () => {const f=bindingFixture(); f.observation.connections.push({...f.observation.connections[0],isClosed:true,remotePublicKeyB64:Buffer.alloc(32,0x33).toString('base64')}); assert.equal(verifyDeviceBinding(f.expected,f.observation,f.now.monoMs,1).peerId,71);});
for(const patch of [{peerId:72},{nativeInstanceId:OTHER_NATIVE},{virtualIp:'10.77.1.9'}]) {
  test(`route association rejects ${JSON.stringify(patch)}`, () => {const f=bindingFixture(); Object.assign(f.observation.routes[0],patch); rejects(() => verifyDeviceBinding(f.expected,f.observation,f.now.monoMs,1),'route-binding-mismatch');});
}
test('duplicate virtual IP cannot bind', () => {const f=bindingFixture(); f.observation.routes.push({...f.observation.routes[0],peerId:72}); rejects(() => verifyDeviceBinding(f.expected,f.observation,f.now.monoMs,1),'route-binding-mismatch');});
test('provider restart invalidates old observation', () => {const f=bindingFixture(); rejects(() => verifyDeviceBinding(f.expected,f.observation,f.now.monoMs,2),'provider-observation-mismatch');});
test('old provider observation cannot bind', () => {const f=bindingFixture(); rejects(() => verifyDeviceBinding(f.expected,f.observation,f.now.monoMs+5_001,1),'provider-observation-mismatch');});
test('direct and relay next hop both remain unverified physical media', () => {const f=bindingFixture(); for(const next of [71,99]) {f.observation.routes[0].nextHopPeerId=next; assert.equal(verifyDeviceBinding(f.expected,f.observation,f.now.monoMs,1).physicalDirectVerified,false);}});
test('unknown provider field rejected rather than treated as evidence', () => {const f=bindingFixture(); f.observation.physicalDirectVerified=true; rejects(() => verifyDeviceBinding(f.expected,f.observation,f.now.monoMs,1),'invalid-provider-observation');});
test('hidden policy array fields cannot carry secrets through grant validation', () => {
  const f = fixture(); Object.assign(f.grant.policy.allowedProxyCidrs, {secretDump: SECRET});
  rejects(() => f.gate.accept(f.gate.begin('acquire','request-one'), f.grant), 'unsafe-policy');
});
