import { createHash } from 'node:crypto';

import { communityIdentity, fail, id, natural, positive } from './communityGrant';

export interface CommunityMemberIdentity {
  accountId: string; serverUserId: string; tokenDigest: string; issuedAtMs: number; expiresAtMs: number;
}
export type CommunityMemberAuthorizer = (bearer: string, communityId: string) => Promise<CommunityMemberIdentity>;
/** Pass the existing verifyAccessToken/getServerConfig/checkSessionAllowed functions.
 * No independent token issuer, membership table, role system or JWT secret is added.
 */
export interface ExistingCommunityAuthServices {
  verifyAccessToken: (bearer: string) => unknown;
  getServerConfig: () => Promise<{token_version: number} | null>;
  checkSessionAllowed: (identity: {grytUserId: string; serverUserId: string}) => Promise<
    {ok: true; user: {gryt_user_id: string; server_user_id: string; is_active: boolean; token_version: number}} |
    {ok: false; code: string}>;
}
export function createCommunityMemberAuthorizer(services: ExistingCommunityAuthServices,
  trusted: {communityId: string; serverHost: string}, now: () => number = Date.now): CommunityMemberAuthorizer {
  if (!communityIdentity(trusted.communityId) || !trusted.serverHost || new URL('https://' + trusted.serverHost).host !== trusted.serverHost)
    fail('invalid-auth-config');
  const expected = {...trusted};
  return async (bearer, communityId) => {
    if (communityId !== expected.communityId) fail('community-forbidden');
    if (typeof bearer !== 'string' || bearer.length < 1 || bearer.length > 8192 || /\s/.test(bearer)) fail('auth-required');
    let claims: Record<string, unknown>;
    try {
      const raw = services.verifyAccessToken(bearer);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('auth-required');
      claims = raw as Record<string, unknown>;
    } catch { return fail('auth-required'); }
    if (!id(claims.grytUserId) || !id(claims.serverUserId) || claims.serverHost !== expected.serverHost ||
        claims.scope !== undefined || !natural(claims.tokenVersion) || !natural(claims.userTokenVersion ?? 0) ||
        !natural(claims.iat) || !positive(claims.exp) || !Number.isSafeInteger(claims.exp * 1000) ||
        claims.iat * 1000 > now() || claims.exp * 1000 <= now()) fail('auth-required');
    let configuration: Awaited<ReturnType<ExistingCommunityAuthServices['getServerConfig']>>;
    let membership: Awaited<ReturnType<ExistingCommunityAuthServices['checkSessionAllowed']>>;
    try {
      // Fail closed here even though the general bearer middleware historically
      // tolerates a failed server token-version read.
      configuration = await services.getServerConfig();
      membership = await services.checkSessionAllowed({grytUserId:claims.grytUserId,serverUserId:claims.serverUserId});
    } catch { return fail('auth-unavailable'); }
    if (!configuration || !natural(configuration.token_version)) fail('auth-unavailable');
    if (configuration.token_version !== claims.tokenVersion) fail('auth-retired');
    if (!membership.ok || !membership.user.is_active || membership.user.gryt_user_id !== claims.grytUserId ||
        membership.user.server_user_id !== claims.serverUserId) fail('membership-required');
    if ((claims.userTokenVersion ?? 0) !== membership.user.token_version) fail('auth-retired');
    if (claims.exp * 1000 <= now()) fail('auth-retired');
    return {accountId:claims.grytUserId,serverUserId:claims.serverUserId,
      tokenDigest:createHash('sha256').update(bearer).digest('hex'),issuedAtMs:claims.iat * 1000,expiresAtMs:claims.exp * 1000};
  };
}
