/** HTTP/main coordination DTOs. No service success implementation or native activation.
 * Authenticated identity is derived by backend, never accepted in these request bodies.
 * Register under /api/community-et only after real fixed-version RPC interoperability.
 */
import { communityIdentity, exact, fail, id, uuid, type CommunityGrantScope, type PrivateCommunityGrantV1, type TrustedCommunityIntent } from './communityGrant';
import type { CommunityRelayRequestV2, CommunityRelayRenewRequestV2, CommunityRelayResponseV2 } from './communityRelayPolicy';

export interface CommunitySessionRequestV1 {
  v: 1; communityId: string; deviceId: string; nativeInstanceId: string;
}
export interface CommunityAcquireRequestV1 extends CommunitySessionRequestV1 { requestId: string }
export interface CommunityRenewRequestV1 extends CommunityAcquireRequestV1 { grantId: string }
export type CommunityRevokeRequestV1 = CommunityRenewRequestV1;
export interface CommunityBindingRequestV1 extends CommunitySessionRequestV1 { grantId: string }
export interface CommunitySessionResponseV1 { v: 1; serverUserId: string; intent: TrustedCommunityIntent }
export interface CommunityRevokeResponseV1 { v: 1; revoked: true }
/**
 * A read-only roster of addresses assigned by this community's ET authority.
 * It deliberately contains no peer IDs, physical endpoints, keys or voice data.
 * The address is stable for the authenticated account+device registration.
 * A serverUserId may appear for several devices, each with a distinct address.
 * Active credential authorization never proves online/route connectivity.
 */
export interface CommunityDirectoryRequestV1 { v: 1; communityId: string; includeDnsNames?: true; dnsNameStyle?: 'friendly' }
export interface CommunityDirectoryMemberV1 { serverUserId: string; virtualIp: string }
export interface CommunityDirectoryResponseV1 {
  v: 1; communityId: string; members: CommunityDirectoryMemberV1[];
}
/** Opt-in only: legacy requests keep their exact legacy response shape. */
export interface CommunityDnsDirectoryMemberV1 extends CommunityDirectoryMemberV1 { dnsName: string; dnsExpiresAtMs: number }
export interface CommunityDnsDirectoryResponseV1 {
  v: 1; communityId: string; members: CommunityDnsDirectoryMemberV1[];
  dns: { zone: string; serverTimeMs: number; maxAgeMs: number };
}
export interface CommunityBindingProofV1 {
  v: 1; serverUserId: string; scope: CommunityGrantScope; grantId: string; credentialId: string; revision: number;
  peerId: number; virtualIp: string; publicKeyFingerprint: string; physicalDirectVerified: false;
}
export interface CommunityGrantApi {
  relay?(bearer: string, body: CommunityRelayRequestV2): Promise<CommunityRelayResponseV2>;
  relayRenew?(bearer: string, body: CommunityRelayRenewRequestV2): Promise<CommunityRelayResponseV2>;
  relayStatus?(bearer: string, body: CommunityRelayRenewRequestV2): Promise<CommunityRelayResponseV2>;
  session(bearer: string, body: CommunitySessionRequestV1): Promise<CommunitySessionResponseV1>;
  acquire(bearer: string, body: CommunityAcquireRequestV1): Promise<PrivateCommunityGrantV1>;
  renew(bearer: string, body: CommunityRenewRequestV1): Promise<PrivateCommunityGrantV1>;
  /** A pending issuer cleanup returns a stable non-200 error, never revoked:true. */
  revoke(bearer: string, body: CommunityRevokeRequestV1): Promise<CommunityRevokeResponseV1>;
  binding(bearer: string, body: CommunityBindingRequestV1): Promise<CommunityBindingProofV1>;
  directory(bearer: string, body: CommunityDirectoryRequestV1): Promise<CommunityDirectoryResponseV1 | CommunityDnsDirectoryResponseV1>;
}
export function parseCommunityGrantRequest(kind: 'session', raw: unknown): CommunitySessionRequestV1;
export function parseCommunityGrantRequest(kind: 'acquire', raw: unknown): CommunityAcquireRequestV1;
export function parseCommunityGrantRequest(kind: 'renew' | 'revoke', raw: unknown): CommunityRenewRequestV1;
export function parseCommunityGrantRequest(kind: 'binding', raw: unknown): CommunityBindingRequestV1;
export function parseCommunityGrantRequest(kind: 'directory', raw: unknown): CommunityDirectoryRequestV1;
export function parseCommunityGrantRequest(kind: 'session' | 'acquire' | 'renew' | 'revoke' | 'binding' | 'directory', raw: unknown) {
  if (kind === 'directory') {
    const hasDns = !!raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'includeDnsNames');
    const hasStyle = !!raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'dnsNameStyle');
    exact<CommunityDirectoryRequestV1>(raw, ['v', 'communityId', ...(hasDns ? ['includeDnsNames'] : []), ...(hasStyle ? ['dnsNameStyle'] : [])], 'invalid-directory-query');
    if (raw.v !== 1 || !communityIdentity(raw.communityId) || (hasDns && raw.includeDnsNames !== true) ||
        (hasStyle && (!hasDns || raw.dnsNameStyle !== 'friendly'))) fail('invalid-directory-query');
    return structuredClone(raw);
  }
  const keys = ['v','communityId','deviceId','nativeInstanceId'];
  if (kind === 'acquire' || kind === 'renew' || kind === 'revoke') keys.push('requestId');
  if (kind === 'renew' || kind === 'revoke' || kind === 'binding') keys.push('grantId');
  exact<CommunityRenewRequestV1>(raw, keys, 'invalid-community-et-request');
  if (raw.v !== 1 || !communityIdentity(raw.communityId) || !id(raw.deviceId) || !uuid(raw.nativeInstanceId) ||
      (keys.includes('requestId') && !id(raw.requestId)) || (keys.includes('grantId') && !id(raw.grantId))) fail('invalid-community-et-request');
  return structuredClone(raw);
}
