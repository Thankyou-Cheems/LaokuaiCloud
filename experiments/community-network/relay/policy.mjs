// Isolated reference policy. No production imports, sockets, timers or OS changes.
export const POLICY = Object.freeze({
  version: 1,
  maxLeaseMs: 60_000,
  maxObservationAgeMs: 5_000,
  maxLoss: 0.03,
  maxRttMs: 150,
  maxLoad: 0.7,
  minimumSpareBps: 512_000,
  maxCandidates: 2,
  holdMs: 10_000,
  improvementRatio: 0.2,
  forwardedBudgetBps: 256_000,
  localReserveBps: 256_000,
  burstMs: 250,
});

const scopeKeys = ['communityId', 'memberId', 'deviceId', 'sessionId'];
const grantKeys = ['version', 'issuerId', 'leaseId', 'binding', 'consentEpoch',
  'issuedAtMs', 'expiresAtMs', 'permission'];
const natural = value => Number.isSafeInteger(value) && value >= 0;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validBinding = value => exact(value, scopeKeys) && scopeKeys.every(key => id(value[key]));
const sameBinding = (a, b) => validBinding(a) && validBinding(b)
  && scopeKeys.every(key => a[key] === b[key]);
const fresh = (observedAtMs, now) => natural(now) && natural(observedAtMs)
  && observedAtMs <= now && now - observedAtMs <= POLICY.maxObservationAgeMs;
const deny = reason => ({ allowed: false, reason });

// authenticate and sign are injected trusted boundaries, never remote boolean fields.
// An issuer must persist consent/revocation before calling this pure planner.
export function issueRelayLease({ binding, consent, now, ttlMs, issuerId, leaseId,
  authenticate, sign }) {
  if (!validBinding(binding) || !natural(now) || !id(issuerId) || !id(leaseId)
    || !natural(ttlMs) || ttlMs === 0 || ttlMs > POLICY.maxLeaseMs
    || typeof authenticate !== 'function' || typeof sign !== 'function') {
    throw new Error('invalid-issuance');
  }
  const membership = authenticate(binding);
  if (!membership || membership.status !== 'active' || !sameBinding(membership.binding, binding)
    || !natural(membership.expiresAtMs) || membership.expiresAtMs <= now) {
    throw new Error('membership-denied');
  }
  if (!consent || consent.version !== POLICY.version || consent.enabled !== true
    || !sameBinding(consent.binding, binding) || !natural(consent.epoch)) {
    throw new Error('consent-required');
  }
  const grant = Object.freeze({ version: POLICY.version, issuerId, leaseId,
    binding: Object.freeze({ ...binding }), consentEpoch: consent.epoch,
    issuedAtMs: now, expiresAtMs: Math.min(now + ttlMs, membership.expiresAtMs),
    permission: 'same-community-forwarded-data' });
  return Object.freeze({ grant, signature: sign(grant) });
}

// consent and revocations are the caller's authenticated, current control-plane state.
export function assessRelayLease(envelope, { binding, issuerId, now, consent,
  revocations, verify }) {
  const grant = envelope?.grant;
  if (!exact(grant, grantKeys) || grant.version !== POLICY.version
    || grant.permission !== 'same-community-forwarded-data'
    || !id(grant.leaseId) || grant.issuerId !== issuerId || !id(issuerId)
    || !sameBinding(grant.binding, binding) || !natural(grant.consentEpoch)) {
    return deny('unsupported-or-wrong-scope');
  }
  try {
    if (typeof verify !== 'function' || verify(grant, envelope.signature) !== true) {
      return deny('unverified-lease');
    }
  } catch { return deny('unverified-lease'); }
  if (!natural(now) || !natural(grant.issuedAtMs) || !natural(grant.expiresAtMs)
    || grant.issuedAtMs > now || grant.expiresAtMs <= now
    || grant.expiresAtMs <= grant.issuedAtMs
    || grant.expiresAtMs - grant.issuedAtMs > POLICY.maxLeaseMs) return deny('lease-time');
  if (!consent || consent.version !== POLICY.version || consent.enabled !== true
    || !sameBinding(consent.binding, binding) || consent.epoch !== grant.consentEpoch) {
    return deny('consent-revoked');
  }
  if (!revocations || !sameBinding(revocations.binding, binding)
    || !fresh(revocations.observedAtMs, now) || !natural(revocations.epoch)
    || !Array.isArray(revocations.revokedLeaseIds)
    || !revocations.revokedLeaseIds.every(id)) return deny('revocation-state-unknown');
  if (revocations.epoch !== grant.consentEpoch
    || revocations.revokedLeaseIds.includes(grant.leaseId)) return deny('lease-revoked');
  return { allowed: true, reason: 'current-consented-lease' };
}

export function assessNetworkQuality(quality, now) {
  if (!quality || !fresh(quality.observedAtMs, now)) return deny('quality-stale-or-unknown');
  if (quality.pathKnown !== true) return deny('path-unknown');
  const bounded = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  if (!bounded(quality.rttMs, 0, POLICY.maxRttMs)
    || !bounded(quality.loss, 0, POLICY.maxLoss)
    || !bounded(quality.load, 0, POLICY.maxLoad)
    || !bounded(quality.spareUploadBps, POLICY.minimumSpareBps, Number.MAX_SAFE_INTEGER)) {
    return deny('quality-or-capacity-insufficient');
  }
  return { allowed: true, reason: 'quality-current' };
}

// One relay is chosen for a path; at most two eligible alternatives are reported.
// Stale/denied incumbents bypass hysteresis immediately; ordinary improvements wait.
export function selectRelay({ candidates, previous = null, now, assessLease }) {
  if (!Array.isArray(candidates) || typeof assessLease !== 'function' || !natural(now)) {
    throw new Error('invalid-selection');
  }
  const excluded = [];
  const eligible = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || !id(candidate.relayId) || seen.has(candidate.relayId)) {
      throw new Error('invalid-or-duplicate-relay');
    }
    seen.add(candidate.relayId);
    let lease;
    try { lease = assessLease(candidate, now); } catch { lease = deny('lease-check-failed'); }
    const quality = assessNetworkQuality(candidate.quality, now);
    if (lease?.allowed !== true || !quality.allowed) {
      excluded.push({ relayId: candidate.relayId, reason: lease?.allowed === true
        ? quality.reason : lease?.reason ?? 'lease-check-failed' });
      continue;
    }
    eligible.push({ relayId: candidate.relayId,
      score: candidate.quality.rttMs + candidate.quality.loss * 1_000
        + candidate.quality.load * 100 });
  }
  eligible.sort((a, b) => a.score - b.score || a.relayId.localeCompare(b.relayId));
  const best = eligible[0];
  const incumbent = eligible.find(item => item.relayId === previous?.relayId);
  let selected = best;
  let reason = best ? 'best-eligible' : 'fallback-required';
  const validPrevious = incumbent && natural(previous.selectedAtMs) && previous.selectedAtMs <= now;
  if (validPrevious) {
    const hold = now - previous.selectedAtMs < POLICY.holdMs;
    const enoughImprovement = best.score < incumbent.score * (1 - POLICY.improvementRatio);
    if (hold || !enoughImprovement) { selected = incumbent; reason = 'hysteresis-hold'; }
  }
  const shortlist = selected ? [selected, ...eligible.filter(item => item.relayId !== selected.relayId)]
    .slice(0, POLICY.maxCandidates) : [];
  return { state: selected ? { relayId: selected.relayId,
    selectedAtMs: validPrevious && selected.relayId === previous.relayId ? previous.selectedAtMs : now } : null,
  reason, candidates: shortlist, excluded };
}

// One bucket per relay instance, shared across every destination peer.
// It models packet admission/drop, not queued shaping or real NIC scheduling.
export class ForwardedEgressBudget {
  #tokens = 0;
  #lastMs = null;
  #rate = 0;
  #stats = { localBytes: 0, forwardedBytes: 0, deniedBytes: 0 };

  admit({ kind, bytes, peerId, now, quality, lease }) {
    if (!natural(bytes) || bytes === 0 || !natural(now)) throw new Error('invalid-packet');
    if (kind === 'local-data' || kind === 'local-control') {
      this.#stats.localBytes += bytes;
      return { allowed: true, reason: 'local-bypass' };
    }
    if (kind !== 'forwarded-data' || !id(peerId)) throw new Error('unsupported-packet-kind');
    const qualityCheck = assessNetworkQuality(quality, now);
    if (!qualityCheck.allowed || (this.#lastMs !== null && now < this.#lastMs)) {
      this.#tokens = 0; this.#lastMs = now; this.#rate = 0;
      this.#stats.deniedBytes += bytes;
      return deny(qualityCheck.allowed ? 'clock-regressed' : qualityCheck.reason);
    }
    if (lease?.allowed !== true) {
      this.#stats.deniedBytes += bytes;
      return deny('lease-not-authorized');
    }
    const rate = Math.min(POLICY.forwardedBudgetBps,
      Math.max(0, quality.spareUploadBps - POLICY.localReserveBps));
    const capacity = rate / 8 * POLICY.burstMs / 1_000;
    // Refill using the smaller old/new rate, never earning capacity retroactively.
    this.#tokens = this.#lastMs === null ? capacity : Math.min(capacity,
      this.#tokens + (now - this.#lastMs) * Math.min(this.#rate, rate) / 8 / 1_000);
    this.#lastMs = now; this.#rate = rate;
    if (bytes > this.#tokens) {
      this.#stats.deniedBytes += bytes;
      return deny('forwarded-budget-exhausted');
    }
    this.#tokens -= bytes; this.#stats.forwardedBytes += bytes;
    return { allowed: true, reason: 'forwarded-budget-admitted' };
  }

  get stats() { return { ...this.#stats }; }
}
