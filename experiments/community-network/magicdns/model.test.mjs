import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import test from 'node:test';

import {createDirectoryAuthority, createDirectoryCache, DirectoryContractError, MAX_DEVICES} from './model.mjs';

const START = 1_800_000_000_000;
const pairs = generateKeyPairSync('ed25519');
const device = (change = {}) => ({accountId: 'account-private', deviceId: 'device-private', sessionId: 'session-private',
  authorizationEpoch: 1, currentAuthorizationEpoch: 1, issuedAtMs: START - 1000, sessionExpiresAtMs: START + 60_000,
  grantExpiresAtMs: START + 30_000, sessionStatus: 'active', grantStatus: 'active', virtualIp: '10.77.0.2', ...change});
const error = code => value => value instanceof DirectoryContractError && value.code === code;
const decode = envelope => JSON.parse(Buffer.from(envelope.payloadB64, 'base64').toString('utf8'));
function fixture(change = {}) {
  const authorityOptions = {communityId: '社区_1', serverInstanceId: 'server-private', namespaceKey: Buffer.alloc(32, 0x41), signingPrivateKey: pairs.privateKey, initialRevision: 0, ...change};
  const authority = createDirectoryAuthority(authorityOptions);
  const cache = createDirectoryCache({communityId: authorityOptions.communityId, serverInstanceId: authorityOptions.serverInstanceId,
    verificationKey: pairs.publicKey, authorizationEpoch: 1});
  const now = {wallMs: START, monoMs: 1000};
  const issue = (ticket, devices = [device()], ttlMs = 10_000) => authority.issue({requestId: ticket.requestId, serverTimeMs: now.wallMs, ttlMs, devices});
  const accept = (devices, ttlMs) => { const ticket = cache.beginRequest(now), envelope = issue(ticket, devices, ttlMs); cache.accept(ticket, envelope, now); return decode(envelope); };
  return {authority, cache, now, issue, accept, authorityOptions};
}
const query = (row, body, kind = 'deviceAlias') => `${row[kind]}.${body.zone}`;
const resign = body => {
  const bytes = Buffer.from(JSON.stringify(body));
  return {payloadB64: bytes.toString('base64'), signatureB64: sign(null, bytes, pairs.privateKey).toString('base64')};
};

test('authority-only aliases are stable across session renewal and issuer recreation, without raw identities', () => {
  const f = fixture(), first = f.accept();
  const second = f.accept([device({sessionId: 'replacement-session', authorizationEpoch: 2, currentAuthorizationEpoch: 2})]);
  assert.equal(first.records[0].deviceAlias, second.records[0].deviceAlias);
  assert.equal(first.records[0].accountAlias, second.records[0].accountAlias);
  assert.notEqual(first.records[0].sessionBinding, second.records[0].sessionBinding);
  const restarted = fixture(), third = restarted.accept();
  assert.equal(first.zone, third.zone); assert.equal(first.records[0].deviceAlias, third.records[0].deviceAlias);
  const text = JSON.stringify(first.records) + first.zone;
  for (const secret of ['account-private', 'device-private', 'session-private', 'server-private', '社区_1']) assert.equal(text.includes(secret), false);
  assert.match(first.zone, /^c-[a-f0-9]{32}\.lkc\.invalid\.$/);
});
test('community and server scopes isolate aliases; another community cannot borrow a signed directory', () => {
  const f = fixture(), other = fixture({communityId: '另一社区'}), server = fixture({serverInstanceId: 'another-server'});
  const body = f.accept(), foreign = other.accept(), foreignServer = server.accept();
  assert.notEqual(body.zone, foreign.zone); assert.notEqual(body.records[0].deviceAlias, foreign.records[0].deviceAlias);
  assert.notEqual(body.zone, foreignServer.zone);
  const ticket = f.cache.beginRequest(f.now), payload = decode(other.issue(ticket));
  assert.throws(() => f.cache.accept(ticket, resign(payload), f.now), error('invalid-directory'));
});
test('same account devices get unique names and addresses; the account shortcut refuses ambiguity', () => {
  const f = fixture(), body = f.accept([device(), device({deviceId: 'second-device', sessionId: 'second-session', virtualIp: '10.77.0.3'})]);
  assert.equal(body.records[0].accountAlias, body.records[1].accountAlias);
  assert.notEqual(body.records[0].deviceAlias, body.records[1].deviceAlias);
  const result = f.cache.resolve(query(body.records[0], body, 'accountAlias'), f.now);
  assert.equal(result.status, 'ambiguous'); assert.equal(result.devices.length, 2);
  for (const row of body.records) assert.equal(f.cache.resolve(query(row, body), f.now).ipv4, row.ipv4);
});
test('one-device account shortcut is case insensitive but outside zones and hostname claims are refused', () => {
  const f = fixture(), body = f.accept(), name = query(body.records[0], body, 'accountAlias');
  assert.equal(f.cache.resolve(name.toUpperCase().slice(0, -1), f.now).status, 'answer');
  for (const name of ['game.example', 'friend.et.net', 'd-attacker.' + body.zone, '*.' + body.zone, 'a..' + body.zone]) {
    assert.notEqual(f.cache.resolve(name, f.now).status, 'answer');
  }
});
test('client hostname, nickname, extra peer claims and accessors cannot enter the authority seam', () => {
  const f = fixture(), ticket = f.cache.beginRequest(f.now);
  for (const field of ['hostname', 'nickname', 'peerId', 'authenticated', 'zone']) {
    assert.throws(() => f.issue(ticket, [device({[field]: 'claimed-name'})]), error('invalid-shape'));
  }
  const malicious = device(); let calls = 0;
  Object.defineProperty(malicious, 'accountId', {enumerable: true, get() { calls++; return 'attacker'; }});
  assert.throws(() => f.issue(ticket, [malicious]), error('invalid-shape')); assert.equal(calls, 0);
  const inherited = Object.assign(Object.create({hostname: 'attacker'}), device());
  assert.throws(() => f.issue(ticket, [inherited]), error('invalid-shape'));
});
test('private canonical addresses and bounded unambiguous device rows are required', () => {
  const f = fixture(), ticket = f.cache.beginRequest(f.now);
  for (const virtualIp of ['8.8.8.8', '100.100.100.101', '10.077.0.2', '10.77.0.999', '127.0.0.1', '10.77.0.2/24']) {
    assert.throws(() => f.issue(ticket, [device({virtualIp})]), error('invalid-device'));
  }
  for (const second of [device({sessionId: 'different'}), device({accountId: 'other'}), device({deviceId: 'other', virtualIp: '10.77.0.3'})]) {
    assert.throws(() => f.issue(ticket, [device(), second]), error('ambiguous-directory'));
  }
  assert.throws(() => f.issue(ticket, Array.from({length: MAX_DEVICES + 1}, () => device())), error('invalid-devices'));
  assert.throws(() => f.issue(ticket, new Array(1)), error('invalid-devices'));
});
test('retired, mismatched authorization, expired session and expired grant are never published', () => {
  for (const change of [{sessionStatus: 'revoked'}, {grantStatus: 'revoked'}, {currentAuthorizationEpoch: 2},
    {sessionExpiresAtMs: START}, {grantExpiresAtMs: START}]) {
    const f = fixture(), body = f.accept([device(change)]); assert.equal(body.records.length, 0);
  }
  const f = fixture(); f.authority.retireSession('session-private'); assert.equal(f.accept().records.length, 0);
});
test('full authenticated snapshots remove revoked sessions immediately and renewed session retains device name', () => {
  const f = fixture(), first = f.accept(), name = query(first.records[0], first);
  assert.equal(f.cache.resolve(name, f.now).status, 'answer');
  f.authority.retireSession('session-private'); const removed = f.accept(); assert.equal(removed.records.length, 0);
  assert.equal(f.cache.resolve(name, f.now).status, 'not-found');
  const renewed = f.accept([device({sessionId: 'renewed-session', authorizationEpoch: 2, currentAuthorizationEpoch: 2})]);
  assert.equal(query(renewed.records[0], renewed), name); assert.equal(f.cache.resolve(name, f.now).status, 'answer');
});
test('per-record TTL is capped by session, grant and snapshot; subsecond DNS TTL does not round up', () => {
  const f = fixture(), body = f.accept([device({grantExpiresAtMs: START + 1500})]), name = query(body.records[0], body);
  assert.equal(f.cache.resolve(name, f.now).ttlSeconds, 1);
  f.now.wallMs += 600; f.now.monoMs += 600; assert.equal(f.cache.resolve(name, f.now).ttlSeconds, 0);
  f.now.wallMs += 900; f.now.monoMs += 900; assert.equal(f.cache.resolve(name, f.now).status, 'not-found');
});
test('stopped refresh expires at exact deadline; future times and invalid lifetimes are rejected', () => {
  const f = fixture(), body = f.accept(), name = query(body.records[0], body);
  f.now.wallMs += 10_000; f.now.monoMs += 10_000; assert.equal(f.cache.resolve(name, f.now).reason, 'expired');
  const g = fixture(), ticket = g.cache.beginRequest(g.now);
  assert.throws(() => g.issue(ticket, [device({issuedAtMs: START + 1})]), error('invalid-device'));
  for (const ttl of [0, -1, NaN, Infinity, 10_001]) assert.throws(() => g.issue(ticket, [device()], ttl), error('invalid-directory'));
});
test('server UTC skew is tolerated but complete request elapsed time is charged to TTL', () => {
  const f = fixture(), ticket = f.cache.beginRequest(f.now);
  const serverDevices = [device({issuedAtMs: 99_000, sessionExpiresAtMs: 200_000, grantExpiresAtMs: 200_000})];
  const envelope = f.authority.issue({requestId: ticket.requestId, serverTimeMs: 100_000, ttlMs: 10_000, devices: serverDevices});
  f.now.monoMs += 500; f.now.wallMs += 500; f.cache.accept(ticket, envelope, f.now);
  const body = decode(envelope); assert.equal(f.cache.resolve(query(body.records[0], body), f.now).ttlSeconds, 9);
});
test('clock rollback permanently clears the old cache; a UTC jump forward cannot extend it', () => {
  for (const field of ['wallMs', 'monoMs']) {
    const f = fixture(), body = f.accept(), name = query(body.records[0], body);
    f.now[field]--; assert.equal(f.cache.resolve(name, f.now).reason, 'clock-rollback');
    f.now[field]++; assert.equal(f.cache.resolve(name, f.now).status, 'unavailable');
  }
  const f = fixture(), body = f.accept(); f.now.wallMs += 10_000;
  assert.equal(f.cache.resolve(query(body.records[0], body), f.now).reason, 'expired');
});
test('in-flight retirement and late old callbacks cannot restore or wipe newer results', () => {
  const f = fixture(), old = f.cache.beginRequest(f.now), oldEnvelope = f.issue(old);
  const current = f.cache.beginRequest(f.now), currentEnvelope = f.issue(current), body = decode(currentEnvelope);
  f.cache.accept(current, currentEnvelope, f.now);
  assert.throws(() => f.cache.accept(old, oldEnvelope, f.now), error('retired-request'));
  assert.equal(f.cache.resolve(query(body.records[0], body), f.now).status, 'answer');
  const pending = f.cache.beginRequest(f.now), stale = f.issue(pending); f.cache.retireAuthorization(2);
  assert.throws(() => f.cache.accept(pending, stale, f.now), error('retired-request'));
  assert.equal(f.cache.resolve(query(body.records[0], body), f.now).status, 'unavailable');
});
test('captured nonce and stale revisions cannot replay into a new authenticated request', () => {
  const f = fixture(), firstTicket = f.cache.beginRequest(f.now), first = f.issue(firstTicket); f.cache.accept(firstTicket, first, f.now);
  const next = f.cache.beginRequest(f.now); assert.throws(() => f.cache.accept(next, first, f.now), error('replayed-directory'));
  const pending = f.cache.beginRequest(f.now), body = decode(f.issue(pending)); body.revision = 1;
  assert.throws(() => f.cache.accept(pending, resign(body), f.now), error('replayed-directory'));
});
test('transport over deadline and directory outage clear records instead of re-aging previous cache', () => {
  const f = fixture(), body = f.accept(), name = query(body.records[0], body);
  const ticket = f.cache.beginRequest(f.now), envelope = f.issue(ticket);
  f.now.monoMs += 1001; f.now.wallMs += 1001;
  assert.throws(() => f.cache.accept(ticket, envelope, f.now), error('request-expired'));
  assert.equal(f.cache.resolve(name, f.now).status, 'unavailable');
  f.accept(); f.cache.unavailable(); assert.equal(f.cache.resolve(name, f.now).status, 'unavailable');
});
test('optional offline signature envelope rejects another authority and tampered records', () => {
  const f = fixture(), ticket = f.cache.beginRequest(f.now), envelope = {...f.issue(ticket)}, body = decode(envelope);
  body.records[0].ipv4 = '10.77.0.99'; envelope.payloadB64 = Buffer.from(JSON.stringify(body)).toString('base64');
  assert.throws(() => f.cache.accept(ticket, envelope, f.now), error('untrusted-authority'));
  const g = fixture(), pending = g.cache.beginRequest(g.now), foreignPair = generateKeyPairSync('ed25519');
  const foreign = createDirectoryAuthority({...g.authorityOptions, signingPrivateKey: foreignPair.privateKey});
  assert.throws(() => g.cache.accept(pending, foreign.issue({requestId: pending.requestId, serverTimeMs: START, ttlMs: 10_000, devices: [device()]}), g.now), error('untrusted-authority'));
});
test('even an authentic malformed snapshot cannot introduce hostnames, duplicate ownership or overlong TTL', () => {
  for (const mutate of [body => body.records[0].hostname = 'attacker', body => body.records.push({...body.records[0]}),
    body => body.expiresAtMs += 1, body => body.records[0].validUntilMs = body.expiresAtMs + 1]) {
    const f = fixture(), ticket = f.cache.beginRequest(f.now), body = decode(f.issue(ticket)); mutate(body);
    assert.throws(() => f.cache.accept(ticket, resign(body), f.now), value => value instanceof DirectoryContractError);
  }
});
