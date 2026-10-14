import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import {setImmediate} from 'node:timers';
import vm from 'node:vm';

const require = createRequire(import.meta.url), ts = require('typescript'), cache = new Map();
const denied = () => { throw new Error('native-or-network-forbidden'); };
let httpResponseStatus = null;
let httpResponseBody = '{}';
function load(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  const mod = {exports: {}}; cache.set(url.href, mod.exports);
  const code = ts.transpileModule(readFileSync(url, 'utf8'), {compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }}).outputText;
  const local = name => {
    if (['node:crypto', 'node:path'].includes(name)) return require(name);
    if (name === 'node:https') return {request: (_target, _options, callback) => {
      if (httpResponseStatus === null) return denied();
      const req = new EventEmitter(), statusCode = httpResponseStatus;
      req.end = () => queueMicrotask(() => {
        const res = new EventEmitter(); res.statusCode = statusCode; callback(res);
        res.emit('data', Buffer.from(httpResponseBody)); res.emit('end');
      });
      req.destroy = () => undefined; return req;
    }};
    if (name === 'node:dgram') return {createSocket: denied};
    if (name === 'node:net') return {createServer: denied};
    if (name === 'node:child_process') return {execFile: denied, spawn: denied};
    if (name === 'node:fs/promises') return new Proxy({}, {get: () => denied});
    assert.ok(name.startsWith('./') || ['../src/lib/communityNetworkPreferences','../src/lib/communityDnsNames'].includes(name), 'Only reviewed local pure modules are loaded');
    return load(new URL(name + '.ts', url));
  };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', {filename: url.pathname})(local, mod, mod.exports);
  return mod.exports;
}
const {publicKeyFingerprint, COMMUNITY_ET_UPSTREAM_COMMIT} = load(new URL('./communityEtGrant.ts', import.meta.url));
const {verifyOwnedCredentialObservation} = load(new URL('./communityEtCredentialObservation.ts', import.meta.url));
const {EASYTIER_V270_ROUTE_LIST_SOURCE} = load(new URL('./easyTierCliNetwork.ts', import.meta.url));
const {projectCommunityEtBinding} = load(new URL('./communityEtBindingProjection.ts', import.meta.url));
const {CommunityEtGrantRuntime} = load(new URL('./communityEtGrantRuntime.ts', import.meta.url));
const {CommunityEtGrantTransport, CommunityEtTransportError, trustedHttpsOrigin, communityEtHttpsPort} = load(new URL('./communityEtGrantTransport.ts', import.meta.url));
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
       secure_auth_level: 'PeerVerified', peer_identity_type: 'Admin', is_closed: false, noise_local_static_pubkey: KEY, noise_remote_static_pubkey: ISSUER,
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
test('proto3 omitted is_closed is accepted only with the pinned EasyTier 2.7 route-list source', () => {
  const f = fixture(); delete f.raw.peer_routes[0].peer.conns[0].is_closed;
  assert.throws(() => verifyOwnedCredentialObservation(f.raw, UUID, f.expected));
  assert.deepEqual(verifyOwnedCredentialObservation(f.raw, UUID, f.expected, EASYTIER_V270_ROUTE_LIST_SOURCE), f.observation);
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
function runtimeFixture(options = {}) {
  const f = fixture(), calls = [], events = [];
  const target = {communityId: 'community', serverHost: 'test.invalid', origin: 'https://test.invalid', serverInstanceId: 'backend',
    bootstrap: {bootstrapProfileId: 'profile', upstreamCommit: COMMUNITY_ET_UPSTREAM_COMMIT, peerEndpoints: ['tcp://test.invalid:11020'],
      ipv4PrefixLength: 24, issuerPublicKeyB64: ISSUER, issuerPublicKeyFingerprint: publicKeyFingerprint(ISSUER)}};
  let policy = true, failure = null, sampleFailure = null, revision = 0, cores = 0;
  const port = {post: async (_origin, op, bearer, body, signal) => {
    calls.push({op, bearer, body: clone(body)}); if (signal.aborted) throw new CommunityEtTransportError('request-cancelled');
    if (failure?.op === op && failure.code === 'stall') return new Promise((_resolve,reject)=>{
      signal.addEventListener('abort',()=>reject(new CommunityEtTransportError('request-cancelled')),{once:true});
    });
    if (failure?.op === op) throw new CommunityEtTransportError(failure.code);
    if (op === 'session') {const reply = {v: 1, ...clone(f.verified)}; await options.beforeSessionReply?.(reply, bearer); return reply;}
    if (op === 'revoke') { events.push('revoke'); return {v: 1, revoked: true}; }
    if (op === 'binding') {const reply = {...clone(f.proof), revision}; await options.beforeBindingReply?.(reply); return reply;}
    if (op === 'directory') return options.directory ? options.directory(body, f, signal) : {v: 1, communityId: 'community', members: [{serverUserId: 'member', virtualIp: '10.77.1.2'}]};
    if (op.startsWith('relay') && options.relayBackend) {
      const reply = await options.relayBackend(op, body, f, revision, signal);
      revision = reply.grant.revision; return reply;
    }
    if (op === 'acquire' || op === 'renew') {const reply = {...clone(f.grant), requestId: body.requestId, revision: ++revision,
      issuedAtMs: f.now.wall, serverTimeMs: f.now.wall, renewAfterMs: f.now.wall + 30000, expiresAtMs: f.now.wall + 60000};
      if (op === 'renew') await options.beforeRenewReply?.(reply); return reply;}
    throw Error('unexpected operation');
  }};
  const coordinator = new CommunityEtGrantRuntime({target: async () => { if (!policy) throw Error('expired-policy'); return clone(target); },
    identities: async () => ({deviceId: 'device', nativeInstanceId: UUID}), transport: new CommunityEtGrantTransport(port, options.diagnostic),
    diagnostic: options.diagnostic,
    wallMs: () => f.now.wall, monoMs: () => f.now.mono, dns: options.dns, relayPreferences: options.relayPreferences,
    write: async (_id, _uuid, _network, draft, signal) => {
      assert.equal(signal.aborted, false); draft.withPrivateToml(text => assert.ok(text.includes('peer_public_key')));
      events.push('write'); return {config: {serverId: 'community', instanceId: UUID, networkName: f.intent.networkName,
        configFile: 'FIXTURE-ONLY', configSha256: '0'.repeat(64), bootstrap: 'product-owned'}, remove: async () => events.push('remove')};
    }});
  const physical = {activationReason: () => null, shutdownOwned: () => events.push('shutdown'), connect: async scope => {
    cores++; assert.ok(await coordinator.configuration(scope.serverId, scope.signal)); events.push('start');
    await options.beforePhysicalConnected?.(scope);
    let closed = false; return {instanceId: UUID, close: async () => { if (!closed) {events.push('stop'); closed = true;} },
      applyRelayBudget: options.applyRelayBudget,
      read: denied, readCredentialSample: async signal => {
        if (sampleFailure) throw sampleFailure instanceof Error ? sampleFailure : new EasyTierOperationError(sampleFailure);
        await options.beforeSample?.(signal);
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
  assert.deepEqual(f.calls.map(x => x.op), ['session', 'acquire', 'binding', 'directory']); assert.equal(f.events.filter(x => x === 'sample').length, 1);
  assert.deepEqual(sample.directory, [{serverUserId: 'member', virtualIp: '10.77.1.2'}]);
  assert.equal(sample.directoryObservedAtUnixMs,f.now.wall);
  assert.equal(JSON.stringify(sample).includes(SECRET), false); await s.close();
  assert.deepEqual(f.events.slice(-3), ['stop', 'remove', 'revoke']);
});
test('directory node proof is normalized once, refreshed before expiry and removed on optional outage',async()=>{
  let mode='good';
  const f=runtimeFixture({directory:(body,fixture)=>{
    assert.equal(body.includeBindings,true);
    if(mode==='outage')throw new CommunityEtTransportError('provider-unavailable');
    return {v:1,communityId:'community',members:[{serverUserId:'remote',virtualIp:'10.77.1.3'}],
      bindings:{serverTimeMs:fixture.now.wall+90000,maxAgeMs:5000,members:[{serverUserId:'remote',virtualIp:'10.77.1.3',peerId:22,expiresAtMs:fixture.now.wall+95000}]}};
  }});
  await f.authenticate('one');const session=await f.connect();
  const first=await session.read(new AbortController().signal),remote=first.bindings.find(row=>row.userId==='remote');
  assert.ok(remote);assert.equal(remote.expiresAtMs,f.now.mono+5000);assert.equal(remote.observedAtUnixMs,f.now.wall);
  f.now.mono+=1000;f.now.wall+=1000;
  const cached=await session.read(new AbortController().signal);
  assert.equal(cached.bindings.find(row=>row.userId==='remote').expiresAtMs,remote.expiresAtMs);
  assert.equal(f.calls.filter(call=>call.op==='directory').length,1);
  f.now.mono+=1000;f.now.wall+=1000;
  const fresh=await session.read(new AbortController().signal);
  assert.equal(f.calls.filter(call=>call.op==='directory').length,2);
  assert.equal(fresh.bindings.find(row=>row.userId==='remote').expiresAtMs,f.now.mono+5000);
  mode='outage';f.now.mono+=2000;f.now.wall+=2000;
  const absent=await session.read(new AbortController().signal);
  assert.equal(absent.bindings.length,1);assert.equal(f.cores(),1);assert.equal(f.events.includes('stop'),false);await session.close();
});
test('node directory parser rejects duplicate peers, unexpected fields, unassigned IPs and unbounded lifetime',()=>{
  const transport=new CommunityEtGrantTransport({post:denied}),members=[{serverUserId:'remote',virtualIp:'10.77.1.3'}];
  const good=()=>({serverTimeMs:100000,maxAgeMs:5000,members:[{...members[0],peerId:22,expiresAtMs:105000}]});
  assert.equal(transport.parseDirectoryBindings(good(),members).members.length,1);
  for(const mutate of [v=>v.members.push({...v.members[0]}),v=>v.members[0].peerId=0,v=>v.members[0].virtualIp='10.77.1.9',
    v=>v.members[0].expiresAtMs=105001,v=>v.members[0].expiresAtMs=100000,v=>v.members[0].physicalDirectVerified=true]) {
    const value=good();mutate(value);assert.throws(()=>transport.parseDirectoryBindings(value,members),/invalid-response/);
  }
});
test('slow directory HTTP consumes the node lifetime and cached refreshes never reclaim it',async()=>{
  const f=runtimeFixture({directory:(_body,fixture)=>{
    fixture.now.mono+=800;fixture.now.wall+=800;
    return {v:1,communityId:'community',members:[{serverUserId:'remote',virtualIp:'10.77.1.3'}],
      bindings:{serverTimeMs:fixture.now.wall,maxAgeMs:5000,members:[{serverUserId:'remote',virtualIp:'10.77.1.3',peerId:22,expiresAtMs:fixture.now.wall+5000}]}};
  }});
  await f.authenticate('one');const session=await f.connect();const started=f.now.mono;
  const first=await session.read(new AbortController().signal),proof=first.bindings.find(row=>row.userId==='remote');
  assert.equal(proof.expiresAtMs,started+5000);assert.equal(proof.expiresAtMs-f.now.mono,4200);
  f.now.mono+=1000;f.now.wall+=1000;const cached=await session.read(new AbortController().signal);
  assert.equal(cached.bindings.find(row=>row.userId==='remote').expiresAtMs,proof.expiresAtMs);
  assert.equal(f.calls.filter(call=>call.op==='directory').length,1);await session.close();
});

test('real coordinator joins V2 qualification to V1 LAN gate and zeroes relay on telemetry failure without stopping LAN', async () => {
  const budgets = [], keys = [], saved = [];
  let consent = {v: 2, enabled: false, revision: 0, bytesPerSecond: 0}, relayGrant = null;
  const f = runtimeFixture({
    relayPreferences: {read: key => {keys.push(key); return {enabled: true, bytesPerSecond: 32000};}, write: (key, value) => saved.push({key, value})},
    applyRelayBudget: async (budget, lease) => {budgets.push([budget, lease]); return {schemaVersion: 1, capability: 'member-relay-budget-lease-v1',
      instanceId: UUID, bytesPerSec: budget, leaseRemainingMs: lease, maxLeaseMs: 15000, applied: true};},
    relayBackend: (op, body, fixture, revision) => {
      if (!relayGrant) relayGrant = {...clone(fixture.grant), revision};
      if (op === 'relay') { consent = {v: 2, enabled: body.enabled, revision: consent.revision + 1, bytesPerSecond: body.bytesPerSecond}; relayGrant.revision++; }
      if (op === 'relay-renew') {relayGrant.revision++; relayGrant.issuedAtMs = fixture.now.wall; relayGrant.renewAfterMs = fixture.now.wall + 30000; relayGrant.expiresAtMs = fixture.now.wall + 60000;}
      return {v: 2, consent: clone(consent), grant: {...clone(relayGrant), v: 2, requestId: body.requestId, serverTimeMs: fixture.now.wall,
        policy: {reusable: false, allowRelay: consent.enabled, allowedProxyCidrs: [], relay: clone(consent)}}};
    },
  });
  await f.authenticate('opaque'); const session = await f.connect(); await new Promise(setImmediate); assert.deepEqual(budgets, [[0, 0]]);
  await session.read(new AbortController().signal); await new Promise(setImmediate); assert.equal(f.coordinator.getRelayState('community').status, 'active');
  assert.equal(keys.length, 1); assert.match(keys[0], /^[a-f0-9]{64}$/); assert.equal(keys[0].includes('account'), false);
  f.now.mono += 4000; f.now.wall += 4000; await session.read(new AbortController().signal); await new Promise(setImmediate);
  assert.ok(f.calls.some(c => c.op === 'relay-renew')); assert.equal(f.cores(), 1);
  f.setSampleFailure('status-unavailable'); await assert.rejects(session.read(new AbortController().signal));
  await new Promise(setImmediate);
  assert.deepEqual(budgets.at(-1), [0, 0]); assert.equal(f.events.includes('stop'), false);
  f.setSampleFailure(null); await session.read(new AbortController().signal); await new Promise(setImmediate);
  await f.coordinator.setRelayPreference({v: 1, serverId: 'community', enabled: false, bytesPerSecond: 0});
  assert.deepEqual(budgets.at(-1), [0, 0]); assert.equal(f.coordinator.getRelayState('community').desiredEnabled, false);
  assert.deepEqual(saved, [{key: keys[0], value: {enabled: false, bytesPerSecond: 0}}]);
  await session.read(new AbortController().signal); assert.equal(consent.enabled, false); await session.close();
});

test('old backend optional relay rejection keeps authenticated binding and native core alive', async () => {
  const budgets = [];
  const f = runtimeFixture({relayPreferences: {read: () => ({enabled: true, bytesPerSecond: 32000}), write: denied},
    applyRelayBudget: async (budget, lease) => {budgets.push([budget, lease]); return {schemaVersion: 1, capability: 'member-relay-budget-lease-v1',
      instanceId: UUID, bytesPerSec: budget, leaseRemainingMs: lease, maxLeaseMs: 15000, applied: true};}});
  await f.authenticate('opaque'); const session = await f.connect(); const sample = await session.read(new AbortController().signal);
  await new Promise(setImmediate);
  assert.equal(sample.bindings[0].authenticated, true); assert.equal(f.coordinator.getRelayState('community').reason, 'backend-unavailable');
  assert.equal(f.events.includes('stop'), false); assert.ok(budgets.every(([budget]) => budget === 0)); await session.close();
});

function relayRuntimeFixture(options = {}) {
  const budgets = [], keys = []; let remote = null, consent = {v: 2, enabled: false, revision: 0, bytesPerSecond: 0};
  const f = runtimeFixture({...options,
    relayPreferences: options.relayPreferences ?? {read: key => {keys.push(key); return {enabled: true, bytesPerSecond: 32000};}, write: () => undefined},
    applyRelayBudget: async (budget, lease, signal) => {budgets.push([budget, lease]); await options.nativeHook?.(budget, lease, signal);
      return {schemaVersion: 1, capability: 'member-relay-budget-lease-v1', instanceId: UUID, bytesPerSec: budget,
        leaseRemainingMs: lease, maxLeaseMs: 15000, applied: true};},
    beforeRenewReply: async reply => {remote = clone(reply); await options.beforeRenewReply?.(reply);},
    relayBackend: async (op, body, fixture, revision, signal) => {
      if (!remote) remote = {...clone(fixture.grant), revision};
      if (op === 'relay') {consent = {v: 2, enabled: body.enabled, revision: consent.revision + 1, bytesPerSecond: body.bytesPerSecond}; remote.revision++;}
      if (op === 'relay-renew') {remote.revision++; remote.issuedAtMs = fixture.now.wall; remote.renewAfterMs = fixture.now.wall + 30000; remote.expiresAtMs = fixture.now.wall + 60000;}
      const reply = {v: 2, consent: clone(consent), grant: {...clone(remote), v: 2, requestId: body.requestId, serverTimeMs: fixture.now.wall,
        policy: {reusable: false, allowRelay: consent.enabled, allowedProxyCidrs: [], relay: clone(consent)}}};
      await options.afterRelayReply?.(op, reply, signal); return reply;
    }});
  return {...f, budgets, keys, consent: () => clone(consent)};
}
const flush = () => new Promise(setImmediate);
test('optional native startup probe and drain cannot hold LAN connect or owned core stop', async () => {
  let release; const pending = new Promise(r => release = r);
  const f = relayRuntimeFixture({nativeHook: () => pending}); await f.authenticate('opaque');
  const session = await f.connect(); const sample = await session.read(new AbortController().signal);
  assert.equal(sample.bindings[0].authenticated, true); assert.equal(f.coordinator.getRelayState('community').localBudgetApplied, false);
  const close = session.close(); await flush(); assert.ok(f.events.includes('stop'));
  release(); await close;
});
test('optional positive native ACK is background and cannot delay a required LAN sample', async () => {
  let release, entered; const started = new Promise(r => entered = r), pending = new Promise(r => release = r);
  const f = relayRuntimeFixture({nativeHook: async budget => {if (budget) {entered(); await pending;}}});
  await f.authenticate('opaque'); const session = await f.connect(); await flush();
  const sample = await session.read(new AbortController().signal); await started;
  assert.equal(sample.bindings[0].authenticated, true); assert.equal(f.coordinator.getRelayState('community').localBudgetApplied, false);
  release(); await flush(); assert.equal(f.coordinator.getRelayState('community').status, 'active'); await session.close();
});
test('ordinary renew response and concurrent disable cannot cross gate tickets or restart LAN', async () => {
  let release, entered; const started = new Promise(r => entered = r), pending = new Promise(r => release = r);
  const f = relayRuntimeFixture({beforeRenewReply: async () => {entered(); await pending;}});
  await f.authenticate('opaque'); const session = await f.connect(); await flush(); await session.read(new AbortController().signal); await flush();
  f.now.mono += 31000; f.now.wall += 31000;
  const read = session.read(new AbortController().signal); await started;
  const disable = f.coordinator.setRelayPreference({v: 1, serverId: 'community', enabled: false, bytesPerSecond: 0});
  await flush(); assert.deepEqual(f.budgets.at(-1), [0, 0]); assert.equal(f.calls.at(-1).op, 'renew');
  release(); const [sample] = await Promise.all([read, disable]); await flush();
  assert.equal(sample.bindings[0].authenticated, true); assert.equal(f.consent().enabled, false); assert.equal(f.cores(), 1);
  assert.equal(f.events.includes('stop'), false); await session.close();
});
test('optional queued withdrawal has bounded cancellation and cannot dispatch after its deadline', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let release, entered; const started = new Promise(r => entered = r), pending = new Promise(r => release = r);
  const f = relayRuntimeFixture({beforeRenewReply: async () => {entered(); await pending;}});
  await f.authenticate('opaque'); const session = await f.connect(); await flush(); await session.read(new AbortController().signal); await flush();
  f.now.mono += 31000; f.now.wall += 31000; const read = session.read(new AbortController().signal); await started;
  const disable = f.coordinator.setRelayPreference({v: 1, serverId: 'community', enabled: false, bytesPerSecond: 0}); await flush();
  const count = f.calls.length; t.mock.timers.tick(1000); await disable;
  // Suppress a legitimate new reconciliation from a later fresh sample so this
  // assertion observes only the cancelled queued job.
  f.setSampleFailure('status-unavailable'); release(); await assert.rejects(read); await flush();
  assert.equal(f.calls.slice(count).some(c => c.op.startsWith('relay')), false);
  assert.equal(f.coordinator.getRelayState('community').desiredEnabled, false); await session.close();
});
test('required LAN renewal cancels optional HTTPS instead of waiting for its one-second window', async () => {
  let entered, hold = false, cancelled = false; const started = new Promise(r => entered = r);
  const f = relayRuntimeFixture({afterRelayReply: async (op, _reply, signal) => {
    if (hold && op === 'relay-status') {entered(); await new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
      cancelled = true; reject(new CommunityEtTransportError('request-cancelled'));
    }, {once: true}));}
  }});
  await f.authenticate('opaque'); const session = await f.connect(); await flush(); await session.read(new AbortController().signal); await flush();
  hold = true; f.now.mono += 4000; f.now.wall += 4000; await session.read(new AbortController().signal); await started;
  f.now.mono += 27000; f.now.wall += 27000; const sample = await session.read(new AbortController().signal);
  assert.equal(cancelled, true); assert.equal(sample.bindings[0].authenticated, true); assert.equal(f.events.includes('stop'), false); await session.close();
});
test('late old binding uses its actually accepted old grant and cannot borrow renewed expiry', async () => {
  let release, entered, hold = false; const started = new Promise(r => entered = r), pending = new Promise(r => release = r);
  const f = relayRuntimeFixture({beforeBindingReply: async () => {if (hold) {entered(); await pending;}}});
  await f.authenticate('opaque'); const session = await f.connect(); await flush(); await session.read(new AbortController().signal); await flush();
  hold = true; const read = session.read(new AbortController().signal); await started;
  await f.coordinator.setRelayPreference({v: 1, serverId: 'community', enabled: false, bytesPerSecond: 0});
  release(); const sample = await read; assert.equal(sample.bindings[0].authenticated, true);
  assert.ok(sample.bindings[0].expiresAtMs <= f.now.mono + 5000); assert.equal(f.events.includes('stop'), false); await session.close();
});
test('pending old-account relay reply cannot survive authenticated account replacement', async () => {
  let entered; const started = new Promise(r => entered = r);
  const keys = [];
  const f = relayRuntimeFixture({relayPreferences: {read: key => {keys.push(key); return keys.length === 1 ? {enabled: true, bytesPerSecond: 32000} : null;}, write: () => undefined},
    afterRelayReply: async (op, _reply, signal) => {if (op === 'relay-status') {entered(); await new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(new CommunityEtTransportError('request-cancelled')), {once: true}));}}});
  await f.authenticate('opaque'); const session = await f.connect(); await flush(); await session.read(new AbortController().signal); await started;
  f.verified.intent.accountId = 'new-account'; await f.authenticate('replacement'); await flush();
  const state = f.coordinator.getRelayState('community'); assert.equal(state.desiredEnabled, false); assert.equal(state.localBudgetApplied, false);
  assert.notEqual(keys[0], keys[1]); assert.equal(f.events.filter(e => e === 'stop').length, 1); assert.ok(f.budgets.every(([budget]) => budget === 0));
});

test('directory parser keeps all device addresses but rejects cross-community, duplicates and client claims',()=>{
  const transport=new CommunityEtGrantTransport();
  const response={v:1,communityId:'community',members:[{serverUserId:'member',virtualIp:'10.77.1.2'},{serverUserId:'member',virtualIp:'10.77.1.3'}]};
  assert.deepEqual(transport.parseDirectory(response,'community'),response.members);
  for(const mutate of [r=>r.communityId='other',r=>r.members[1].virtualIp='10.77.1.2',r=>r.members[0].virtualIp='198.51.100.1',r=>r.members[0].deviceId='untrusted']){
    const r=clone(response);mutate(r);assert.throws(()=>transport.parseDirectory(r,'community'));
  }
});

const dnsZone = 'c-' + 'a'.repeat(32) + '.lan.voice.ruikang.wang.';
const dnsName = 'd-' + 'b'.repeat(32) + '.' + dnsZone;
function dnsDirectory(_body, f) {
  return {v: 1, communityId: 'community', dns: {zone: dnsZone, serverTimeMs: f.now.wall + 100_000, maxAgeMs: 10000},
    members: [{serverUserId: 'member', virtualIp: '10.77.1.2', dnsName, dnsExpiresAtMs: f.now.wall + 110_000}]};
}
test('HTTP extension negotiation distinguishes explicit directory 400 from auth and provider errors', async () => {
  try {
    for (const [status, operation, body, code] of [
      [400,'directory',{v:1,communityId:'community',includeDnsNames:true,dnsNameStyle:'friendly'},'directory-extension-unsupported'],
      [400,'directory',{v:1,communityId:'community',includeDnsNames:true},'directory-extension-unsupported'],
      [400,'directory',{v:1,communityId:'community'},'provider-unavailable'],
      [400,'session',{includeDnsNames:true},'provider-unavailable'],
      [401,'directory',{includeDnsNames:true},'auth-unavailable'],
      [403,'directory',{includeDnsNames:true},'auth-unavailable'],
      [404,'directory',{includeDnsNames:true},'provider-unavailable'],
      [503,'directory',{includeDnsNames:true},'provider-unavailable'],
    ]) {
      httpResponseStatus=status;
      await assert.rejects(communityEtHttpsPort.post('https://test.invalid',operation,'fixture-bearer',body,new AbortController().signal),
        error=>error instanceof CommunityEtTransportError && error.code===code);
    }
  } finally { httpResponseStatus=null; }
});
test('DNS is exposed only after local policy readiness; server clock offset does not extend its TTL', async () => {
  let ready = false; const published = [], cleared = [];
  const f = runtimeFixture({directory: dnsDirectory, dns: {publish: (...args) => published.push(args), clear: id => cleared.push(id), isReady: () => ready}});
  await f.authenticate('one'); const s = await f.connect();
  const first = await s.read(new AbortController().signal);
  assert.equal(first.dnsReady, false); assert.deepEqual(first.dnsAddresses, []); assert.equal(published.length, 1);
  assert.equal(f.calls.find(call => call.op === 'directory').body.includeDnsNames, true);
  assert.equal(f.calls.find(call => call.op === 'directory').body.dnsNameStyle, 'friendly');
  ready = true; f.now.mono += 100; f.now.wall += 100;
  const next = await s.read(new AbortController().signal);
  assert.deepEqual(next.dnsAddresses, [{dnsName, virtualIp: '10.77.1.2', expiresAtUnixMs: 2010000}]);
  assert.equal(next.directoryObservedAtUnixMs, first.directoryObservedAtUnixMs);
  await s.close(); assert.ok(cleared.includes('community'));
});
test('old backend DNS rejection falls back to authenticated numeric directory without restarting LAN', async () => {
  const cleared = [];
  const f = runtimeFixture({directory: body => {
    if (body.includeDnsNames) throw new CommunityEtTransportError('directory-extension-unsupported');
    return {v: 1, communityId: 'community', members: [{serverUserId: 'member', virtualIp: '10.77.1.2'}]};
  }, dns: {publish: denied, clear: id => cleared.push(id), isReady: () => false}});
  await f.authenticate('one'); const s = await f.connect(); const sample = await s.read(new AbortController().signal);
  assert.equal(sample.directory.length, 1); assert.deepEqual(sample.dnsAddresses, []); assert.equal(f.cores(), 1);
  assert.deepEqual(f.calls.filter(call => call.op === 'directory').map(call => call.body.includeDnsNames), [true, true, true, undefined]);
  assert.deepEqual(f.calls.filter(call => call.op === 'directory').map(call => call.body.dnsNameStyle), ['friendly', 'friendly', undefined, undefined]);
  assert.ok(cleared.includes('community')); await s.close();
});
test('unsupported friendly style retains legacy DNS on an otherwise DNS-capable backend',async()=>{
  const published=[];
  const f=runtimeFixture({directory:(body,value)=>{
    if(body.dnsNameStyle)throw new CommunityEtTransportError('directory-extension-unsupported');
    return dnsDirectory(body,value);
  },dns:{publish:(...args)=>published.push(args),clear:()=>undefined,isReady:()=>true}});
  await f.authenticate('one');const s=await f.connect();const sample=await s.read(new AbortController().signal);
  assert.equal(published.length,1);assert.equal(sample.dnsAddresses[0].dnsName,dnsName);assert.equal(f.cores(),1);
  assert.deepEqual(f.calls.filter(call=>call.op==='directory').map(call=>call.body.dnsNameStyle),['friendly','friendly',undefined]);
  await s.close();
});
test('friendly DNS names retain canonical resolver form in readiness-gated runtime samples',async()=>{
  const published=[];
  const f=runtimeFixture({directory:(body,value)=>{
    assert.equal(body.dnsNameStyle,'friendly');const raw=dnsDirectory(body,value);
    raw.dns.zone='lk.internal.';raw.members[0].dnsName='shizi-12.lk.internal.';return raw;
  },dns:{publish:(...args)=>published.push(args),clear:()=>undefined,isReady:()=>true}});
  await f.authenticate('one');const s=await f.connect();const sample=await s.read(new AbortController().signal);
  assert.equal(sample.dnsAddresses[0].dnsName,'shizi-12.lk.internal.');assert.equal(published[0][1].dns.zone,'lk.internal.');
  assert.equal(f.calls.filter(call=>call.op==='directory').length,1);await s.close();
});
test('DNS provider outage and expired friendly response have no negotiation fallback',async()=>{
  for(const directory of [()=>{throw new CommunityEtTransportError('provider-unavailable');},(body,value)=>{
    const raw=dnsDirectory(body,value);raw.members[0].dnsExpiresAtMs=raw.dns.serverTimeMs;return raw;
  }]) {
    const f=runtimeFixture({directory,dns:{publish:denied,clear:()=>undefined,isReady:()=>false}});
    await f.authenticate('one');const s=await f.connect();const sample=await s.read(new AbortController().signal);
    assert.deepEqual(sample.directory,[]);assert.deepEqual(sample.dnsAddresses,[]);
    assert.equal(f.calls.filter(call=>call.op==='directory').length,1);assert.equal(f.events.includes('stop'),false);await s.close();
  }
});
test('legacy negotiation auth failure retires membership without numeric fallback',async()=>{
  const f=runtimeFixture({directory:body=>{
    if(body.dnsNameStyle)throw new CommunityEtTransportError('directory-extension-unsupported');
    throw new CommunityEtTransportError('auth-unavailable');
  },dns:{publish:denied,clear:()=>undefined,isReady:()=>false}});
  await f.authenticate('one');const s=await f.connect();
  await assert.rejects(s.read(new AbortController().signal),error=>error instanceof EasyTierSessionRetiredError);
  assert.equal(f.calls.filter(call=>call.op==='directory').length,3);assert.ok(f.events.includes('stop'));
});
test('negotiation shares one timeout budget and cannot retry after cancellation',async()=>{
  const signals=[];
  const f=runtimeFixture({directory:(body,_value,signal)=>{
    signals.push(signal);
    if(body.dnsNameStyle)throw new CommunityEtTransportError('directory-extension-unsupported');
    return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new CommunityEtTransportError('request-cancelled')),{once:true}));
  },dns:{publish:denied,clear:()=>undefined,isReady:()=>false}});
  await f.authenticate('one');const s=await f.connect();const sample=await s.read(new AbortController().signal);
  assert.deepEqual(sample.directory,[]);assert.deepEqual(sample.dnsAddresses,[]);
  assert.equal(signals.length,3);assert.ok(signals.every(signal=>signal===signals[0]));assert.equal(signals[2].aborted,true);
  assert.equal(f.calls.filter(call=>call.op==='directory').length,3);assert.equal(f.events.includes('stop'),false);await s.close();
});
test('retired request clock from DNS publication hides names without negotiating or refreshing age',async()=>{
  const f=runtimeFixture({directory:dnsDirectory,dns:{publish:()=>{throw Error('dns-request-retired');},clear:()=>undefined,isReady:()=>false}});
  await f.authenticate('one');const s=await f.connect();const sample=await s.read(new AbortController().signal);
  assert.deepEqual(sample.directory,[]);assert.equal(sample.directoryObservedAtUnixMs,0);assert.deepEqual(sample.dnsAddresses,[]);
  assert.equal(f.calls.filter(call=>call.op==='directory').length,1);assert.equal(f.events.includes('stop'),false);await s.close();
});
test('invalid DNS directory is hidden without replacing it with unverified peer addresses or stopping LAN', async () => {
  const f = runtimeFixture({directory: (body, value) => ({...dnsDirectory(body, value), communityId: 'other'}),
    dns: {publish: denied, clear: () => undefined, isReady: () => false}});
  await f.authenticate('one'); const s = await f.connect(); const sample = await s.read(new AbortController().signal);
  assert.deepEqual(sample.directory, []); assert.deepEqual(sample.dnsAddresses, []);
  assert.equal(sample.bindings[0].enrollment, 'joined'); assert.equal(f.events.includes('stop'), false); await s.close();
});
test('DNS auth refusal has no legacy fallback and retires local membership', async () => {
  const f = runtimeFixture({directory: () => {throw new CommunityEtTransportError('auth-unavailable');},
    dns: {publish: denied, clear: () => undefined, isReady: () => false}});
  await f.authenticate('one'); const s = await f.connect();
  await assert.rejects(s.read(new AbortController().signal), e => e instanceof EasyTierSessionRetiredError);
  assert.equal(f.calls.filter(call => call.op === 'directory').length, 1); assert.ok(f.events.includes('stop'));
});
test('directory cache preserves its age; roster outage hides addresses without stopping LAN',async()=>{
  const f=runtimeFixture();await f.authenticate('one');const s=await f.connect();
  const first=await s.read(new AbortController().signal);
  f.now.mono+=1000;f.now.wall+=1000;
  const cached=await s.read(new AbortController().signal);
  assert.equal(cached.directoryObservedAtUnixMs,first.directoryObservedAtUnixMs);
  assert.equal(f.calls.filter(call=>call.op==='directory').length,1);
  f.now.mono+=5000;f.now.wall+=5000;f.setFailure({op:'directory',code:'provider-unavailable'});
  const failed=await s.read(new AbortController().signal);assert.deepEqual(failed.directory,[]);assert.equal(failed.directoryObservedAtUnixMs,0);
  assert.equal(f.events.includes('stop'),false);assert.equal(failed.bindings[0].enrollment,'joined');
  f.now.mono+=5000;f.now.wall+=5000;f.setFailure(null);
  const recovered=await s.read(new AbortController().signal);assert.equal(recovered.directory.length,1);assert.equal(recovered.directoryObservedAtUnixMs,f.now.wall);
  await s.close();
});
test('directory auth failure retires the exact owned core',async()=>{
  const f=runtimeFixture();await f.authenticate('one');const s=await f.connect();f.setFailure({op:'directory',code:'auth-unavailable'});
  await assert.rejects(s.read(new AbortController().signal),e=>e instanceof EasyTierSessionRetiredError);
  assert.deepEqual(f.events.slice(-3),['stop','remove','revoke']);
});
test('optional directory timeout clears only addresses; a real caller cancellation still propagates',async()=>{
  const f=runtimeFixture();await f.authenticate('one');const s=await f.connect();f.setFailure({op:'directory',code:'stall'});
  const sample=await s.read(new AbortController().signal);
  assert.deepEqual(sample.directory,[]);assert.equal(sample.directoryObservedAtUnixMs,0);assert.equal(sample.bindings[0].enrollment,'joined');
  assert.equal(f.events.includes('stop'),false);
  f.now.mono+=5000;f.now.wall+=5000;
  const cancel=new AbortController(),timer=setTimeout(()=>cancel.abort(),20);
  try{await assert.rejects(s.read(cancel.signal),e=>e instanceof CommunityEtTransportError&&e.code==='request-cancelled');}
  finally{clearTimeout(timer);}
  assert.equal(f.events.includes('stop'),false);f.setFailure(null);await s.close();
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
  await flush(); // The immediate first read is independent of connect completion.
  await manager.refresh('community'); assert.equal(manager.getState('community').phase, 'connected'); f.setPolicy(false);
  await manager.refresh('community'); assert.equal(manager.getState('community').phase, 'error');
  assert.equal(manager.getState('community').virtualIp, null); await manager.setEnabled(false);
});

test('native process exit retires the grant and same-token authentication can replace it', async () => {
  const f = runtimeFixture(); await f.authenticate('one'); const manager = new EasyTierCommunityManager(f.runtime);
  await manager.setEnabled(true); await manager.connect({serverId: 'community', leaseId: 'renderer-community'});
  await flush();
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

for (const failure of ['cli', 'binding']) test('persistent ' + failure + ' observation failure preserves a live enrolled core and recovers fresh proof', async () => {
  const f = runtimeFixture(), timers = [], member = {serverId: 'community', host: 'test.invalid', accessToken: 'opaque'};
  let enrollment;
  const manager = new EasyTierCommunityManager(f.runtime, state => enrollment?.observe(state),
    () => f.now.mono, 8000, 10000, () => f.now.wall);
  enrollment = new CommunityEnrollment({manager, supports: () => true, approve: async () => ({accepted: true}),
    authenticate: value => f.authenticate(value.accessToken), releasePreparation: () => undefined, preparationReady: () => true,
    schedule: (work, delayMs) => {const timer = {work, delayMs, cancelled: false}; timers.push(timer); return () => {timer.cancelled = true;};}});
  try {
    await enrollment.reconcile({members: [member], enabled: true}); await flush(); await manager.refresh('community');
    assert.ok(manager.getState('community').lanSnapshot);
    const generation = manager.getState('community').generation;
    if (failure === 'cli') f.setSampleFailure('status-unavailable');
    else f.setFailure({op: 'binding', code: 'provider-unavailable'});
    for (let i = 0; i < 10; i++) {
      f.now.mono += 2000; f.now.wall += 2000; await manager.refresh('community');
      const state = manager.getState('community');
      assert.equal(state.phase, 'connected'); assert.equal(state.reason, 'status-unavailable');
      assert.equal(state.lanSnapshot, null); assert.equal(state.virtualIp, null);
      assert.equal(timers.filter(timer => !timer.cancelled).length, 0, 'telemetry must not schedule lifecycle recovery');
      // Membership refreshes and independent voice consumers can revisit the same
      // lease while observation is unavailable; they must not restart its core.
      await enrollment.reconcile({members: [member], enabled: true});
      await manager.connect({serverId: 'community', leaseId: 'voice-consumer'});
      await manager.disconnect({serverId: 'community', leaseId: 'voice-consumer'});
      assert.equal(manager.getState('community').generation, generation);
      assert.equal(f.cores(), 1); assert.equal(f.events.includes('stop'), false);
      assert.equal(f.calls.some(call => call.op === 'revoke'), false);
      assert.equal(f.calls.filter(call => call.op === 'acquire').length, 1);
    }
    f.setSampleFailure(null); f.setFailure(null); f.now.mono += 2000; f.now.wall += 2000;
    await manager.refresh('community');
    assert.equal(manager.getState('community').reason, null); assert.ok(manager.getState('community').lanSnapshot);
    assert.equal(f.cores(), 1);
  } finally {enrollment.shutdown(); await manager.setEnabled(false);}
});

test('bounded diagnostics expose HTTP status and safe enums without targets, bodies or errors', async () => {
  const events = [], target = {origin: 'https://secret-host.invalid'};
  const transport = new CommunityEtGrantTransport({post: async (_origin, _operation, _bearer, _body, _signal, onStatus) => {
    onStatus(503); throw Error('secret error / token / raw machine log');
  }}, event => events.push(event));
  await assert.rejects(transport.post(target, 'binding', 'secret-bearer', {secret: SECRET}, new AbortController().signal));
  assert.deepEqual(events, [
    {event: 'http', action: 'start', operation: 'binding', httpStatus: null, code: 'success', reason: null},
    {event: 'http', action: 'finish', operation: 'binding', httpStatus: 503, code: 'provider-unavailable', reason: null},
  ]);
  assert.equal(JSON.stringify(events).includes('secret'), false);
  await assert.rejects(transport.post(target, 'arbitrary-secret-operation', 'secret-bearer', {}, new AbortController().signal));
  assert.equal(events.length, 2, 'unknown operations never enter diagnostic records');
  httpResponseStatus = 401;
  try {
    const realTransport = new CommunityEtGrantTransport(communityEtHttpsPort, event => events.push(event));
    await assert.rejects(realTransport.post(target, 'binding', 'opaque', {}, new AbortController().signal),
      error => error.code === 'auth-unavailable');
    assert.deepEqual(events.at(-1), {event: 'http', action: 'finish', operation: 'binding', httpStatus: 401, code: 'auth-unavailable', reason: null});
  } finally {httpResponseStatus = null;}
});

test('binding HTTP 409 reports only contract service reasons while preserving retryable telemetry semantics', async () => {
  const events = [], transport = new CommunityEtGrantTransport(communityEtHttpsPort, event => events.push(event));
  httpResponseStatus = 409;
  try {
    for (const body of [{v: 1, error: 'binding-pending'}, {v: 1, error: 'provider-sample-conflict'},
      {v: 1, error: 'secret-token-machine-log'}, {v: 1, error: 'binding-unproven', secret: SECRET},
      {v: 99, error: 'binding-unproven'}]) {
      httpResponseBody = JSON.stringify(body);
      await assert.rejects(transport.post({origin: 'https://test.invalid'}, 'binding', 'opaque', {}, new AbortController().signal),
        error => error.code === 'provider-unavailable');
      assert.equal(events.at(-1).httpStatus, 409);
      assert.equal(events.at(-1).reason, ['binding-pending', 'provider-sample-conflict'].includes(body.error) ? body.error : null);
    }
    assert.equal(JSON.stringify(events).includes('secret'), false);
  } finally {httpResponseStatus = null; httpResponseBody = '{}';}
});

test('observer exceptions cannot prevent grant start, auth retirement or shutdown', async () => {
  const events = [], diagnostic = event => {events.push(event); throw Error('observer-failed');};
  const f = runtimeFixture({diagnostic}); await f.authenticate('opaque');
  const manager = new EasyTierCommunityManager(f.runtime, () => {throw Error('observer-failed');},
    () => f.now.mono, 8000, 10000, () => f.now.wall, diagnostic);
  await manager.setEnabled(true); await manager.connect({serverId: 'community', leaseId: 'renderer-community'});
  await flush();
  await manager.refresh('community'); f.setFailure({op: 'binding', code: 'auth-unavailable'});
  await manager.refresh('community');
  assert.equal(manager.getState('community').phase, 'error');
  assert.equal(manager.getState('community').reason, 'configuration-required');
  assert.equal(f.events.filter(event => event === 'stop').length, 1);
  assert.equal(events.filter(event => event.event === 'core-start' && event.action === 'finish').length, 1);
  assert.equal(events.filter(event => event.event === 'core-stop' && event.action === 'finish').length, 1);
  assert.ok(events.some(event => event.event === 'telemetry' && event.code === 'configuration-required'));
  assert.ok(events.every(event => !('serverId' in event) && !('body' in event)));
  await manager.setEnabled(false);
});

test('a timed-out observation cannot permanently block polling or release a newer read lane', async () => {
  const f = fixture(), reads = []; let starts = 0, stops = 0, generation;
  let finishFirstRead;
  const firstReadFinished = new Promise(resolve => {finishFirstRead = resolve;});
  const manager = new EasyTierCommunityManager({activationReason: () => null, shutdownOwned: () => undefined,
    connect: async scope => {starts++; generation = scope.generation; return {instanceId: UUID,
      close: async () => {stops++;}, read: () => new Promise(resolve => reads.push(resolve))};}},
    () => undefined, () => f.now.mono, 30, 10000, () => f.now.wall,
    event => {if (event.event === 'telemetry' && event.action === 'finish') finishFirstRead();});
  await manager.setEnabled(true); await manager.connect({serverId: 'community', leaseId: 'renderer-community'});
  await firstReadFinished; // Await the background read's own deadline, not a coalesced poll.
  assert.equal(manager.getState('community').reason, 'status-unavailable');
  const nextRead = manager.refresh('community'); assert.equal(reads.length, 2, 'poll retries even if the old port ignored abort');
  reads[0]({...clone(f.sample), generation}); await flush();
  await manager.refresh('community'); assert.equal(reads.length, 2, 'a late old result cannot unlock the active lane');
  reads[1]({...clone(f.sample), generation}); await nextRead;
  assert.equal(manager.getState('community').reason, null); assert.equal(starts, 1); assert.equal(stops, 0);
  await manager.setEnabled(false);
});

test('an aborted CLI read cannot retire a live core; a subsequent confirmed exit still retires it', async () => {
  let stall = false;
  const diagnostics = [], f = runtimeFixture({beforeSample: signal => stall ? new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new EasyTierOperationError('runtime-exited')), {once: true});
  }) : undefined});
  await f.authenticate('opaque');
  const manager = new EasyTierCommunityManager(f.runtime, () => undefined, () => f.now.mono, 30, 10000, () => f.now.wall,
    event => diagnostics.push(event));
  await manager.setEnabled(true); await manager.connect({serverId: 'community', leaseId: 'renderer-community'});
  await flush();
  await manager.refresh('community'); stall = true;
  await manager.refresh('community'); await flush();
  assert.equal(manager.getState('community').phase, 'connected'); assert.equal(manager.getState('community').reason, 'status-unavailable');
  assert.ok(diagnostics.some(event => event.event === 'telemetry' && event.reason === 'timeout'));
  assert.equal(f.events.includes('stop'), false); assert.equal(f.calls.some(call => call.op === 'revoke'), false);
  stall = false; await manager.refresh('community'); assert.equal(manager.getState('community').reason, null);
  f.setSampleFailure('runtime-exited'); await manager.refresh('community');
  assert.equal(manager.getState('community').phase, 'error'); assert.equal(manager.getState('community').reason, 'runtime-exited');
  assert.deepEqual(f.events.slice(-3), ['stop', 'remove', 'revoke']); await manager.setEnabled(false);
});

test('telemetry diagnostics preserve only enumerated issuer/CLI causes', async () => {
  const diagnostics = [], f = runtimeFixture(); await f.authenticate('opaque');
  const manager = new EasyTierCommunityManager(f.runtime, () => undefined, () => f.now.mono, 1000, 10000, () => f.now.wall,
    event => diagnostics.push(event));
  await manager.setEnabled(true); await manager.connect({serverId: 'community', leaseId: 'renderer-community'});
  await flush();
  for (const [error, reason] of [[Error('issuer-connection-unverified'), 'issuer-connection-unverified'],
    [new EasyTierOperationError('status-unavailable', 'parse-failed'), 'parse-failed'],
    [new EasyTierOperationError('status-unavailable', 'cli-timeout'), 'cli-timeout'],
    [Error('secret token or machine log'), 'other']]) {
    f.setSampleFailure(error); await manager.refresh('community');
    assert.equal(manager.getState('community').reason, 'status-unavailable');
    assert.equal(diagnostics.at(-1).reason, reason); assert.equal(f.events.includes('stop'), false);
  }
  assert.equal(JSON.stringify(diagnostics).includes('secret'), false); await manager.setEnabled(false);
});

function enrollmentRuntimeFixture(options = {}) {
  const f = runtimeFixture(options), timers = [], member = {serverId: 'community', host: 'test.invalid', accessToken: 'original-fixture'};
  let enrollment;
  const manager = new EasyTierCommunityManager(f.runtime, state => enrollment?.observe(state),
    () => f.now.mono, 1000, 10000, () => f.now.wall);
  enrollment = new CommunityEnrollment({manager, supports: () => true, approve: async () => ({accepted: true}),
    authenticate: async value => {const result = await f.authenticate(value.accessToken); await options.afterAuthenticate?.(value, result); return result;},
    releasePreparation: () => undefined, preparationReady: () => true,
    schedule: (work, delayMs) => {const timer = {work, delayMs, cancelled: false}; timers.push(timer); return () => {timer.cancelled = true;};}});
  return {...f, timers, member, enrollment, manager, snapshot: token => ({members: [{...member, accessToken: token}], enabled: true}),
    retry: async () => {const timer = timers.find(timer => !timer.cancelled); assert.ok(timer); timer.cancelled = true; timer.work();
      for (let i = 0; i < 8; i++) await flush();},
    close: async () => {enrollment.shutdown(); await manager.setEnabled(false);}};
}

test('healthy old-session telemetry cannot cancel pending authentication of a rotated bearer', async () => {
  const f = enrollmentRuntimeFixture();
  try {
    await f.enrollment.reconcile(f.snapshot(f.member.accessToken)); await f.manager.refresh('community');
    f.setFailure({op: 'session', code: 'provider-unavailable'});
    await assert.rejects(f.enrollment.reconcile(f.snapshot('rotated-fixture')));
    const timer = f.timers.find(timer => !timer.cancelled); assert.ok(timer); assert.equal(timer.delayMs, 5000);
    f.now.mono += 2000; f.now.wall += 2000; await f.manager.refresh('community');
    assert.equal(timer.cancelled, false, 'healthy old-token polling does not authenticate the desired new token');
    await f.retry();
    assert.deepEqual(f.timers.map(timer => timer.delayMs), [5000, 10000], 'healthy polling cannot reset auth backoff');
    f.setFailure(null); await f.manager.refresh('community'); await f.retry();
    assert.equal(f.calls.filter(call => call.op === 'session' && call.bearer === 'rotated-fixture').length, 3);
    assert.equal(f.cores(), 1); assert.equal(f.events.includes('stop'), false);
    f.now.mono += 31000; f.now.wall += 31000; await f.manager.refresh('community');
    assert.equal(f.calls.find(call => call.op === 'renew').bearer, 'rotated-fixture');
    assert.equal(f.timers.filter(timer => !timer.cancelled).length, 0);
  } finally {await f.close();}
});

test('changed verified scope after temporary authentication failure replaces the manager session', async () => {
  const f = enrollmentRuntimeFixture();
  try {
    await f.enrollment.reconcile(f.snapshot(f.member.accessToken)); await f.manager.refresh('community');
    f.setFailure({op: 'session', code: 'provider-unavailable'});
    await assert.rejects(f.enrollment.reconcile(f.snapshot('rotated-fixture'))); f.setFailure(null);
    f.verified.serverUserId = 'replacement-member'; f.intent.accountId = 'replacement-account';
    f.scope.accountId = 'replacement-account'; f.grant.scope.accountId = 'replacement-account';
    f.proof.scope.accountId = 'replacement-account'; f.proof.serverUserId = 'replacement-member';
    await f.retry();
    assert.equal(f.cores(), 2, 'retired previous scope must be replaced, even after a failed auth attempt');
    assert.equal(f.events.filter(event => event === 'stop').length, 1);
    await f.manager.refresh('community'); assert.ok(f.manager.getState('community').lanSnapshot);
    assert.equal(f.manager.getState('community').reason, null);
  } finally {await f.close();}
});

for (const fault of ['cli', 'binding']) test('ordinary ' + fault + ' outages leave required renewals active across multiple TTLs', async () => {
  const f = enrollmentRuntimeFixture();
  try {
    await f.enrollment.reconcile(f.snapshot(f.member.accessToken));
    if (fault === 'cli') f.setSampleFailure('status-unavailable');
    else f.setFailure({op: 'binding', code: 'provider-unavailable'});
    for (let i = 0; i < 65; i++) {f.now.mono += 2000; f.now.wall += 2000; await f.manager.refresh('community');}
    assert.ok(f.calls.filter(call => call.op === 'renew').length >= 4);
    assert.equal(f.cores(), 1); assert.equal(f.events.includes('stop'), false);
    f.setSampleFailure(null); f.setFailure(null); await f.manager.refresh('community');
    assert.ok(f.manager.getState('community').lanSnapshot);
  } finally {await f.close();}
});

test('permanent auth refusal after a temporary failure cannot keep the old grant alive', async () => {
  const f = enrollmentRuntimeFixture();
  try {
    await f.enrollment.reconcile(f.snapshot(f.member.accessToken)); await f.manager.refresh('community');
    f.setFailure({op: 'session', code: 'provider-unavailable'});
    await assert.rejects(f.enrollment.reconcile(f.snapshot('retired-fixture')));
    f.setFailure({op: 'session', code: 'auth-unavailable'}); await f.retry();
    assert.deepEqual(f.events.slice(-3), ['stop', 'remove', 'revoke']);
    await f.manager.refresh('community'); assert.equal(f.manager.getState('community').lanSnapshot, null);
    assert.equal(f.cores(), 1); assert.equal(f.calls.filter(call => call.op === 'acquire').length, 1);
    await f.enrollment.reconcile({members: [], enabled: true});
    assert.equal(f.timers.filter(timer => !timer.cancelled).length, 0);
  } finally {await f.close();}
});

test('membership removal cancels pending authentication and clears the last verified runtime', async () => {
  const f = enrollmentRuntimeFixture();
  try {
    await f.enrollment.reconcile(f.snapshot(f.member.accessToken));
    f.setFailure({op: 'session', code: 'provider-unavailable'});
    await assert.rejects(f.enrollment.reconcile(f.snapshot('rotated-fixture')));
    await f.enrollment.reconcile({members: [], enabled: true});
    assert.equal(f.timers.filter(timer => !timer.cancelled).length, 0);
    assert.equal(f.events.filter(event => event === 'stop').length, 1);
    assert.equal(f.calls.filter(call => call.op === 'revoke').length, 1);
    assert.equal(f.manager.getState('community').phase, 'disabled');
    await assert.rejects(f.connect(), error => error.reason === 'configuration-required');
  } finally {await f.close();}
});

test('failed bearer refresh cannot defer expiry or binding revocation of the old grant', async () => {
  for (const failure of ['expiry', 'revoked-binding']) {
    const f = enrollmentRuntimeFixture();
    try {
      await f.enrollment.reconcile(f.snapshot(f.member.accessToken));
      f.setFailure({op: 'session', code: 'provider-unavailable'});
      await assert.rejects(f.enrollment.reconcile(f.snapshot('rotated-fixture')));
      if (failure === 'expiry') {f.now.mono += 61000; f.now.wall += 61000;}
      else f.setFailure({op: 'binding', code: 'auth-unavailable'});
      await f.manager.refresh('community');
      assert.equal(f.manager.getState('community').phase, 'error');
      assert.equal(f.manager.getState('community').lanSnapshot, null);
      assert.deepEqual(f.events.slice(-3), ['stop', 'remove', 'revoke']); assert.equal(f.cores(), 1);
      f.enrollment.shutdown(); assert.equal(f.timers.filter(timer => !timer.cancelled).length, 0);
    } finally {await f.close();}
  }
});

test('superseding an in-flight changed-scope authentication must still replace retired manager ownership', async () => {
  let release, entered;
  const pending = new Promise(resolve => {release = resolve;}), started = new Promise(resolve => {entered = resolve;});
  const f = enrollmentRuntimeFixture({beforeSessionReply: async (_reply, bearer) => {
    if (bearer === 'intermediate-fixture') {entered(); await pending;}
  }});
  try {
    await f.enrollment.reconcile(f.snapshot(f.member.accessToken)); await f.manager.refresh('community');
    f.verified.serverUserId = 'replacement-member'; f.intent.accountId = 'replacement-account';
    f.scope.accountId = 'replacement-account'; f.grant.scope.accountId = 'replacement-account';
    f.proof.scope.accountId = 'replacement-account'; f.proof.serverUserId = 'replacement-member';
    const first = f.enrollment.reconcile(f.snapshot('intermediate-fixture')); await started;
    const latest = f.enrollment.reconcile(f.snapshot('latest-fixture')); release();
    await Promise.all([first, latest]);
    assert.equal(f.cores(), 2, 'auth already replaced the runtime scope even when its enrollment revision was superseded');
    await f.manager.refresh('community'); assert.ok(f.manager.getState('community').lanSnapshot);
  } finally {release(); await f.close();}
});

for (const boundary of ['remove-readd', 'disable', 'shutdown']) test('committed auth superseded by ' + boundary + ' cannot carry retired replacement responsibility', async () => {
  let release, entered;
  const pending = new Promise(resolve => {release = resolve;}), committed = new Promise(resolve => {entered = resolve;});
  const f = enrollmentRuntimeFixture({afterAuthenticate: async (value, result) => {
    if (value.accessToken === 'intermediate-fixture') {assert.equal(result.changed, true); entered(); await pending;}
  }});
  try {
    await f.enrollment.reconcile(f.snapshot(f.member.accessToken));
    f.verified.serverUserId = 'replacement-member'; f.intent.accountId = 'replacement-account';
    f.scope.accountId = 'replacement-account'; f.grant.scope.accountId = 'replacement-account';
    f.proof.scope.accountId = 'replacement-account'; f.proof.serverUserId = 'replacement-member';
    const first = f.enrollment.reconcile(f.snapshot('intermediate-fixture')); await committed;
    const generation = f.manager.getState('community').generation;
    if (boundary === 'remove-readd') {
      const removal = f.enrollment.reconcile({members: [], enabled: true});
      const latest = f.enrollment.reconcile(f.snapshot('latest-fixture')); release();
      await Promise.all([first, removal, latest]);
      assert.equal(f.cores(), 2); assert.equal(f.events.filter(event => event === 'stop').length, 1);
      assert.equal(f.manager.getState('community').generation, generation + 2, 'fresh enrollment cannot consume a pre-removal scope marker');
      await f.manager.refresh('community'); assert.ok(f.manager.getState('community').lanSnapshot);
    } else if (boundary === 'disable') {
      const disable = f.enrollment.reconcile({...f.snapshot('latest-fixture'), enabled: false}); release();
      await Promise.all([first, disable]);
      assert.equal(f.manager.getState('community').phase, 'disabled'); assert.equal(f.cores(), 1);
    } else {
      f.enrollment.shutdown(); f.manager.shutdownOwned(); release(); await first;
      await f.coordinator.drainOwned();
      assert.equal(f.manager.getState('community').phase, 'disabled'); assert.equal(f.cores(), 1);
    }
    assert.equal(f.timers.filter(timer => !timer.cancelled).length, 0);
  } finally {release(); await f.close();}
});

test('a superseded completed manager replacement cannot be consumed a second time', async () => {
  let release, entered;
  const pending = new Promise(resolve => {release = resolve;}), connecting = new Promise(resolve => {entered = resolve;});
  const f = enrollmentRuntimeFixture({beforePhysicalConnected: async () => {
    if (f.cores() === 2) {entered(); await pending;}
  }});
  try {
    await f.enrollment.reconcile(f.snapshot(f.member.accessToken));
    f.verified.serverUserId = 'replacement-member'; f.intent.accountId = 'replacement-account';
    f.scope.accountId = 'replacement-account'; f.grant.scope.accountId = 'replacement-account';
    f.proof.scope.accountId = 'replacement-account'; f.proof.serverUserId = 'replacement-member';
    const first = f.enrollment.reconcile(f.snapshot('intermediate-fixture')); await connecting;
    const latest = f.enrollment.reconcile(f.snapshot('latest-fixture')); release(); await Promise.all([first, latest]);
    assert.equal(f.cores(), 2, 'completed manager replacement cannot restart again when the latest token has the same verified scope');
    assert.equal(f.events.filter(event => event === 'stop').length, 1);
    await f.manager.refresh('community'); assert.ok(f.manager.getState('community').lanSnapshot);
  } finally {release(); await f.close();}
});
test('authenticated IPC rejects untrusted frame before any transport operation', async () => {
  const handlers = {}, f = runtimeFixture(), manager = new EasyTierCommunityManager(f.runtime);
  const unregister = registerEasyTierCommunityIpc({handle: (name, callback) => handlers[name] = callback,
    removeHandler: name => delete handlers[name]}, manager, e => e.senderFrame === 'trusted', undefined,
  input => f.coordinator.setAuthenticatedSession(input));
  assert.throws(() => handlers['et-community-authenticated-session']({senderFrame: 'other'}, {}));
  assert.equal(f.calls.length, 0); unregister(); assert.equal(Object.keys(handlers).length, 0);
});
