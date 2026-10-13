import { request } from 'node:https';

import type { TrustedCommunityBootstrap } from './communityEtConfig';
import { exact, id, intent, privateIpv4, type TrustedCommunityIntent } from './communityEtGrant';
import type { CommunityDirectoryMemberV1, CommunityDirectoryResponseV1, CommunitySessionResponseV1 } from './communityEtHttpContract';

export interface TrustedCommunityTarget {
  communityId: string; serverHost: string; origin: string; serverInstanceId: string;
  bootstrap: TrustedCommunityBootstrap;
}
export type VerifiedCommunitySession = Omit<CommunitySessionResponseV1, 'v'>;
export interface CommunityEtHttpPort {
  post(origin: string, operation: string, bearer: string, body: unknown, signal: AbortSignal): Promise<unknown>;
}
export class CommunityEtTransportError extends Error {
  constructor(readonly code: 'auth-unavailable' | 'provider-unavailable' | 'invalid-response' | 'request-cancelled') {
    super(code);
  }
}
export function validCommunityBearer(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 16_384 &&
    !Array.from(value).some(c => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127);
}
export function trustedHttpsOrigin(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 512) throw new CommunityEtTransportError('invalid-response');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      url.origin !== raw.replace(/\/$/, '')) throw new CommunityEtTransportError('invalid-response');
  return url.origin;
}
/** Production HTTP; no redirect, alternate destination, disabled TLS or secret logging. */
export const communityEtHttpsPort: CommunityEtHttpPort = {
  post(origin, operation, bearer, body, signal) {
    if (!['session', 'acquire', 'renew', 'revoke', 'binding', 'directory'].includes(operation) || !validCommunityBearer(bearer))
      return Promise.reject(new CommunityEtTransportError('auth-unavailable'));
    const target = new URL('/api/community-et/' + operation, trustedHttpsOrigin(origin));
    const bytes = Buffer.from(JSON.stringify(body));
    if (bytes.length > 32_768 || signal.aborted) return Promise.reject(new CommunityEtTransportError('request-cancelled'));
    return new Promise((resolve, reject) => {
      const req = request(target, { method: 'POST', signal, timeout: 8000, rejectUnauthorized: true,
        headers: { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json', 'Content-Length': bytes.length } }, res => {
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 128 * 1024) { req.destroy(); reject(new CommunityEtTransportError('invalid-response')); return; }
          chunks.push(chunk);
        });
        res.once('error', () => reject(new CommunityEtTransportError('provider-unavailable')));
        res.once('end', () => {
          if (signal.aborted) { reject(new CommunityEtTransportError('request-cancelled')); return; }
          if (res.statusCode === 401 || res.statusCode === 403) { reject(new CommunityEtTransportError('auth-unavailable')); return; }
          if (res.statusCode !== 200) { reject(new CommunityEtTransportError('provider-unavailable')); return; }
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { reject(new CommunityEtTransportError('invalid-response')); }
        });
      });
      req.once('timeout', () => req.destroy(new CommunityEtTransportError('provider-unavailable')));
      req.once('error', () => reject(new CommunityEtTransportError(signal.aborted ? 'request-cancelled' : 'provider-unavailable')));
      req.end(bytes);
    });
  },
};

/** A renderer bearer is opaque input until this exact trusted backend verifies it. */
export class CommunityEtGrantTransport {
  constructor(private port: CommunityEtHttpPort = communityEtHttpsPort) {}
  async verifySession(target: TrustedCommunityTarget, bearer: string, deviceId: string, nativeInstanceId: string,
    signal: AbortSignal): Promise<VerifiedCommunitySession> {
    const response = await this.post(target, 'session', bearer, {v: 1, communityId: target.communityId, deviceId, nativeInstanceId}, signal);
    exact<{v: number; serverUserId: string; intent: TrustedCommunityIntent}>(response, ['v', 'serverUserId', 'intent'], 'invalid-session-response');
    intent(response.intent);
    if (response.v !== 1 || !id(response.serverUserId) || response.intent.communityId !== target.communityId ||
        response.intent.serverInstanceId !== target.serverInstanceId || response.intent.deviceId !== deviceId ||
        response.intent.nativeInstanceId !== nativeInstanceId || response.intent.bootstrapProfileId !== target.bootstrap.bootstrapProfileId)
      throw new CommunityEtTransportError('invalid-response');
    return structuredClone({serverUserId: response.serverUserId, intent: response.intent});
  }
  /** Parse the server-issued roster. It is the sole source for another member's
   * virtual address; peer/voice broadcasts are intentionally not accepted here. */
  parseDirectory(value: unknown, communityId: string): CommunityDirectoryMemberV1[] {
    try { exact<CommunityDirectoryResponseV1>(value, ['v', 'communityId', 'members'], 'invalid-directory-response'); }
    catch { throw new CommunityEtTransportError('invalid-response'); }
    if (value.v !== 1 || value.communityId !== communityId || !Array.isArray(value.members) || value.members.length > 256)
      throw new CommunityEtTransportError('invalid-response');
    const addresses = new Set<string>();
    const result: CommunityDirectoryMemberV1[] = [];
    for (const member of value.members) {
      try { exact<CommunityDirectoryMemberV1>(member, ['serverUserId', 'virtualIp'], 'invalid-directory-response'); }
      catch { throw new CommunityEtTransportError('invalid-response'); }
      if (!id(member.serverUserId) || !privateIpv4(member.virtualIp) || addresses.has(member.virtualIp))
        throw new CommunityEtTransportError('invalid-response');
      addresses.add(member.virtualIp);
      result.push({serverUserId: member.serverUserId, virtualIp: member.virtualIp});
    }
    return result;
  }
  post(target: TrustedCommunityTarget, operation: string, bearer: string, body: unknown, signal: AbortSignal): Promise<unknown> {
    return this.port.post(trustedHttpsOrigin(target.origin), operation, bearer, body, signal);
  }
}
