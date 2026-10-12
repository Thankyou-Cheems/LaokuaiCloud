/** Pure contract only: no network, IPC, process, filesystem or native activation.
 * Derived from the reviewed astra-contract prototype in the SHA256-pinned handoff.
 * Trusted authentication, storage, issuer/key derivation and runtime are owner seams.
 */
import { copiedScope, exact, fail, fingerprint, id, natural, positive, privateIpv4,
  publicKeyFingerprint, recordShape, safeArray, scope, SCOPE_KEYS, uuid,
  type CommunityGrantRecord, type CommunityGrantScope } from './communityGrant';

export interface BindingExpected extends CommunityGrantScope {
  grantId: string; credentialId: string; publicKeyFingerprint: string; networkName: string; virtualIp: string; revision: number;
}
export interface ProviderPeerObservation {
  providerGeneration: number; observedMonoMs: number; networkName: string;
  connections: {peerId: number; networkName: string; isClosed: boolean; secureAuthLevel: number; peerIdentityType: number; remotePublicKeyB64: string}[];
  routes: {peerId: number; nativeInstanceId: string; virtualIp: string; nextHopPeerId: number}[];
}

/** Preferred owner seam: derive expectation from the current persisted record.
 * Observe under the same authorization/record epoch, recheck it after sampling.
 */
export function verifyCurrentDeviceBinding(current: CommunityGrantRecord, observation: unknown,
  serverTimeMs: number, nowMonoMs: number, expectedProviderGeneration: number) {
  recordShape(current);
  if (current.state !== 'active' || !current.grant || !natural(serverTimeMs) ||
      serverTimeMs < current.grant.serverTimeMs || serverTimeMs >= current.grant.expiresAtMs) fail('inactive-binding-grant');
  const grant = current.grant;
  return verifyDeviceBinding({...copiedScope(grant.scope), grantId: grant.grantId, credentialId: grant.credentialId,
    publicKeyFingerprint: grant.publicKeyFingerprint, networkName: grant.networkName,
    virtualIp: grant.virtualIp, revision: grant.revision}, observation, nowMonoMs, expectedProviderGeneration);
}

/** Use a connection identity sample on both sides of the route read. The RPC
 * adapter must supply actual samples from one selected management instance.
 * Equality checks detect mixed generation/topology; these DTOs do not attest transport.
 */
export function verifyBracketedDeviceBinding(current: CommunityGrantRecord, before: ProviderPeerObservation,
  after: ProviderPeerObservation, serverTimeMs: number, nowMonoMs: number, expectedProviderGeneration: number) {
  const a = verifyCurrentDeviceBinding(current, before, serverTimeMs, nowMonoMs, expectedProviderGeneration);
  const b = verifyCurrentDeviceBinding(current, after, serverTimeMs, nowMonoMs, expectedProviderGeneration);
  const identities = (value: ProviderPeerObservation) => value.connections.map(c =>
    JSON.stringify([c.peerId, c.networkName, c.isClosed, c.secureAuthLevel, c.peerIdentityType, c.remotePublicKeyB64])).sort().join('\n');
  const routes = (value: ProviderPeerObservation) => value.routes.map(r =>
    JSON.stringify([r.peerId, r.nativeInstanceId, r.virtualIp, r.nextHopPeerId])).sort().join('\n');
  if (before.observedMonoMs > after.observedMonoMs || a.peerId !== b.peerId ||
      identities(before) !== identities(after) || routes(before) !== routes(after))
    fail('provider-sample-conflict');
  return b;
}
/** Pure provider-observation join. Caller must authenticate both source boundaries
 * and derive expected from a CURRENT, unexpired, unrevoked server grant record.
 * This helper does not own the grant database or certify the observer transport.
 */
export function verifyDeviceBinding(expected: unknown, observation: unknown, nowMonoMs: number, expectedProviderGeneration: number) {
  const expectedKeys = [...SCOPE_KEYS, 'grantId', 'credentialId', 'publicKeyFingerprint', 'networkName', 'virtualIp', 'revision'];
  exact<BindingExpected>(expected, expectedKeys, 'invalid-binding-expected'); scope(copiedScope(expected));
  if (!id(expected.grantId) || !id(expected.credentialId) || !fingerprint(expected.publicKeyFingerprint) ||
      !id(expected.networkName) || !privateIpv4(expected.virtualIp) || !positive(expected.revision)) fail('invalid-binding-expected');
  exact<ProviderPeerObservation>(observation, ['providerGeneration', 'observedMonoMs', 'networkName', 'connections', 'routes'], 'invalid-provider-observation');
  if (!positive(expectedProviderGeneration) || observation.providerGeneration !== expectedProviderGeneration ||
      !natural(nowMonoMs) || !natural(observation.observedMonoMs) || observation.observedMonoMs > nowMonoMs ||
      nowMonoMs - observation.observedMonoMs > 5_000 || observation.networkName !== expected.networkName ||
      !safeArray(observation.connections, 4096) || !safeArray(observation.routes, 254))
    fail('provider-observation-mismatch');
  const peers = new Set<number>();
  const authenticatedIdentities = new Map<number, string>();
  for (const c of observation.connections) {
    exact(c, ['peerId', 'networkName', 'isClosed', 'secureAuthLevel', 'peerIdentityType', 'remotePublicKeyB64'], 'invalid-connection');
    if (!positive(c.peerId) || c.peerId > 0xffffffff || typeof c.isClosed !== 'boolean' ||
        ![0, 1, 2, 3].includes(c.secureAuthLevel) || ![0, 1, 2].includes(c.peerIdentityType)) fail('invalid-connection');
    if (c.networkName !== expected.networkName) fail('connection-network-mismatch');
    const observedFingerprint = publicKeyFingerprint(c.remotePublicKeyB64);
    if (!c.isClosed && c.secureAuthLevel >= 2) {
      const identity = `${c.peerIdentityType}:${observedFingerprint}`;
      if (authenticatedIdentities.has(c.peerId) && authenticatedIdentities.get(c.peerId) !== identity)
        fail('connection-evidence-conflict');
      authenticatedIdentities.set(c.peerId, identity);
    }
    const sameKey = observedFingerprint === expected.publicKeyFingerprint;
    if (sameKey && !c.isClosed && c.secureAuthLevel === 2 && c.peerIdentityType === 1) peers.add(c.peerId);
  }
  if (peers.size !== 1) fail(peers.size === 0 ? 'binding-unproven' : 'duplicate-key-owner');
  const peerId = [...peers][0];
  for (const r of observation.routes) {
    exact(r, ['peerId', 'nativeInstanceId', 'virtualIp', 'nextHopPeerId'], 'invalid-route');
    if (!positive(r.peerId) || r.peerId > 0xffffffff || !uuid(r.nativeInstanceId) || !privateIpv4(r.virtualIp) ||
        !natural(r.nextHopPeerId) || r.nextHopPeerId > 0xffffffff) fail('invalid-route');
  }
  const routes = observation.routes.filter(r => r.peerId === peerId);
  if (routes.length !== 1 || routes[0].nativeInstanceId !== expected.nativeInstanceId || routes[0].virtualIp !== expected.virtualIp ||
      observation.routes.some(r => r.peerId !== peerId && r.virtualIp === expected.virtualIp)) fail('route-binding-mismatch');
  return Object.freeze({v: 1, ...copiedScope(expected), grantId: expected.grantId, credentialId: expected.credentialId,
    revision: expected.revision, peerId, virtualIp: expected.virtualIp, publicKeyFingerprint: expected.publicKeyFingerprint,
    evidence: 'provider-connection-and-route', physicalDirectVerified: false});
}
