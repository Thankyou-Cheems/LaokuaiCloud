import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

import { EasyTierOperationError, validEasyTierId } from "./easyTierCommunityManager";
import { easyTierSha256 } from "./easyTierWindowsAssets";
import type { CredentialIdentityExpectation } from "./communityEtCredentialObservation";

export interface EasyTierExistingConfiguration {
  serverId: string;
  instanceId: string;
  networkName: string;
  configFile: string;
  configSha256: string;
  /** Provisioner reviewed this config's peer/bootstrap URLs; public fallback is absent. */
  bootstrap: "product-owned";
  /** Explicit product-owned policy. Legacy receipts without it remain unknown. */
  latencyFirst?: boolean;
  /** Main-generated live grant, never a renderer field or saved activation capability. */
  credentialIdentity?: CredentialIdentityExpectation;
}
export interface EasyTierActivationReceipt {
  schemaVersion: 1;
  approved: true;
  /** Explicit driver/network activation approval; not a substitute for token permissions. */
  driverPermissionApproved: true;
  /** Core loopback RPC has no Windows user authentication. Required until native ACL transport. */
  localManagementApproved: true;
  communities: EasyTierExistingConfiguration[];
}
const hash = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Main-only provisioner receipt. No secret, endpoint, TOML or path IPC from renderer. */
export function parseEasyTierActivationReceipt(value: unknown): EasyTierActivationReceipt {
  const v = value as Partial<EasyTierActivationReceipt> | null;
  if (!v || v.schemaVersion !== 1 || v.approved !== true) throw new EasyTierOperationError("activation-required");
  if (v.driverPermissionApproved !== true || v.localManagementApproved !== true) throw new EasyTierOperationError("needs-permission");
  if (!Array.isArray(v.communities) || v.communities.length > 64) throw new EasyTierOperationError("configuration-required");
  const ids = new Set(), instances = new Set(), networks = new Set();
  for (const c of v.communities) {
    if (!c || !validEasyTierId(c.serverId) || !uuid.test(c.instanceId) || !validEasyTierId(c.networkName)
      || typeof c.configFile !== "string" || !isAbsolute(c.configFile) || !hash.test(c.configSha256)
      || c.bootstrap !== "product-owned" || (c.latencyFirst !== undefined && typeof c.latencyFirst !== "boolean")
      || ids.has(c.serverId) || instances.has(c.instanceId) || networks.has(c.networkName)) throw new EasyTierOperationError("configuration-required");
    ids.add(c.serverId); instances.add(c.instanceId); networks.add(c.networkName);
  }
  return v as EasyTierActivationReceipt;
}
export async function readEasyTierExistingConfiguration(root: string, serverId: string): Promise<EasyTierExistingConfiguration> {
  let receipt: unknown;
  try {
    const file = join(root, "activation.json");
    if ((await stat(file)).size > 128 * 1024) throw new Error("receipt-size");
    receipt = JSON.parse(await readFile(file, "utf8"));
  } catch { throw new EasyTierOperationError("configuration-required"); }
  const config = parseEasyTierActivationReceipt(receipt).communities.find(c => c.serverId === serverId);
  if (!config) throw new EasyTierOperationError("configuration-required");
  try {
    // Reject symlink escape, arbitrary profiles, mutable unreviewed config and large files.
    const trustedRoot = await realpath(join(root, "configs"));
    const actual = await realpath(config.configFile);
    const within = relative(trustedRoot, actual);
    if (!within || within.startsWith("..") || isAbsolute(within) || (await stat(actual)).size > 256 * 1024) throw new Error("config-path");
    if (easyTierSha256(await readFile(actual)) !== config.configSha256) throw new Error("config-hash");
    return { ...config, configFile: actual };
  } catch { throw new EasyTierOperationError("configuration-required"); }
}
