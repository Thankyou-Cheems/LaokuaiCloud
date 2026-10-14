import assert from 'node:assert/strict';
import { createHybridDiagnosticReporter, peerMediaDiagnostic } from '../dist/webrtc/hybrid/hybridDiagnostic.js';
import { HybridRouteController } from '../dist/webrtc/hybrid/HybridRouteController.js';
const diagnostic = peerMediaDiagnostic({ trackId: 'private-track', observedAtMs: 20, reason: null,
  decode: { fresh: true }, transportPath: { classification: 'non-turn-candidate', reason: 'selected-pair', pairId: 'private-pair',
    local: { address: '192.0.2.1', candidateType: 'host', candidateId: 'private-candidate' },
    remote: { address: '192.0.2.2', candidateType: 'srflx' }, underlay: { classification: 'not-easytier' } } });
assert.equal(diagnostic.decodeProof, 'fresh'); assert.equal(diagnostic.pathClass, 'non-turn-candidate');
assert.equal(diagnostic.localCandidateType, 'host'); assert.equal(diagnostic.remoteCandidateType, 'srflx');
assert.equal(/private-|192\.0\.2|trackId|pairId|address|candidateId/.test(JSON.stringify(diagnostic)), false);
assert.equal(peerMediaDiagnostic(null).decodeProof, 'missing');
assert.equal(peerMediaDiagnostic(null, 'raw secret failure').failureReason, 'peer_failure');
let now = 1000; const prior = globalThis.performance; globalThis.performance = { now: () => now };
try {
  const events = [], emit = createHybridDiagnosticReporter(event => events.push(event));
  emit(diagnostic); emit(diagnostic); assert.equal(events.length, 1);
  emit(peerMediaDiagnostic(null)); assert.equal(events.length, 1, 'rate bound missing');
  now += 1001; emit(peerMediaDiagnostic(null)); assert.equal(events.length, 2);
  emit(peerMediaDiagnostic(null, 'peer_stats_unavailable')); assert.equal(events.at(-1).failureReason, 'peer_stats_unavailable');
  const handoff = { kind: 'handoff', stage: 'local_handoff_completed', elapsedMs: 24, reason: 'local_handoff_before_pause' };
  emit(handoff); emit(handoff); assert.deepEqual(events.at(-1), handoff);
  const handoffCount = events.length;
  emit({ ...handoff, stage: 'sfu_restore_completed', reason: 'fresh_sfu_restored', elapsedMs: 180 });
  assert.equal(events.length, handoffCount + 1, 'completion of a different stage must survive rate dedup');
  const forwarding = { kind: 'forwarding', action: 'pause', result: 'acknowledged', reason: 'validated_ack' };
  for (let i=0; i<200; ++i) { now += 1001; emit({ ...forwarding, result: i%2 ? 'failed' : 'acknowledged', reason: i%2 ? 'request_failed' : 'validated_ack' }); }
  assert.ok(events.length <= 128);
  const before=events.length;now+=60001;emit(diagnostic);assert.equal(events.length,before+1,'minute budget never renewed');
  assert.doesNotThrow(() => createHybridDiagnosticReporter(() => { throw Error('observer'); })(diagnostic));
} finally { globalThis.performance = prior; }
// The real controller reports validated ACKs and rejects a mismatched one without emitting identities.
const events = [], controller = new HybridRouteController({ authority: null, getPublication: () => null,
  getReceivePort: () => null, createPeer: () => { throw Error('no peers'); }, onDiagnostic: event => events.push(event) });
const scope = { serverInstanceId: 'private-server', roomId: 'private-room', roomGeneration: 'private-generation', localParticipantId: 'private-local', localSessionId: 'private-session', canPublish: true, canReceive: true };
const request = { scope, pairConnectionId: 'private-pair', sourceParticipantId: 'private-peer', sourceSessionId: 'private-remote', sourcePublicationId: 'private-publication', destinationSessionId: scope.localSessionId, routeGeneration: 1, operationId: 'private-operation', enabled: true, pauseLeaseMs: 0 };
controller.validateAck(request, { ...request, applied: true, leaseRemainingMs: 0 }, performance.now());
assert.equal(events.at(-1).result, 'acknowledged');
assert.throws(() => controller.validateAck(request, { ...request, operationId: 'wrong', applied: true, leaseRemainingMs: 0 }, performance.now()), /forwarding_ack_mismatch/);
assert.equal(events.at(-1).reason, 'forwarding_ack_mismatch');
assert.equal(JSON.stringify(events).includes('private-'), false);
controller.dispose();
console.log('hybrid diagnostics: sanitized enums, missing/fresh decode, observer isolation, bounded emission, exact ACK/mismatch passed');
