import { type CommunityNetworkPreferences,DEFAULT_COMMUNITY_NETWORK_PREFERENCES, parseCommunityNetworkPreferences } from '../src/lib/communityNetworkPreferences';
import {
  COMMUNITY_ET_UPSTREAM_COMMIT, exact, fail, fingerprint, grantShape, intent,
  MainGrantGate, positive,   type PrivateCommunityGrantV1, publicKeyFingerprint, safeArray, sameScope,
type TrustedCommunityIntent,
} from './communityEtGrant';

/** Main-owned approved profile. Never accept it from renderer or grant body.
 * v2.7.0 pins the actual issuer on each outbound PeerConfig.peer_public_key.
 * The owned runtime additionally verifies the observed Noise connection identity.
 */
export interface TrustedCommunityBootstrap {
  bootstrapProfileId: string;
  upstreamCommit: typeof COMMUNITY_ET_UPSTREAM_COMMIT;
  peerEndpoints: string[];
  ipv4PrefixLength: number;
  issuerPublicKeyB64: string;
  issuerPublicKeyFingerprint: string;
}
export function validateBootstrap(value: unknown): asserts value is TrustedCommunityBootstrap {
  exact<TrustedCommunityBootstrap>(value, ['bootstrapProfileId', 'upstreamCommit', 'peerEndpoints', 'ipv4PrefixLength',
    'issuerPublicKeyB64', 'issuerPublicKeyFingerprint'], 'invalid-bootstrap-profile');
  if (value.upstreamCommit !== COMMUNITY_ET_UPSTREAM_COMMIT || !positive(value.ipv4PrefixLength) ||
      value.ipv4PrefixLength > 30 || !safeArray(value.peerEndpoints, 16) || value.peerEndpoints.length === 0 ||
      new Set(value.peerEndpoints).size !== value.peerEndpoints.length ||
      !fingerprint(value.issuerPublicKeyFingerprint) ||
      publicKeyFingerprint(value.issuerPublicKeyB64) !== value.issuerPublicKeyFingerprint) fail('invalid-bootstrap-profile');
  for (const endpoint of value.peerEndpoints) {
    // Small endpoint grammar prevents credentials, query, control text and TOML injection.
    if (typeof endpoint !== 'string' || endpoint.length > 253 ||
        !/^(tcp|udp|quic):\/\/[A-Za-z0-9][A-Za-z0-9.-]*:[1-9][0-9]{0,4}$/.test(endpoint)) fail('invalid-bootstrap-endpoint');
    const port = Number(endpoint.slice(endpoint.lastIndexOf(':') + 1));
    if (port > 65535) fail('invalid-bootstrap-endpoint');
  }
}

/** Secret-bearing draft stays opaque to JSON/object spreading/ordinary inspection.
 * The explicit sink belongs to main's ACL-restricted temporary configuration writer.
 * Pure output cannot prove file ACLs, paths, approved binaries or activation rights.
 */
export class PrivateCommunityEtConfig {
  #toml: string;
  #issuerFingerprint: string;
  #isCurrent: () => boolean;
  #latencyFirst: boolean;
  constructor(toml: string, issuerFingerprint: string, isCurrent: () => boolean, latencyFirst = false) {
    this.#toml = toml; this.#issuerFingerprint = issuerFingerprint; this.#isCurrent = isCurrent;
    this.#latencyFirst = latencyFirst;
  }
  withPrivateToml<T>(ownedWriter: (toml: string) => T): T {
    if (!this.#isCurrent()) fail('stale-config');
    return ownedWriter(this.#toml);
  }
  requirements(): Readonly<{issuerPublicKeyFingerprint: string; issuerPinMustBeVerified: true; activationReady: false}> {
    return Object.freeze({issuerPublicKeyFingerprint: this.#issuerFingerprint, issuerPinMustBeVerified: true, activationReady: false});
  }
  toJSON(): {kind: string} { return {kind: 'private-community-et-config'}; }
  routingPreferences(): {latencyFirst: boolean} { return {latencyFirst: this.#latencyFirst}; }
}
function buildValidated(grant: PrivateCommunityGrantV1, trusted: TrustedCommunityIntent, profile: TrustedCommunityBootstrap,
  isCurrent: () => boolean, preferences: CommunityNetworkPreferences): PrivateCommunityEtConfig {
  const settings = parseCommunityNetworkPreferences(preferences);
  grantShape(grant); intent(trusted); validateBootstrap(profile);
  if (!sameScope(grant.scope, trusted) || profile.bootstrapProfileId !== trusted.bootstrapProfileId ||
      (['networkName', 'networkRevision', 'virtualIp', 'bootstrapProfileId'] as const).some(k => grant[k] !== trusted[k]))
    fail('network-intent-mismatch');
  // All interpolated values are validated limited strings or canonical base64.
  const quote = (s: string) => JSON.stringify(s);
  const lines = [
    `instance_id = ${quote(trusted.nativeInstanceId)}`,
    `instance_name = ${quote('laokuai-' + trusted.communityId)}`,
    `ipv4 = ${quote(trusted.virtualIp + '/' + profile.ipv4PrefixLength)}`,
    'dhcp = false', 'listeners = []', 'member_relay_bytes_per_sec = 0', '',
    '[network_identity]', `network_name = ${quote(trusted.networkName)}`, '',
    '[secure_mode]', 'enabled = true', `local_private_key = ${quote(grant.credentialSecretB64)}`, '',
    '[flags]', `latency_first = ${settings.latencyFirst}`, `dev_name = ${quote('lkc-' + trusted.nativeInstanceId.replace(/-/g, ''))}`,
    `enable_ipv6 = ${settings.ipv6}`, `disable_upnp = ${!settings.upnp}`,
    `disable_udp_hole_punching = ${!settings.udpHolePunching}`, `disable_tcp_hole_punching = ${!settings.tcpHolePunching}`,
    `enable_udp_broadcast_relay = ${settings.udpBroadcast}`, 'accept_dns = false',
    'enable_exit_node = false', 'relay_network_whitelist = ""', '',
  ];
  for (const endpoint of profile.peerEndpoints) lines.push('[[peer]]', `uri = ${quote(endpoint)}`,
    `peer_public_key = ${quote(profile.issuerPublicKeyB64)}`, '');
  // reusable=false is verified issuer policy; adding it to TOML would not enforce it.
  return new PrivateCommunityEtConfig(lines.join('\n'), profile.issuerPublicKeyFingerprint, isCurrent, settings.latencyFirst);
}
/** Consume only the live main gate, so disable/close/revoke/expiry cannot produce config.
 * trusted/profile must come from authenticated community metadata and product template.
 * There is deliberately no path, raw TOML, helper or process parameter API here.
 */
export function buildCommunityEtConfig(gate: MainGrantGate, trusted: TrustedCommunityIntent, profile: TrustedCommunityBootstrap,
  preferences: CommunityNetworkPreferences = DEFAULT_COMMUNITY_NETWORK_PREFERENCES): PrivateCommunityEtConfig {
  const grant = gate.privateGrantForConfig();
  if (!grant) fail('no-active-grant');
  return buildValidated(grant, trusted, profile, () => {
    const current = gate.privateGrantForConfig();
    return !!current && current.grantId === grant.grantId && current.credentialId === grant.credentialId &&
      current.revision === grant.revision && current.requestId === grant.requestId;
  }, preferences);
}
