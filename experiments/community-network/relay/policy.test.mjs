import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { POLICY, issueRelayLease, assessRelayLease, assessNetworkQuality,
  selectRelay, ForwardedEgressBudget } from './policy.mjs';

// Synthetic keys/identities only; no profiles, community credentials or network.
const keys = generateKeyPairSync('ed25519');
const encode = grant => Buffer.from(JSON.stringify(grant));
const signer = grant => sign(null, encode(grant), keys.privateKey).toString('base64');
const verifier = (grant, signature) => verify(null, encode(grant), keys.publicKey,
  Buffer.from(signature, 'base64'));
const binding = Object.freeze({ communityId: 'fixture-community', memberId: 'fixture-member',
  deviceId: 'fixture-device', sessionId: 'fixture-session' });
const consent = (overrides = {}) => ({ version: 1, enabled: true, binding, epoch: 7, ...overrides });
const issue = (overrides = {}) => issueRelayLease({ binding, consent: consent(), now: 1_000,
  ttlMs: 30_000, issuerId: 'fixture-issuer', leaseId: 'fixture-lease',
  authenticate: scope => ({ status: 'active', binding: scope, expiresAtMs: 80_000 }),
  sign: signer, ...overrides });
const context = (overrides = {}) => ({ binding, issuerId: 'fixture-issuer', now: 2_000,
  consent: consent(), revocations: { binding, observedAtMs: 2_000,
    epoch: 7, revokedLeaseIds: [] }, verify: verifier, ...overrides });
const quality = (overrides = {}) => ({ observedAtMs: 2_000, pathKnown: true,
  rttMs: 40, loss: 0.005, load: 0.2,
  spareUploadBps: 1_000_000, ...overrides });

test('issue only a bounded, explicitly consented membership/session grant', () => {
  const envelope = issue();
  assert.equal(assessRelayLease(envelope, context()).allowed, true);
  assert.equal(envelope.grant.permission, 'same-community-forwarded-data');
  assert.throws(() => issue({ consent: consent({ enabled: false }) }), /consent-required/);
  assert.throws(() => issue({ consent: consent({ version: 0 }) }), /consent-required/);
  assert.throws(() => issue({ consent: consent({ binding: { ...binding, deviceId: 'other' } }) }), /consent-required/);
  assert.throws(() => issue({ authenticate: () => ({ status: 'revoked', binding, expiresAtMs: 80_000 }) }), /membership-denied/);
  assert.throws(() => issue({ authenticate: () => null }), /membership-denied/);
  assert.throws(() => issue({ ttlMs: POLICY.maxLeaseMs + 1 }), /invalid-issuance/);
  const clipped = issue({ authenticate: scope => ({ status: 'active', binding: scope, expiresAtMs: 4_000 }) });
  assert.equal(clipped.grant.expiresAtMs, 4_000);
});

test('signature tamper, missing verifier, wrong issuer and every scope mismatch deny', () => {
  const envelope = issue();
  const tampered = { ...envelope, grant: { ...envelope.grant, expiresAtMs: 30_000 } };
  assert.equal(assessRelayLease(tampered, context()).reason, 'unverified-lease');
  assert.equal(assessRelayLease(envelope, context({ verify: undefined })).allowed, false);
  assert.equal(assessRelayLease(envelope, context({ issuerId: 'other-issuer' })).allowed, false);
  for (const key of Object.keys(binding)) {
    assert.equal(assessRelayLease(envelope, context({ binding: { ...binding, [key]: 'other' } })).allowed, false);
  }
});

test('old/unknown relay versions and broader permissions remain denied', () => {
  for (const change of [{ version: 0 }, { version: 2 }, { permission: 'internet-egress' },
    { allowedProxyCidrs: ['0.0.0.0/0'] }]) {
    const grant = { ...issue().grant, ...change };
    assert.equal(assessRelayLease({ grant, signature: signer(grant) }, context()).allowed, false);
  }
});

test('future, expiry boundary and signed excessive TTL deny', () => {
  const envelope = issue();
  for (const now of [999, 31_000, NaN]) {
    assert.equal(assessRelayLease(envelope, context({ now })).reason, 'lease-time');
  }
  const grant = { ...envelope.grant, expiresAtMs: 100_000 };
  assert.equal(assessRelayLease({ grant, signature: signer(grant) }, context()).reason, 'lease-time');
});

test('disable, revocation and session rotation retire existing grants immediately', () => {
  const envelope = issue();
  assert.equal(assessRelayLease(envelope, context({ consent: consent({ enabled: false }) })).reason, 'consent-revoked');
  assert.equal(assessRelayLease(envelope, context({ revocations: { binding,
    observedAtMs: 2_000, epoch: 7, revokedLeaseIds: ['fixture-lease'] } })).reason, 'lease-revoked');
  const rotated = context({ consent: consent({ epoch: 8 }), revocations: { binding,
    observedAtMs: 2_000, epoch: 8, revokedLeaseIds: [] } });
  assert.equal(assessRelayLease(envelope, rotated).allowed, false);
  assert.equal(assessRelayLease(issue({ consent: consent({ epoch: 8 }), leaseId: 'new-lease' }), rotated).allowed, true);
  assert.equal(assessRelayLease(envelope, context({ binding: { ...binding, sessionId: 'new-session' } })).allowed, false);
});

test('stale, future, missing and mismatched revocation evidence fail closed', () => {
  const envelope = issue();
  for (const revocations of [null, { binding, observedAtMs: 8_001, epoch: 7, revokedLeaseIds: [] },
    { binding, observedAtMs: 1_999, epoch: 7, revokedLeaseIds: [] },
    { binding: { ...binding, communityId: 'other' }, observedAtMs: 7_000, epoch: 7, revokedLeaseIds: [] }]) {
    assert.equal(assessRelayLease(envelope, context({ now: 7_000, revocations })).allowed, false);
  }
});

test('unknown path, stale/future samples, loss/load/capacity exclude candidates', () => {
  for (const change of [{ observedAtMs: 0 }, { observedAtMs: 8_001 }, { pathKnown: false },
    { rttMs: 151 }, { loss: 0.04 }, { load: 0.71 },
    { spareUploadBps: 511_999 }, { load: NaN }]) {
    assert.equal(assessNetworkQuality(quality({ observedAtMs: 8_000, ...change }), 8_000).allowed, false);
  }
});

const candidate = (relayId, changes = {}) => ({ relayId, envelope: issue({ leaseId: relayId }),
  quality: quality(changes) });
const assessCandidate = (item, now) => assessRelayLease(item.envelope, context({ now,
  revocations: { binding, observedAtMs: now, epoch: 7, revokedLeaseIds: [] } }));

test('a small eligible list ignores stale/unknown/busy/unauthenticated relays', () => {
  const items = [candidate('c'), candidate('b'), candidate('a'), candidate('busy', { load: 0.9 }),
    candidate('unknown', { pathKnown: false }), candidate('stale', { observedAtMs: 0 }),
    { ...candidate('forged'), envelope: { grant: {} } }];
  const result = selectRelay({ candidates: items, now: 5_500, assessLease: assessCandidate });
  assert.equal(result.state.relayId, 'a');
  assert.deepEqual(result.candidates.map(item => item.relayId), ['a', 'b']);
  assert.equal(result.excluded.length, 4);
});

test('hold time and meaningful improvement suppress oscillation; stale incumbent exits at once', () => {
  const previous = { relayId: 'current', selectedAtMs: 1_000 };
  const choose = (now, current, alternative) => selectRelay({ previous, now,
    candidates: [candidate('current', { observedAtMs: now, rttMs: current }),
      candidate('alternative', { observedAtMs: now, rttMs: alternative })], assessLease: assessCandidate });
  assert.equal(choose(5_000, 80, 20).state.relayId, 'current');
  assert.equal(choose(12_000, 40, 35).state.relayId, 'current');
  assert.equal(choose(12_000, 80, 20).state.relayId, 'alternative');
  const stale = selectRelay({ previous, now: 5_000, assessLease: assessCandidate,
    candidates: [candidate('current', { pathKnown: false }), candidate('alternative')] });
  assert.equal(stale.state.relayId, 'alternative');
  assert.equal(stale.state.selectedAtMs, 5_000);
  assert.equal(selectRelay({ previous, now: 5_000, assessLease: assessCandidate,
    candidates: [candidate('current', { pathKnown: false })] }).reason, 'fallback-required');
});

test('revoked incumbent bypasses hold; duplicate IDs and failed verifiers cannot promote a relay', () => {
  const current = candidate('current');
  const alternative = candidate('alternative');
  const result = selectRelay({ candidates: [current, alternative], previous: { relayId: 'current', selectedAtMs: 1_000 },
    now: 2_000, assessLease: item => item.relayId === 'current'
      ? { allowed: false, reason: 'lease-revoked' } : assessCandidate(item, 2_000) });
  assert.equal(result.state.relayId, 'alternative');
  assert.throws(() => selectRelay({ candidates: [current, current], now: 2_000, assessLease: assessCandidate }), /duplicate/);
  assert.equal(selectRelay({ candidates: [current], now: 2_000,
    assessLease: () => { throw new Error('unavailable'); } }).state, null);
});

const packet = (overrides = {}) => ({ kind: 'forwarded-data', bytes: 4_000,
  peerId: 'peer-a', now: 2_000, quality: quality(), lease: { allowed: true }, ...overrides });

test('game-only ET forwarding continues without a voice room and through voice failure', () => {
  const budget = new ForwardedEgressBudget();
  const previous = { relayId: 'game-relay', selectedAtMs: 1_000 };
  for (const networkQuality of [quality(), quality({ mediaDecoded: false,
    voiceRoomJoined: false, voiceError: 'fixture-media-failure' })]) {
    assert.equal(assessNetworkQuality(networkQuality, 2_000).allowed, true);
    const result = selectRelay({ candidates: [{ ...candidate('game-relay'), quality: networkQuality }],
      previous, now: 2_000, assessLease: assessCandidate });
    assert.equal(result.state.relayId, 'game-relay');
    assert.equal(budget.admit(packet({ quality: networkQuality })).allowed, true);
  }
});

test('forwarded budget is global across peers while local game/voice remains admitted', () => {
  const budget = new ForwardedEgressBudget();
  assert.equal(budget.admit(packet()).allowed, true);
  assert.equal(budget.admit(packet({ peerId: 'peer-b' })).allowed, true);
  assert.equal(budget.admit(packet({ peerId: 'peer-c', bytes: 1 })).reason, 'forwarded-budget-exhausted');
  assert.equal(budget.admit(packet({ kind: 'local-data', bytes: 100_000, quality: null, lease: null })).allowed, true);
  assert.equal(budget.admit(packet({ kind: 'local-control', bytes: 500 })).allowed, true);
  assert.equal(budget.admit(packet({ bytes: 1 })).allowed, false);
  assert.equal(budget.admit(packet({ now: 2_125 })).allowed, true);
  assert.deepEqual(budget.stats, { localBytes: 100_500, forwardedBytes: 12_000, deniedBytes: 2 });
});

test('stale quality drains old credit and cannot accumulate a recovery burst', () => {
  const budget = new ForwardedEgressBudget();
  assert.equal(budget.admit(packet({ bytes: 1 })).allowed, true);
  assert.equal(budget.admit(packet({ now: 8_000 })).reason, 'quality-stale-or-unknown');
  assert.equal(budget.admit(packet({ now: 8_000, bytes: 1, quality: quality({ observedAtMs: 8_000 }) })).allowed, false);
  assert.equal(budget.admit(packet({ now: 8_125, quality: quality({ observedAtMs: 8_125 }) })).allowed, true);
});

test('load spikes and authorization loss stop forwarding; local bypass remains available', () => {
  const budget = new ForwardedEgressBudget();
  assert.equal(budget.admit(packet({ lease: { allowed: false } })).reason, 'lease-not-authorized');
  assert.equal(budget.admit(packet({ quality: quality({ load: 0.9 }) })).allowed, false);
  assert.equal(budget.admit(packet({ kind: 'local-data', quality: quality({ load: 0.9 }) })).allowed, true);
  assert.equal(budget.admit(packet({ now: 1_999, quality: quality({ observedAtMs: 1_999 }) })).reason, 'clock-regressed');
});

test('packet admission stays within byte budget over many peers and rejects unknown packet kinds', () => {
  const budget = new ForwardedEgressBudget();
  let admitted = 0;
  for (let tick = 0; tick <= 1_000; tick += 10) {
    for (let peer = 0; peer < 10; peer++) {
      const result = budget.admit(packet({ bytes: 400, now: 2_000 + tick, peerId: `peer-${peer}` }));
      if (result.allowed) admitted += 400;
    }
  }
  const maximum = POLICY.forwardedBudgetBps / 8 * (1 + POLICY.burstMs / 1_000);
  assert.equal(admitted, maximum);
  assert.throws(() => budget.admit(packet({ kind: 'foreign-data' })), /unsupported/);
  assert.throws(() => budget.admit(packet({ bytes: -1 })), /invalid-packet/);
});
