import {
  copiedScope, exact, expiryUnixToMs, fail, fingerprint, id, natural, positive, relayConsentShape,
  safeArray, sameScope, scope, uuid, versionedGrantShape,
  type CommunityGrantScope, type NativeCredentialReadback, type PrivateCommunityGrant, type PrivateCommunityGrantV2, type RelayConsentV2,
} from './communityGrant';

export interface CommunityRelayRequestV2 {
  v: 2; communityId: string; deviceId: string; nativeInstanceId: string; requestId: string; grantId: string;
  expectedConsentRevision: number; enabled: boolean; bytesPerSecond: number;
}
export type CommunityRelayRenewRequestV2 = Pick<CommunityRelayRequestV2,
  'v'|'communityId'|'deviceId'|'nativeInstanceId'|'requestId'|'grantId'>;
export interface CommunityRelayResponseV2 { v: 2; consent: RelayConsentV2; grant: PrivateCommunityGrantV2 }
export interface RelayNativeIntent {
  v: 2; instance: string; id: string; secret: string; expiryUnix: number; groups: string[];
  previousAllowRelay: boolean; allowRelay: boolean;
}
export interface RelayCredentialProvider {
  setRelayPolicySameKey(request: RelayNativeIntent): Promise<{changed: boolean}>;
}
export interface PendingRelayMutation {
  requestId: string; grantId: string; credentialId: string; publicKeyFingerprint: string;
  authorizationEpoch: number; priorRevision: number; previousAllowRelay: boolean;
  target: RelayConsentV2; expiryUnix: number; renew: boolean;
}
export interface StoredRelayState { consent: RelayConsentV2; lastRequestId: string | null; lastAttemptId: string | null; pending: PendingRelayMutation | null }
export const emptyRelayState = (): StoredRelayState => ({consent:{v:2,enabled:false,revision:0,bytesPerSecond:0},lastRequestId:null,lastAttemptId:null,pending:null});
export function storedRelayShape(value: unknown): asserts value is StoredRelayState {
  exact<StoredRelayState>(value,['consent','lastRequestId','lastAttemptId','pending'],'grant-store-corrupt'); relayConsentShape(value.consent);
  if (value.lastRequestId !== null && !id(value.lastRequestId) || value.lastAttemptId !== null && !id(value.lastAttemptId)) fail('grant-store-corrupt');
  if (value.pending) {
    const p=value.pending;
    exact<PendingRelayMutation>(p,['requestId','grantId','credentialId','publicKeyFingerprint','authorizationEpoch','priorRevision','previousAllowRelay','target','expiryUnix','renew'],'grant-store-corrupt');
    relayConsentShape(p.target);
    if (![p.requestId,p.grantId,p.credentialId].every(id) || !fingerprint(p.publicKeyFingerprint) || !positive(p.authorizationEpoch) ||
        !positive(p.priorRevision) || typeof p.previousAllowRelay !== 'boolean' || typeof p.renew !== 'boolean') fail('grant-store-corrupt');
    expiryUnixToMs(p.expiryUnix);
  }
}
export function parseRelayRequest(raw: unknown, renew = false): CommunityRelayRequestV2 | CommunityRelayRenewRequestV2 {
  const keys=['v','communityId','deviceId','nativeInstanceId','requestId','grantId'];
  if (!renew) keys.push('expectedConsentRevision','enabled','bytesPerSecond');
  exact<CommunityRelayRequestV2>(raw,keys,'invalid-relay-request');
  // Reuse the scope grammar, including the existing community namespace.
  scope({serverInstanceId:raw.communityId,accountId:'authenticated',communityId:raw.communityId,deviceId:raw.deviceId,nativeInstanceId:raw.nativeInstanceId});
  if (raw.v !== 2 || !id(raw.requestId) || !id(raw.grantId) || !uuid(raw.nativeInstanceId)) fail('invalid-relay-request');
  if (!renew) {
    if (!natural(raw.expectedConsentRevision) || !positive(raw.expectedConsentRevision + 1)) fail('invalid-relay-request');
    relayConsentShape({v:2,enabled:raw.enabled,revision:raw.expectedConsentRevision+1,bytesPerSecond:raw.bytesPerSecond});
  }
  return structuredClone(raw);
}
export function relayGrantFromReadback(
  prior: PrivateCommunityGrant, pending: PendingRelayMutation, readback: NativeCredentialReadback, expectedGroups: readonly string[], nowMs: number,
): PrivateCommunityGrantV2 {
  versionedGrantShape(prior);
  exact<NativeCredentialReadback>(readback,['id','groups','allowRelay','allowedProxyCidrs','reusable','expiryUnix','publicKeyFingerprint'],'relay-readback-mismatch');
  if (!safeArray(readback.groups,32) || !safeArray(readback.allowedProxyCidrs,0)) fail('relay-readback-mismatch');
  if (prior.revision !== pending.priorRevision || prior.grantId !== pending.grantId || prior.credentialId !== pending.credentialId || prior.publicKeyFingerprint !== pending.publicKeyFingerprint ||
      readback.id !== prior.credentialId || readback.publicKeyFingerprint !== prior.publicKeyFingerprint || readback.reusable !== false ||
      readback.allowedProxyCidrs.length !== 0 || readback.allowRelay !== pending.target.enabled || readback.expiryUnix !== pending.expiryUnix ||
      readback.groups.length !== expectedGroups.length || new Set(readback.groups).size !== expectedGroups.length || !expectedGroups.every(g=>readback.groups.includes(g)))
    fail('relay-readback-mismatch');
  const expiresAtMs=expiryUnixToMs(readback.expiryUnix);
  if (!natural(nowMs) || nowMs >= expiresAtMs || (pending.renew && expiresAtMs <= prior.expiresAtMs)) fail('expired-grant');
  const grant: PrivateCommunityGrantV2={...structuredClone(prior),v:2,requestId:pending.requestId,revision:prior.revision+1,
    serverTimeMs:nowMs,expiresAtMs,
    ...(pending.renew ? {issuedAtMs:nowMs,renewAfterMs:nowMs+Math.floor((expiresAtMs-nowMs)*0.6)} : {}),
    policy:{reusable:false,allowRelay:pending.target.enabled,allowedProxyCidrs:[],relay:structuredClone(pending.target)}};
  versionedGrantShape(grant); return grant;
}
export function sameRelayScope(a: CommunityGrantScope, b: CommunityGrantScope): boolean { return sameScope(copiedScope(a),copiedScope(b)); }
