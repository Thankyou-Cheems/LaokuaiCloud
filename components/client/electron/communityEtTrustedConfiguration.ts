import { execFile } from 'node:child_process';
import { createHash,randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { isAbsolute,join, relative } from 'node:path';

import { type PrivateCommunityEtConfig,validateBootstrap } from './communityEtConfig';
import { communityIdentity, exact, publicKeyFingerprint,uuid } from './communityEtGrant';
import { type TrustedCommunityTarget,trustedHttpsOrigin } from './communityEtGrantTransport';
import { EasyTierOperationError } from './easyTierCommunityManager';
import type { EasyTierExistingConfiguration } from './easyTierExistingConfiguration';

export interface CommunityGrantPolicy {
  schemaVersion: 2 | 3; approved: true; credentialOperationsApproved: true; driverPermissionApproved: true;
  localManagementApproved: true; expiresAtUnixMs: number | null; grantCommunities: TrustedCommunityTarget[];
}
/** Main-owned provisioner policy; renderer cannot supply URL, issuer, config or approval. */
export async function readCommunityGrantTarget(root: string, serverId: string): Promise<TrustedCommunityTarget> {
  try {
    const file = join(root, 'activation.json');
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024) throw new Error('policy-size');
    const value: unknown = JSON.parse(await readFile(file, 'utf8'));
    exact<CommunityGrantPolicy>(value, ['schemaVersion', 'approved', 'credentialOperationsApproved', 'driverPermissionApproved',
      'localManagementApproved', 'expiresAtUnixMs', 'grantCommunities'], 'invalid-grant-policy');
    const lifetimeValid = value.schemaVersion === 3 ? value.expiresAtUnixMs === null :
      value.schemaVersion === 2 && typeof value.expiresAtUnixMs === 'number' && Number.isSafeInteger(value.expiresAtUnixMs) && value.expiresAtUnixMs > Date.now();
    if (!lifetimeValid || value.approved !== true || value.credentialOperationsApproved !== true || value.driverPermissionApproved !== true ||
        value.localManagementApproved !== true ||
        !Array.isArray(value.grantCommunities) || value.grantCommunities.length > 64)
      throw new Error('grant-approval-required');
    const seen = new Set<string>();
    for (const c of value.grantCommunities) {
      exact<TrustedCommunityTarget>(c, ['communityId', 'serverHost', 'origin', 'serverInstanceId', 'bootstrap'], 'invalid-target');
      if (!communityIdentity(c.communityId) || !communityIdentity(c.serverInstanceId) || typeof c.serverHost !== 'string' || c.serverHost.length > 256 ||
          seen.has(c.communityId) || trustedHttpsOrigin(c.origin) !== c.origin) throw new Error('invalid-target');
      validateBootstrap(c.bootstrap);
      if (publicKeyFingerprint(c.bootstrap.issuerPublicKeyB64) !== c.bootstrap.issuerPublicKeyFingerprint) throw new Error('issuer-pin');
      seen.add(c.communityId);
    }
    const target = value.grantCommunities.find(c => c.communityId === serverId);
    if (!target) throw new Error('community-not-provisioned');
    return structuredClone(target);
  } catch { throw new EasyTierOperationError('configuration-required'); }
}

/** Exact current user+SYSTEM ACL, never UAC, wildcard grants or credential output. */
export async function protectOwnedFile(file: string): Promise<void> {
  if (process.platform !== 'win32') throw new EasyTierOperationError('unsupported-target');
  const system = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  const run = (binary: string, args: string[]) => new Promise<string>((resolve, reject) => {
    execFile(join(system, binary), args, {windowsHide: true, shell: false, timeout: 3000, maxBuffer: 8192}, (error, stdout) => {
      if (error) reject(new EasyTierOperationError('needs-permission')); else resolve(stdout);
    });
  });
  const text = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh']);
  const sid = /\bS-1-5-(?:\d+-)*\d+\b/.exec(text)?.[0];
  if (!sid) throw new EasyTierOperationError('needs-permission');
  await run('icacls.exe', [file, '/inheritance:r', '/grant:r', '*' + sid + ':(F)', '*S-1-5-18:(F)']);
}

export class CommunityEtOwnedFiles {
  private metadataLane: Promise<unknown> = Promise.resolve();
  constructor(private root: () => string, private protect = protectOwnedFile) {}
  identities(serverId: string): Promise<{deviceId: string; nativeInstanceId: string}> {
    const work = this.metadataLane.then(async () => {
      if (!communityIdentity(serverId)) throw new EasyTierOperationError('configuration-required');
      const root = this.root(); await mkdir(root, {recursive: true, mode: 0o700});
      if ((await lstat(root)).isSymbolicLink()) throw new EasyTierOperationError('configuration-required');
      const file = join(root, 'community-device.json');
      let value: {schemaVersion: number; deviceId: string; instances: Record<string, string>};
      try {
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) throw new Error('metadata-size');
        value = JSON.parse(await readFile(file, 'utf8'));
        if (value.schemaVersion !== 1 || !uuid(value.deviceId) || !value.instances || typeof value.instances !== 'object' ||
            Array.isArray(value.instances) || Object.keys(value.instances).length > 64 || !Object.values(value.instances).every(uuid))
          throw new Error('invalid-device-metadata');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new EasyTierOperationError('configuration-required');
        value = {schemaVersion: 1, deviceId: randomUUID(), instances: {}};
      }
      const key = createHash('sha256').update(serverId).digest('hex');
      if (!value.instances[key]) {
        if (Object.keys(value.instances).length >= 64) throw new EasyTierOperationError('configuration-required');
        value.instances[key] = randomUUID();
        // The metadata holds only UUIDs. It never holds bearer, grant or private key.
        const temporary = join(root, randomUUID() + '.device.json');
        const handle = await open(temporary, 'wx', 0o600);
        try {
          await this.protect(temporary);
          await handle.writeFile(JSON.stringify(value)); await handle.sync(); await handle.close();
          await rename(temporary, file);
        } catch (error) {
          await handle.close().catch(() => undefined); await unlink(temporary).catch(() => undefined); throw error;
        }
      }
      return {deviceId: value.deviceId, nativeInstanceId: value.instances[key]};
    });
    this.metadataLane = work.catch(() => undefined); return work;
  }
  async write(serverId: string, instanceId: string, networkName: string, draft: PrivateCommunityEtConfig, signal: AbortSignal):
    Promise<{config: EasyTierExistingConfiguration; remove(): Promise<void>}> {
    const root = this.root(); await mkdir(root, {recursive: true, mode: 0o700});
    if ((await lstat(root)).isSymbolicLink()) throw new EasyTierOperationError('configuration-required');
    const directory = join(root, 'grant-configs'); await mkdir(directory, {recursive: true, mode: 0o700});
    if ((await lstat(directory)).isSymbolicLink()) throw new EasyTierOperationError('configuration-required');
    const actualRoot = await realpath(directory);
    const file = join(actualRoot, randomUUID() + '.toml');
    const handle = await open(file, 'wx', 0o600);
    const remove = async () => { await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw new EasyTierOperationError('cleanup-failed'); }); };
    try {
      // Set ACL before writing secret bytes. No inherited Everyone/Users read access.
      await this.protect(file);
      const toml = draft.withPrivateToml(text => text);
      if (signal.aborted) throw new EasyTierOperationError('connect-failed');
      await handle.writeFile(toml); await handle.sync(); await handle.close();
      if (signal.aborted) throw new EasyTierOperationError('connect-failed');
      const actual = await realpath(file), within = relative(actualRoot, actual);
      if (!within || within.startsWith('..') || isAbsolute(within)) throw new EasyTierOperationError('configuration-required');
      return {config: {serverId, instanceId, networkName, configFile: actual,
        configSha256: createHash('sha256').update(toml).digest('hex'), bootstrap: 'product-owned', latencyFirst: draft.routingPreferences().latencyFirst}, remove};
    } catch (error) { await handle.close().catch(() => undefined); await remove(); throw error; }
  }
}
