import type { CommunityBindingProofV1 } from './communityEtHttpContract';
import { exact, publicKeyFingerprint, sameScope, scope, type PrivateCommunityGrantV1 } from './communityEtGrant';
import type { VerifiedCommunitySession } from './communityEtGrantTransport';
import type { OwnedCredentialObservation } from './communityEtCredentialObservation';
import type { EasyTierIdentityBinding, EasyTierStatusSample } from './easyTierStatus';

/** Join trusted HTTPS authority with the exact owned CLI sample. Never infer another member. */
export function projectCommunityEtBinding(value: unknown, grant: PrivateCommunityGrantV1,
  session: VerifiedCommunitySession, observation: OwnedCredentialObservation, sample: EasyTierStatusSample,
  requestStartedMonoMs: number, nowMonoMs: number, unixNowMs: number, grantExpiresMonoMs: number): EasyTierIdentityBinding {
  exact<CommunityBindingProofV1>(value, ['v', 'serverUserId', 'scope', 'grantId', 'credentialId', 'revision',
    'peerId', 'virtualIp', 'publicKeyFingerprint', 'physicalDirectVerified'], 'invalid-binding-response');
  scope(value.scope);
  const node = (sample.info as {my_node_info?: {peer_id?: unknown; virtual_ipv4?: unknown}} | null)?.my_node_info;
  if (value.v !== 1 || value.physicalDirectVerified !== false || value.serverUserId !== session.serverUserId ||
      !sameScope(value.scope, grant.scope) || !sameScope(value.scope, session.intent) || value.grantId !== grant.grantId ||
      value.credentialId !== grant.credentialId || value.revision !== grant.revision ||
      !Number.isSafeInteger(value.peerId) || value.peerId < 1 || value.peerId > 0xffffffff || value.peerId !== observation.peerId ||
      value.virtualIp !== grant.virtualIp || value.virtualIp !== observation.virtualIp ||
      value.publicKeyFingerprint !== grant.publicKeyFingerprint ||
      publicKeyFingerprint(observation.publicKeyB64) !== value.publicKeyFingerprint || observation.issuerPinVerified !== true ||
      sample.serverId !== grant.scope.communityId || sample.instanceId !== grant.scope.nativeInstanceId ||
      sample.acquisitionSource !== 'owned-cli-route-list' || node?.peer_id !== observation.peerId || node?.virtual_ipv4 !== observation.virtualIp ||
      !Number.isSafeInteger(sample.generation) || sample.generation < 1 || !sample.freshRpc ||
      !Number.isSafeInteger(requestStartedMonoMs) || !Number.isSafeInteger(nowMonoMs) ||
      nowMonoMs < requestStartedMonoMs || nowMonoMs - requestStartedMonoMs > 5000 ||
      !Number.isSafeInteger(grantExpiresMonoMs) || grantExpiresMonoMs <= nowMonoMs ||
      !Number.isSafeInteger(unixNowMs) || unixNowMs < 1 || !Number.isFinite(sample.acquiredAtMs) ||
      sample.acquiredAtMs > nowMonoMs || nowMonoMs - sample.acquiredAtMs > 5000)
    throw new Error('community-binding-unproven');
  return {serverId: sample.serverId, instanceId: sample.instanceId, generation: sample.generation,
    userId: value.serverUserId, peerId: value.peerId, authenticated: true, deviceId: grant.scope.deviceId,
    expiresAtMs: Math.min(requestStartedMonoMs + 5000, grantExpiresMonoMs), observedAtUnixMs: unixNowMs, enrollment: 'joined',
    enrollmentObservedAtUnixMs: unixNowMs};
}
