// Generated from canonical server communityGrantApi.ts (Git blob0a058fecc3d70f52aec785699cc30625617ee236).
// Do not edit independently. This projection keeps client builds inside their repository boundary.
import type {CommunityGrantScope, PrivateCommunityGrantV1, TrustedCommunityIntent} from './communityEtGrant';

export interface CommunitySessionRequestV1 {
  v: 1; communityId: string; deviceId: string; nativeInstanceId: string;
}
export interface CommunityAcquireRequestV1 extends CommunitySessionRequestV1 { requestId: string }
export interface CommunityRenewRequestV1 extends CommunityAcquireRequestV1 { grantId: string }
export type CommunityRevokeRequestV1 = CommunityRenewRequestV1;
export interface CommunityBindingRequestV1 extends CommunitySessionRequestV1 { grantId: string }
export interface CommunitySessionResponseV1 { v: 1; serverUserId: string; intent: TrustedCommunityIntent }
export interface CommunityRevokeResponseV1 { v: 1; revoked: true }
export interface CommunityDirectoryRequestV1 { v: 1; communityId: string }
/** A member may have several distinct device addresses; allocation is not connectivity. */
export interface CommunityDirectoryMemberV1 { serverUserId: string; virtualIp: string }
export interface CommunityDirectoryResponseV1 { v: 1; communityId: string; members: CommunityDirectoryMemberV1[] }
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
  directory(bearer: string, body: CommunityDirectoryRequestV1): Promise<CommunityDirectoryResponseV1>;
}
