/** HTTP/main coordination DTOs. No service success implementation or native activation.
 * Authenticated identity is derived by backend, never accepted in these request bodies.
 * Register under /api/community-et only after real fixed-version RPC interoperability.
 */
import { exact, fail, id, uuid, type CommunityGrantScope, type PrivateCommunityGrantV1, type TrustedCommunityIntent } from './communityGrant';

export interface CommunitySessionRequestV1 {
  v: 1; communityId: string; deviceId: string; nativeInstanceId: string;
}
export interface CommunityAcquireRequestV1 extends CommunitySessionRequestV1 { requestId: string }
export interface CommunityRenewRequestV1 extends CommunityAcquireRequestV1 { grantId: string }
export type CommunityRevokeRequestV1 = CommunityRenewRequestV1;
export interface CommunityBindingRequestV1 extends CommunitySessionRequestV1 { grantId: string }
export interface CommunitySessionResponseV1 { v: 1; serverUserId: string; intent: TrustedCommunityIntent }
export interface CommunityRevokeResponseV1 { v: 1; revoked: true }
export interface CommunityBindingProofV1 {
  v: 1; serverUserId: string; scope: CommunityGrantScope; grantId: string; credentialId: string; revision: number;
  peerId: number; virtualIp: string; publicKeyFingerprint: string; physicalDirectVerified: false;
}
export interface CommunityGrantApi {
  session(bearer: string, body: CommunitySessionRequestV1): Promise<CommunitySessionResponseV1>;
  acquire(bearer: string, body: CommunityAcquireRequestV1): Promise<PrivateCommunityGrantV1>;
  renew(bearer: string, body: CommunityRenewRequestV1): Promise<PrivateCommunityGrantV1>;
  /** A pending issuer cleanup returns a stable non-200 error, never revoked:true. */
  revoke(bearer: string, body: CommunityRevokeRequestV1): Promise<CommunityRevokeResponseV1>;
  binding(bearer: string, body: CommunityBindingRequestV1): Promise<CommunityBindingProofV1>;
}
export function parseCommunityGrantRequest(kind: 'session', raw: unknown): CommunitySessionRequestV1;
export function parseCommunityGrantRequest(kind: 'acquire', raw: unknown): CommunityAcquireRequestV1;
export function parseCommunityGrantRequest(kind: 'renew' | 'revoke', raw: unknown): CommunityRenewRequestV1;
export function parseCommunityGrantRequest(kind: 'binding', raw: unknown): CommunityBindingRequestV1;
export function parseCommunityGrantRequest(kind: 'session' | 'acquire' | 'renew' | 'revoke' | 'binding', raw: unknown) {
  const keys = ['v','communityId','deviceId','nativeInstanceId'];
  if (kind === 'acquire' || kind === 'renew' || kind === 'revoke') keys.push('requestId');
  if (kind === 'renew' || kind === 'revoke' || kind === 'binding') keys.push('grantId');
  exact<CommunityRenewRequestV1>(raw, keys, 'invalid-community-et-request');
  if (raw.v !== 1 || !id(raw.communityId) || !id(raw.deviceId) || !uuid(raw.nativeInstanceId) ||
      (keys.includes('requestId') && !id(raw.requestId)) || (keys.includes('grantId') && !id(raw.grantId))) fail('invalid-community-et-request');
  return structuredClone(raw);
}
