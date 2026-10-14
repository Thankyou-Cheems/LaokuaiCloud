import { request } from 'node:https';

import type { TrustedCommunityBootstrap } from './communityEtConfig';
import { exact, id, intent, privateIpv4, type TrustedCommunityIntent } from './communityEtGrant';
import type { CommunityDirectoryBindingsV1, CommunityDirectoryMemberV1, CommunityDirectoryResponseV1, CommunitySessionResponseV1 } from './communityEtHttpContract';

export interface TrustedCommunityTarget {
  communityId: string; serverHost: string; origin: string; serverInstanceId: string;
  bootstrap: TrustedCommunityBootstrap;
}
export type VerifiedCommunitySession = Omit<CommunitySessionResponseV1, 'v'>;
export interface CommunityEtHttpPort {
  post(origin: string, operation: string, bearer: string, body: unknown, signal: AbortSignal,
    onStatus?: (status: number) => void): Promise<unknown>;
}
const operations = ['session', 'acquire', 'renew', 'revoke', 'binding', 'directory', 'relay', 'relay-renew', 'relay-status'] as const;
const transportErrors = ['auth-unavailable', 'provider-unavailable', 'invalid-response', 'request-cancelled', 'directory-extension-unsupported'] as const;
const serviceReasons = ['binding-pending', 'binding-unproven', 'provider-sample-conflict', 'provider-observation-mismatch',
  'route-binding-mismatch', 'duplicate-key-owner', 'connection-evidence-conflict', 'grant-operation-busy',
  'grant-operation-retired', 'operation-retired', 'unknown-grant', 'inactive-binding-grant', 'expired-grant',
  'reconciliation-required', 'revocation-unconfirmed', 'renewal-not-extended', 'community-et-unavailable',
  'community-et-disabled', 'provider-incompatible', 'issuer-store-unavailable'] as const;
export type CommunityEtServiceReason = typeof serviceReasons[number];
function safeServiceReason(value: unknown): CommunityEtServiceReason | null {
  return typeof value === 'string' && serviceReasons.includes(value as CommunityEtServiceReason) ? value as CommunityEtServiceReason : null;
}
function responseServiceReason(chunks: Buffer[], size: number): CommunityEtServiceReason | null {
  if (size > 4096) return null;
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || (value.v !== 1 && value.v !== 2) || Object.keys(value).length !== 2) return null;
    return safeServiceReason(value.error);
  } catch { return null; }
}
export interface CommunityEtHttpDiagnostic {
  event: 'http'; action: 'start' | 'finish'; operation: typeof operations[number];
  httpStatus: number | null; code: typeof transportErrors[number] | 'success';
  reason: CommunityEtServiceReason | null;
}
export class CommunityEtTransportError extends Error {
  constructor(readonly code: 'auth-unavailable' | 'provider-unavailable' | 'invalid-response' | 'request-cancelled' | 'directory-extension-unsupported',
    readonly reason: CommunityEtServiceReason | null = null) {
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
  post(origin, operation, bearer, body, signal, onStatus) {
    if (!operations.includes(operation as typeof operations[number]) || !validCommunityBearer(bearer))
      return Promise.reject(new CommunityEtTransportError('auth-unavailable'));
    const target = new URL('/api/community-et/' + operation, trustedHttpsOrigin(origin));
    const bytes = Buffer.from(JSON.stringify(body));
    if (bytes.length > 32_768 || signal.aborted) return Promise.reject(new CommunityEtTransportError('request-cancelled'));
    return new Promise((resolve, reject) => {
      const req = request(target, { method: 'POST', signal, timeout: 8000, rejectUnauthorized: true,
        headers: { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json', 'Content-Length': bytes.length } }, res => {
        if (Number.isInteger(res.statusCode) && res.statusCode! >= 100 && res.statusCode! <= 599) {
          try { onStatus?.(res.statusCode!); } catch { /* Diagnostics never affect HTTP. */ }
        }
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 128 * 1024) { req.destroy(); reject(new CommunityEtTransportError('invalid-response')); return; }
          chunks.push(chunk);
        });
        res.once('error', () => reject(new CommunityEtTransportError('provider-unavailable')));
        res.once('end', () => {
          if (signal.aborted) { reject(new CommunityEtTransportError('request-cancelled')); return; }
          const reason = res.statusCode === 200 ? null : responseServiceReason(chunks, size);
          if (res.statusCode === 401 || res.statusCode === 403) { reject(new CommunityEtTransportError('auth-unavailable', reason)); return; }
          if (res.statusCode === 400 && operation === 'directory' && body && typeof body === 'object' &&
              ((body as {includeDnsNames?: unknown}).includeDnsNames === true || (body as {includeBindings?: unknown}).includeBindings === true)) {
            reject(new CommunityEtTransportError('directory-extension-unsupported', reason)); return;
          }
          if (res.statusCode !== 200) { reject(new CommunityEtTransportError('provider-unavailable', reason)); return; }
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
  constructor(private port: CommunityEtHttpPort = communityEtHttpsPort,
    private diagnostic?: (event: CommunityEtHttpDiagnostic) => void) {}
  private report(event: CommunityEtHttpDiagnostic): void {
    try { this.diagnostic?.(event); } catch { /* Diagnostics never affect credentials. */ }
  }
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
  parseDirectoryBindings(value: unknown, members: CommunityDirectoryMemberV1[]): CommunityDirectoryBindingsV1 {
    try {
      exact<CommunityDirectoryBindingsV1>(value, ['serverTimeMs', 'maxAgeMs', 'members'], 'invalid-directory-bindings');
      if (!Number.isSafeInteger(value.serverTimeMs) || value.serverTimeMs <= 0 || value.maxAgeMs !== 5000 ||
          !Array.isArray(value.members) || value.members.length > 256) throw new Error('invalid-directory-bindings');
      const peers = new Set<number>(), addresses = new Set<string>();
      for (const row of value.members) {
        exact(row, ['serverUserId', 'virtualIp', 'peerId', 'expiresAtMs'], 'invalid-directory-bindings');
        if (!id(row.serverUserId) || !privateIpv4(row.virtualIp) || !members.some(m => m.serverUserId === row.serverUserId && m.virtualIp === row.virtualIp) ||
            !Number.isSafeInteger(row.peerId) || row.peerId < 1 || row.peerId > 0xffffffff || peers.has(row.peerId) || addresses.has(row.virtualIp) ||
            !Number.isSafeInteger(row.expiresAtMs) || row.expiresAtMs <= value.serverTimeMs || row.expiresAtMs > value.serverTimeMs + value.maxAgeMs)
          throw new Error('invalid-directory-bindings');
        peers.add(row.peerId); addresses.add(row.virtualIp);
      }
      return structuredClone(value);
    } catch { throw new CommunityEtTransportError('invalid-response'); }
  }
  async post(target: TrustedCommunityTarget, operation: string, bearer: string, body: unknown, signal: AbortSignal): Promise<unknown> {
    if (!operations.includes(operation as typeof operations[number])) throw new CommunityEtTransportError('auth-unavailable');
    const safeOperation = operation as typeof operations[number];
    let httpStatus: number | null = null;
    this.report({event: 'http', action: 'start', operation: safeOperation, httpStatus, code: 'success', reason: null});
    try {
      const result = await this.port.post(trustedHttpsOrigin(target.origin), operation, bearer, body, signal, status => {
        if (Number.isInteger(status) && status >= 100 && status <= 599) httpStatus = status;
      });
      this.report({event: 'http', action: 'finish', operation: safeOperation, httpStatus, code: 'success', reason: null});
      return result;
    } catch (error) {
      const code = error instanceof CommunityEtTransportError && transportErrors.includes(error.code) ? error.code : 'provider-unavailable';
      const reason = error instanceof CommunityEtTransportError ? safeServiceReason(error.reason) : null;
      this.report({event: 'http', action: 'finish', operation: safeOperation, httpStatus, code, reason});
      throw error;
    }
  }
}
