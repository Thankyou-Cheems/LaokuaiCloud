import { publicKeyFingerprint } from './communityEtGrant';
import { EASYTIER_V270_ROUTE_LIST_SOURCE, sanitizedEasyTierCliNetwork, sanitizedEasyTierV270CliNetwork } from './easyTierCliNetwork';

export interface CredentialIdentityExpectation {
  networkName: string; virtualIp: string; publicKeyFingerprint: string; issuerPublicKeyFingerprint: string;
}
export interface OwnedCredentialObservation { peerId: number; virtualIp: string; publicKeyB64: string; issuerPinVerified: true }
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
/** Read actual verbose CLI fields privately; NodeInfo.config never leaves this parser. */
export function verifyOwnedCredentialObservation(raw: unknown, instanceId: string, expected: CredentialIdentityExpectation,
  source: typeof EASYTIER_V270_ROUTE_LIST_SOURCE | null = null): OwnedCredentialObservation {
  const info = source === EASYTIER_V270_ROUTE_LIST_SOURCE
    ? sanitizedEasyTierV270CliNetwork(raw, instanceId) : sanitizedEasyTierCliNetwork(raw, instanceId);
  if (info.my_node_info.virtual_ipv4 !== expected.virtualIp) throw new Error('credential-node-ip-mismatch');
  const localPeer = info.my_node_info.peer_id, result = object(raw);
  const rows = Array.isArray(result.peer_routes) ? result.peer_routes : [];
  let publicKeyB64: string | null = null;
  for (const row of rows) {
    const peer = object(object(row).peer);
    if (!Array.isArray(peer.conns)) continue;
    for (const item of peer.conns) {
      const c = object(item);
      const closed = c.is_closed === undefined && source === EASYTIER_V270_ROUTE_LIST_SOURCE ? false : c.is_closed;
      if (c.my_peer_id !== localPeer || c.peer_id !== peer.peer_id || c.network_name !== expected.networkName ||
          closed !== false ||
          ![2, 'PeerVerified'].includes(c.secure_auth_level as string | number) ||
          ![0, 'Admin'].includes((c.peer_identity_type ?? 0) as string | number)) continue;
      try {
        if (publicKeyFingerprint(c.noise_local_static_pubkey) !== expected.publicKeyFingerprint ||
            publicKeyFingerprint(c.noise_remote_static_pubkey) !== expected.issuerPublicKeyFingerprint) continue;
      } catch { continue; }
      if (publicKeyB64 && publicKeyB64 !== c.noise_local_static_pubkey) throw new Error('credential-node-key-conflict');
      publicKeyB64 = c.noise_local_static_pubkey as string;
    }
  }
  if (!publicKeyB64) throw new Error('issuer-connection-unverified');
  return {peerId: localPeer, virtualIp: expected.virtualIp, publicKeyB64, issuerPinVerified: true};
}
