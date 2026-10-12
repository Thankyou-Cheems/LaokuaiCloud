import {lstat, readFile} from 'node:fs/promises';
import {createConnection} from 'node:net';
import {join} from 'node:path';

import {COMMUNITY_ET_UPSTREAM_COMMIT, communityIdentity, exact, fail, id, positive, privateIpv4, safeArray, uuid} from '../easytier/communityGrant';
import type {CommunityGrantFactoryOptions} from '../easytier/communityGrantFactory';
import {CommunityTcpRpcTransport, type RpcDialer} from '../easytier/communityRpcWire';

type FixedService = Omit<CommunityGrantFactoryOptions['service'], 'enabled' | 'credentialWritesEnabled' | 'runtimeGeneration'>;
export interface CommunityEtDeployment {
  schemaVersion: 1 | 2; approved: true; expiresAtUnixMs: number | null; credentialWritesApproved: boolean;
  trustedServerOrigin: string; nativeRuntimeGeneration: number;
  service: FixedService; provider: CommunityGrantFactoryOptions['provider'];
  /** Pre-existing owner-approved local socket. This code never creates a proxy. */
  managementSocketPath: string | null;
}
const PUBLIC_MANAGEMENT_SOCKET = '/run/laokuai-community-et/public-management.sock';
/** Operator-owned public parameters only. No JWT, issuer key, member seed or renderer config. */
export function parseCommunityEtDeployment(value: unknown, nowMs = Date.now()): CommunityEtDeployment {
  exact<CommunityEtDeployment>(value, ['schemaVersion', 'approved', 'expiresAtUnixMs', 'credentialWritesApproved',
    'trustedServerOrigin', 'nativeRuntimeGeneration', 'service', 'provider', 'managementSocketPath'], 'invalid-community-et-deployment');
  const c = value;
  const lifetimeValid = c.schemaVersion === 2 ? c.expiresAtUnixMs === null :
    c.schemaVersion === 1 && typeof c.expiresAtUnixMs === 'number' && Number.isSafeInteger(c.expiresAtUnixMs) && c.expiresAtUnixMs > nowMs;
  if (!lifetimeValid || c.approved !== true ||
      typeof c.credentialWritesApproved !== 'boolean' || !positive(c.nativeRuntimeGeneration) ||
      (c.managementSocketPath !== null && c.managementSocketPath !== PUBLIC_MANAGEMENT_SOCKET)) fail('invalid-community-et-deployment');
  const origin = new URL(c.trustedServerOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
      origin.origin !== c.trustedServerOrigin) fail('invalid-community-et-deployment');
  exact<FixedService>(c.service, ['serverInstanceId', 'communityId', 'networkName', 'networkRevision', 'bootstrapProfileId',
    'virtualIpPool', 'authority', 'ttlSeconds'], 'invalid-community-et-deployment');
  const s = c.service;
  if (!communityIdentity(s.serverInstanceId) || !communityIdentity(s.communityId) || ![s.networkName, s.bootstrapProfileId].every(id) || !positive(s.networkRevision) ||
      !positive(s.ttlSeconds) || s.ttlSeconds > 300 || !safeArray(s.virtualIpPool, 254) || s.virtualIpPool.length < 1 ||
      !s.virtualIpPool.every(privateIpv4) || new Set(s.virtualIpPool).size !== s.virtualIpPool.length) fail('invalid-community-et-deployment');
  exact(s.authority, ['adminInstanceId', 'upstreamCommit', 'groups'], 'invalid-community-et-deployment');
  exact(c.provider, ['adminInstanceId', 'expectedVersion', 'endpoint'], 'invalid-community-et-deployment');
  if (!uuid(s.authority.adminInstanceId) || s.authority.upstreamCommit !== COMMUNITY_ET_UPSTREAM_COMMIT ||
      !safeArray(s.authority.groups, 32) || !s.authority.groups.every(id) || c.provider.adminInstanceId !== s.authority.adminInstanceId ||
      c.provider.expectedVersion !== '2.7.0-8b7f1f01') fail('invalid-community-et-deployment');
  exact(c.provider.endpoint, ['host', 'port', 'timeoutMs'], 'invalid-community-et-deployment');
  if (c.provider.endpoint.host !== '127.0.0.1' || c.provider.endpoint.port !== 15890 ||
      !positive(c.provider.endpoint.timeoutMs) || c.provider.endpoint.timeoutMs > 1000) fail('invalid-community-et-deployment');
  // The provider's final owner constructor validates its own exact config fields.
  return structuredClone(c);
}
export async function readCommunityEtDeployment(dataDirectory: string): Promise<CommunityEtDeployment | null> {
  const file = join(dataDirectory, 'community-et-deployment.json');
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) fail('invalid-community-et-deployment');
    return parseCommunityEtDeployment(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('community-et-configuration-unavailable');
  }
}
/** Connect only to the fixed already-approved Unix socket. No listener/helper/root access. */
export function communityEtManagementTransport(c: CommunityEtDeployment): CommunityTcpRpcTransport | undefined {
  if (c.managementSocketPath === null) return undefined;
  if (process.platform !== 'linux' || c.managementSocketPath !== PUBLIC_MANAGEMENT_SOCKET) fail('invalid-community-et-deployment');
  const path = c.managementSocketPath;
  const dial: RpcDialer = endpoint => new Promise((resolve, reject) => {
    const socket = createConnection({path});
    const timer = setTimeout(() => {socket.destroy(); reject(new Error('rpc-unavailable'));}, endpoint.timeoutMs);
    const failed = () => {clearTimeout(timer); reject(new Error('rpc-unavailable'));};
    socket.once('error', failed);
    socket.once('connect', () => {
      clearTimeout(timer); socket.removeListener('error', failed);
      resolve({write: bytes => {socket.write(bytes);}, onData: fn => {socket.on('data', fn);},
        onError: fn => {socket.on('error', fn);}, onClose: fn => {socket.on('close', fn);}, close: () => {socket.destroy();}});
    });
  });
  return new CommunityTcpRpcTransport(c.provider.endpoint, dial);
}
