import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url), ts = require('typescript'), cache = new Map();
const denied = () => { throw new Error('native-or-network-forbidden'); };
function load(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  const mod = {exports: {}}; cache.set(url.href, mod.exports);
  const code = ts.transpileModule(readFileSync(url, 'utf8'), {compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }}).outputText;
  const local = name => {
    if (['node:crypto', 'node:path'].includes(name)) return require(name);
    if (name === 'node:https') return {request: denied};
    if (name === 'node:child_process') return {execFile: denied, spawn: denied};
    if (name === 'node:fs/promises') return new Proxy({}, {get: () => denied});
    assert.ok(name.startsWith('./'), 'Only reviewed local pure modules are loaded');
    return load(new URL(name + '.ts', url));
  };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', {filename: url.pathname})(local, mod, mod.exports);
  return mod.exports;
}
const {publicKeyFingerprint, COMMUNITY_ET_UPSTREAM_COMMIT} = load(new URL('./communityEtGrant.ts', import.meta.url));
const {verifyOwnedCredentialObservation} = load(new URL('./communityEtCredentialObservation.ts', import.meta.url));
const {projectCommunityEtBinding} = load(new URL('./communityEtBindingProjection.ts', import.meta.url));
const {CommunityEtGrantRuntime} = load(new URL('./communityEtGrantRuntime.ts', import.meta.url));
const {CommunityEtGrantTransport, CommunityEtTransportError, trustedHttpsOrigin} = load(new URL('./communityEtGrantTransport.ts', import.meta.url));
const {EasyTierCommunityManager, EasyTierOperationError, EasyTierSessionRetiredError} = load(new URL('./easyTierCommunityManager.ts', import.meta.url));
const {CommunityEnrollment} = load(new URL('./communityEnrollment.ts', import.meta.url));
const {registerEasyTierCommunityIpc} = load(new URL('./easyTierCommunityIpc.ts', import.meta.url));
const KEY = Buffer.alloc(32, 0x31).toString('base64'), ISSUER = Buffer.alloc(32, 0x22).toString('base64');
const SECRET = Buffer.alloc(32, 0x42).toString('base64'); // Unissued fixture, intentionally not a keypair.
const UUID = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const now = {mono: 10000, wall: 2000000};
  const intent = {serverInstanceId: 'backend', accountId: 'account', communityId: 'community', deviceId: 'device',
    nativeInstanceId: UUID, networkName: 'test-network', networkRevision: 1, virtualIp: '10.77.1.2', bootstrapProfileId: 'profile'};
  const scope = Object.fromEntries(['serverInstanceId', 'accountId', 'communityId', 'deviceId', 'nativeInstanceId'].map(k => [k, intent[k]]));
  const expected = {networkName: intent.networkName, virtualIp: intent.virtualIp, publicKeyFingerprint: publicKeyFingerprint(KEY),
    issuerPublicKeyFingerprint: publicKeyFingerprint(ISSUER)};
  const observation = {peerId: 11, virtualIp: intent.virtualIp, publicKeyB64: KEY, issuerPinVerified: true};
  const raw = {node_info: {inst_id: UUID, peer_id: 11, ipv4_addr: intent.virtualIp, config: 'DO-NOT-PROJECT'}, peer_routes: [{
    route: {peer_id: 22, ipv4_addr: '10.77.1.1', next_hop_peer_id: 22}, peer: {peer_id: 22, directly_connected_conns: [], conns: [{
      conn_id: '22222222-2222-4222-8222-222222222222', my_peer_id: 11, peer_id: 22, network_name: intent.networkName,
      secure_auth_level: 'PeerVerified', peer_identity_type: 'Admin', noise_local_static_pubkey: KEY, noise_remote_static_pubkey: ISSUER,
    }]}}]};
  const sample = {serverId: 'community', instanceId: UUID, generation: 1, acquiredAtMs: now.mono, acquiredAtUnixMs: now.wall,
    acquisitionSource: 'owned-cli-route-list', freshRpc: true, latencyFirst: null, bindings: [],
    info: {running: true, my_node_info: {peer_id: 11, virtual_ipv4: intent.virtualIp}, routes: [], peers: []}};
  const grant = {v: 1, requestId: 'request', scope, grantId: 'grant', credentialId: 'credential', revision: 1,
    networkName: intent.networkName, networkRevision: 1, virtualIp: intent.virtualIp, bootstrapProfileId: 'profile',
    issuedAtMs: now.wall, serverTimeMs: now.wall, renewAfterMs: now.wall + 30000, expiresAtMs: now.wall + 60000,
    publicKeyFingerprint: expected.publicKeyFingerprint, credentialSecretB64: SECRET, policy: {reusable: false, allowRelay: false, allowedProxyCidrs: []}};
  const verified = {serverUserId: 'member', intent};
  const proof = {v: 1, serverUserId: 'member', scope, grantId: 'grant', credentialId: 'credential', revision: 1,
    peerId: 11, virtualIp: intent.virtualIp, publicKeyFingerprint: expected.publicKeyFingerprint, physicalDirectVerified: false};
  return {now, intent, scope, expected, observation, raw, sample, grant, verified, proof};
}
const clone = v => structuredClone(v);
test('official named and numeric enums prove the exact issuer, missing default Admin is accepted', () => {
  const f = fixture();
  assert.deepEqual(verifyOwnedCredentialObservation(f.raw, UUID, f.expected), f.observation);
  const c = f.raw.peer_routes[0].peer.conns[0]; c.secure_auth_level = 2; delete c.peer_identity_type;
  assert.deepEqual(verifyOwnedCredentialObservation(f.raw, UUID, f.expected), f.observation);
  assert.equal(JSON.stringify(f.observation).includes('DO-NOT-PROJECT'), false);
});
for (const [name, mutate] of [
  ['missing auth', c => delete c.secure_auth_level], ['unauthenticated', c => c.secure_auth_level = 1],
  ['network secret alone', c => c.secure_auth_level = 'NetworkSecretConfirmed'], ['unknown enum', c => c.secure_auth_level = 'peerverified'],
  ['wrong issuer role', c => c.peer_identity_type = 'SharedNode'], ['closed peer', c => c.is_closed = true],
  ['wrong issuer key', c => c.noise_remote_static_pubkey = KEY], ['wrong local key', c => c.noise_local_static_pubkey = ISSUER],
  ['different network', c => c.network_name = 'other'], ['wrong local peer', c => c.my_peer_id = 99],
]) test('credential observation rejects ' + name, () => {
  const f = fixture(); mutate(f.raw.peer_routes[0].peer.conns[0]);
  assert.throws(() => verifyOwnedCredentialObservation(f.raw, UUID, f.expected));
});
test('credential observation rejects an unrelated UUID and virtual IP', () => {
  const f = fixture(); assert.throws(() => verifyOwnedCredentialObservation(f.raw, '33333333-3333-4333-8333-333333333333', f.expected));
  f.raw.node_info.ipv4_addr = '10.77.1.3'; assert.throws(() => verifyOwnedCredentialObservation(f.raw, UUID, f.expected));
});
function projected(f) { return projectCommunityEtBinding(f.proof, f.grant, f.verified, f.observation, f.sample, 10000, 10001, 2000001, 10100); }
test('binding projects only the joined authenticated device and expires with its grant', () => {
  const b = projected(fixture()); assert.equal(b.userId, 'member'); assert.equal(b.expiresAtMs, 10100);
  assert.equal(b.authenticated, true); assert.equal(b.enrollment, 'joined');
  assert.equal(JSON.stringify(b).includes(SECRET), false); assert.equal('physicalDirectVerified' in b, false);
});
for (const [name, mutate] of [
  ['account', f => f.proof.scope.accountId = 'other'], ['community', f => f.proof.scope.communityId = 'other'],
  ['server instance', f => f.proof.scope.serverInstanceId = 'other'], ['device', f => f.proof.scope.deviceId = 'other'],
  ['grant', f => f.proof.grantId = 'other'], ['credential', f => f.proof.credentialId = 'other'],
  ['revision', f => f.proof.revision = 2], ['user', f => f.proof.serverUserId = 'other'],
  ['peer', f => f.proof.peerId = 44], ['ip', f => f.proof.virtualIp = '10.77.1.9'],
  ['key', f => f.proof.publicKeyFingerprint = publicKeyFingerprint(ISSUER)], ['direct claim', f => f.proof.physicalDirectVerified = true],
  ['extra field', f => f.proof.secret = SECRET], ['extra scope field', f => f.proof.scope.extra = true],
  ['stale sample', f => f.sample.acquiredAtMs = 4000], ['sample UUID', f => f.sample.instanceId = 'other'],
  ['sample local peer', f => f.sample.info.my_node_info.peer_id = 44], ['missing pin', f => f.observation.issuerPinVerified = false],
]) test('binding rejects mismatched ' + name, () => { const f = fixture(); f.proof = clone(f.proof); mutate(f); assert.throws(() => projected(f)); });
test('binding rejects delayed responses and expired grants', () => {
  const f = fixture();
  assert.throws(() => projectCommunityEtBinding(f.proof, f.grant, f.verified, f.observation, f.sample, 4000, 10001, 2000001, 20000));
  assert.throws(() => projectCommunityEtBinding(f.proof, f.grant, f.verified, f.observation, f.sample, 10000, 10001, 2000001, 10001));
});
for (const origin of ['http://test.invalid', 'https://user@test.invalid', 'https://test.invalid/api', 'https://test.invalid?x=1', 'https://test.invalid#x'])
  test('transport rejects untrusted origin ' + origin, () => assert.throws(() => trustedHttpsOrigin(origin)));
function runtimeFixture() {
  const f = fixture(), calls = [], events = [];
  const target = {communityId: 'community', serverHost: 'test.invalid', origin: 'https://test.invalid', serverInstanceId: 'backend',
    bootstrap: {bootstrapProfileId: 'profile', upstreamCommit: COMMUNITY_ET_UPSTREAM_COMMIT, peerEndpoints: ['tcp://test.invalid:11020'],
      ipv4PrefixLength: 24, issuerPublicKeyB64: ISSUER, issuerPublicKeyFingerprint: publicKeyFingerprint(ISSUER)}};
  let policy = true, failure = null, sampleFailure = null, revision = 0, cores = 0;
  const port = {post: async (_origin, op, bearer, body, signal) => {
    calls.push({op, bearer, body: clone(body)}); if (signal.aborted) throw new CommunityEtTransportError('request-cancelled');
    if (failure?.op === op) throw new CommunityEtTransportError(failure.code);
    if (op === 'session') return {v: 1, ...clone(f.verified)};
    if (op === 'revoke') { events.push('revoke'); return {v: 1, revoked: true}; }
    if (op === 'binding') return {...clone(f.proof), revision};
    if (op === 'acquire' || op === 'renew') return {...clone(f.grant), requestId: body.requestId, revision: ++revision,
      issuedAtMs: f.now.wall, serverTimeMs: f.now.wall, renewAfterMs: f.now.wall + 30000, expiresAtMs: f.now.wall + 60000};
    throw Error('unexpected operation');
  }};
  const coordinator = new CommunityEtGrantRuntime({target: async () => { if (!policy) throw Error('expired-policy'); return clone(target); },
    identities: async () => ({deviceId: 'device', nativeInstanceId: UUID}), transport: new CommunityEtGrantTransport(port),
    wallMs: () => f.now.wall, monoMs: () => f.now.mono,
    write: async (_id, _uuid, _network, draft, signal) => {
      assert.equal(signal.aborted, false); draft.withPrivateToml(text => assert.ok(text.includes('peer_public_key')));
      events.push('write'); return {config: {serverId: 'community', instanceId: UUID, networkName: f.intent.networkName,
        configFile: 'FIXTURE-ONLY', configSha256: '0'.repeat(64), bootstrap: 'product-owned'}, remove: async () => events.push('remove')};
    }});
  const physical = {activationReason: () => null, shutdownOwned: () => events.push('shutdown'), connect: async scope => {
    cores++; assert.ok(await coordinator.configuration(scope.serverId, scope.signal)); events.push('start');
    let closed = false; return {instanceId: UUID, close: async () => { if (!closed) {events.push('stop'); closed = true;} },
      read: denied, readCredentialSample: async () => {
        if (sampleFailure) throw new EasyTierOperationError(sampleFailure);
        assert.equal(closed, false); events.push('sample'); return {observation: clone(f.observation),
          sample: {...clone(f.sample), generation: scope.generation, acquiredAtMs: f.now.mono, acquiredAtUnixMs: f.now.wall}};
      }};
  }};
  return {...f, calls, events, coordinator, physical, runtime: coordinator.wrap(physical), setPolicy: v => policy = v,
    setFailure: v => failure = v, setSampleFailure: v => sampleFailure = v, cores: () => cores,
    authenticate: token => coordinator.setAuthenticatedSession({serverId: 'community', host: 'test.invalid', accessToken: token}),
    connect: () => coordinator.wrap(physical).connect({serverId: 'community', generation: 1, signal: new AbortController().signal})};
}
test('real wiring reaches private config, same-sample proof and public binding through injected ports', async () => {
  const f = runtimeFixture(); await f.authenticate('opaque'); const s = await f.connect(); const sample = await s.read(new AbortController().signal);
  assert.equal(sample.bindings.length, 1); assert.equal(sample.bindings[0].userId, 'member');
  assert.deepEqual(f.calls.map(x => x.op), ['session', 'acquire', 'binding']); assert.equal(f.events.filter(x => x === 'sample').length, 1);
  assert.equal(JSON.stringify(sample).includes(SECRET), false); await s.close();
  assert.deepEqual(f.events.slice(-3), ['stop', 'remove', 'revoke']);
});
test('refreshing the authenticated bearer preserves the owned core and grant key', async () => {
  const f = runtimeFixture(); await f.authenticate('one'); const s = await f.connect();
  const refreshed = await f.authenticate('two'); assert.equal(refreshed.changed, false); assert.equal(f.cores(), 1);
  f.now.wall += 31000; f.now.mono += 31000; await s.read(new AbortController().signal);
  assert.equal(f.calls.find(x => x.op === 'renew').bearer, 'two'); assert.equal(f.cores(), 1); await s.close();
});
test('native readiness rejection cannot acquire a device credential or write a secret config', async () => {
  const f = runtimeFixture(); await f.authenticate('one');
  f.physical.assertReady = async () => { throw Error('permission-not-ready'); };
  await assert.rejects(f.connect());
  assert.equal(f.calls.some(x => x.op === 'acquire'), false);
  assert.equal(f.events.includes('write'), false); assert.equal(f.cores(), 0);
});
test('transient session HTTP failure keeps the current owned core', async () => {
  const f = runtimeFixture(); await f.authenticate('one'); const s = await f.connect();
  f.setFailure({op: 'session', code: 'provider-unavailable'}); await assert.rejects(f.authenticate('two'));
  assert.equal(f.events.includes('stop'), false); await s.read(new AbortController().signal); await s.close();
});
test('genuine auth loss stops owned native before revoke and produces retirement, not telemetry', async () => {
  const f = runtimeFixture(); await f.authenticate('one'); await f.connect();
  f.setFailure({op: 'session', code: 'auth-unavailable'});
  await assert.rejects(f.authenticate('two'), e => e instanceof EasyTierSessionRetiredError);
  assert.deepEqual(f.events.slice(-3), ['stop', 'remove', 'revoke']); await assert.rejects(f.connect());
});
test('policy expiry retires owned native and rejects binding', async () => {
  const f = runtimeFixture(); await f.authenticate('one'); const s = await f.connect(); f.setPolicy(false);
  await assert.rejects(s.read(new AbortController().signal), e => e instanceof EasyTierSessionRetiredError);
  assert.deepEqual(f.events.slice(-3), ['stop', 'remove', 'revoke']); assert.equal(f.calls.some(x => x.op === 'binding'), false);
});
test('TTL expiry retains exact grant ID for revoke after gate expiry', async () => {
  const f = runtimeFixture(); await f.authenticate('one'); const s = await f.connect(); f.now.wall += 61000; f.now.mono += 61000;
  await assert.rejects(s.read(new AbortController().signal), e => e instanceof EasyTierSessionRetiredError);
  assert.equal(f.calls.find(x => x.op === 'revoke').body.grantId, 'grant');
});
test('unknown revoke stops core, retains cleanup failure and prevents next acquire', async () => {
  const f = runtimeFixture(); await f.authenticate('one'); const s = await f.connect(); f.setFailure({op: 'revoke', code: 'provider-unavailable'});
  await assert.rejects(s.close()); assert.deepEqual(f.events.slice(-2), ['stop', 'remove']);
  await assert.rejects(f.connect()); assert.equal(f.calls.filter(x => x.op === 'acquire').length, 1);
  f.setFailure(null); await s.close();
});
test('disabling/closing and re-enabling reacquires with a new gate without a second concurrent core', async () => {
  const f = runtimeFixture(); await f.authenticate('one'); const a = await f.connect(); await a.close();
  const b = await f.connect(); assert.equal(f.cores(), 2); await b.read(new AbortController().signal); await b.close();
});
test('401 from binding retires the owned core', async () => {
  const f = runtimeFixture(); await f.authenticate('one'); const s = await f.connect(); f.setFailure({op: 'binding', code: 'auth-unavailable'});
  await assert.rejects(s.read(new AbortController().signal), e => e instanceof EasyTierSessionRetiredError);
  assert.deepEqual(f.events.slice(-3), ['stop', 'remove', 'revoke']);
});
test('ordinary app shutdown drains exact core, secret file and backend revoke once', async () => {
  const f = runtimeFixture(); await f.authenticate('one'); await f.connect();
  f.runtime.shutdownOwned(); await f.coordinator.drainOwned();
  assert.equal(f.events.filter(x => x === 'stop').length, 1);
  assert.equal(f.events.filter(x => x === 'remove').length, 1);
  assert.equal(f.calls.filter(x => x.op === 'revoke').length, 1);
  await assert.rejects(f.authenticate('new'));
});
test('manager does not present connected after real retirement', async () => {
  const f = runtimeFixture(); await f.authenticate('one'); const manager = new EasyTierCommunityManager(f.runtime);
  await manager.setEnabled(true); await manager.connect({serverId: 'community', leaseId: 'renderer-community'});
  await manager.refresh('community'); assert.equal(manager.getState('community').phase, 'connected'); f.setPolicy(false);
  await manager.refresh('community'); assert.equal(manager.getState('community').phase, 'error');
  assert.equal(manager.getState('community').virtualIp, null); await manager.setEnabled(false);
});

test('native process exit retires the grant and same-token authentication can replace it', async () => {
  const f = runtimeFixture(); await f.authenticate('one'); const manager = new EasyTierCommunityManager(f.runtime);
  await manager.setEnabled(true); await manager.connect({serverId: 'community', leaseId: 'renderer-community'});
  f.setSampleFailure('runtime-exited'); await manager.refresh('community');
  assert.equal(manager.getState('community').phase, 'error');
  assert.equal(manager.getState('community').reason, 'runtime-exited');
  assert.deepEqual(f.events.slice(-3), ['stop', 'remove', 'revoke']);
  f.setSampleFailure(null); assert.equal((await f.authenticate('one')).changed, true);
  await manager.authenticatedSessionChanged('community'); await manager.refresh('community');
  assert.equal(manager.getState('community').phase, 'connected'); assert.equal(f.cores(), 2);
  await manager.setEnabled(false);
});
test('a transient CLI telemetry failure does not retire or restart the live core', async () => {
  const f = runtimeFixture(); await f.authenticate('one'); const s = await f.connect();
  f.setSampleFailure('status-unavailable');
  await assert.rejects(s.read(new AbortController().signal), e => !(e instanceof EasyTierSessionRetiredError));
  assert.equal(f.events.includes('stop'), false); assert.equal(f.calls.some(c => c.op === 'revoke'), false);
  f.setSampleFailure(null); await s.read(new AbortController().signal); await s.close();
});

test('HTTP 503 during acquire is retried through the real enrollment and grant runtime', async () => {
  const f = runtimeFixture(), timers = [], member = {serverId: 'community', host: 'test.invalid', accessToken: 'opaque'};
  // The injected port models the HTTP transport after its status mapping: the first
  // acquire is a provider 503, then the backend returns a normal grant.
  f.setFailure({op: 'acquire', code: 'provider-unavailable'});
  let enrollment;
  const manager = new EasyTierCommunityManager(f.runtime, state => enrollment?.observe(state));
  enrollment = new CommunityEnrollment({manager, supports: m => m.serverId === member.serverId && m.host === member.host,
    approve: async () => ({accepted: true}), authenticate: value => f.authenticate(value.accessToken),
    releasePreparation: () => undefined, preparationReady: () => true,
    schedule: (work, delayMs) => { const timer = {work, delayMs, cancelled: false}; timers.push(timer); return () => { timer.cancelled = true; }; }});

  const first = await enrollment.reconcile({members: [member], enabled: true});
  assert.equal(first[0].phase, 'error');
  assert.equal(first[0].reason, 'connect-failed');
  assert.equal(timers[0].delayMs, 5000);
  assert.equal(f.calls.filter(call => call.op === 'session').length, 1);
  assert.equal(f.calls.filter(call => call.op === 'acquire').length, 1);
  assert.equal(f.events.includes('write'), false);
  assert.equal(f.cores(), 0);

  f.setFailure(null);
  const retry = timers.find(timer => !timer.cancelled);
  assert.ok(retry);
  retry.cancelled = true;
  retry.work();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(manager.getState(member.serverId).phase, 'connected');
  assert.equal(f.calls.filter(call => call.op === 'session').length, 1, 'retry must reuse the authenticated session');
  assert.equal(f.calls.filter(call => call.op === 'acquire').length, 2, 'retry must request a new community grant');
  assert.equal(f.events.filter(event => event === 'write').length, 1);
  assert.equal(f.events.filter(event => event === 'start').length, 1);
  assert.equal(f.cores(), 1);

  await enrollment.reconcile({members: [], enabled: false});
  enrollment.shutdown();
});
test('authenticated IPC rejects untrusted frame before any transport operation', async () => {
  const handlers = {}, f = runtimeFixture(), manager = new EasyTierCommunityManager(f.runtime);
  const unregister = registerEasyTierCommunityIpc({handle: (name, callback) => handlers[name] = callback,
    removeHandler: name => delete handlers[name]}, manager, e => e.senderFrame === 'trusted', undefined,
  input => f.coordinator.setAuthenticatedSession(input));
  assert.throws(() => handlers['et-community-authenticated-session']({senderFrame: 'other'}, {}));
  assert.equal(f.calls.length, 0); unregister(); assert.equal(Object.keys(handlers).length, 0);
});
