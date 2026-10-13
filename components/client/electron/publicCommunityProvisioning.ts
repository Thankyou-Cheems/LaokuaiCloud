import {randomUUID} from "node:crypto";
import {lstat, mkdir, open, readFile, rename, unlink} from "node:fs/promises";
import {join} from "node:path";

import type {BrowserWindow} from "electron";

import type {TrustedCommunityTarget} from "./communityEtGrantTransport";
import {type CommunityGrantPolicy,protectOwnedFile, readCommunityGrantTarget} from "./communityEtTrustedConfiguration";
import {hasEasyTierWindowsPermission} from "./easyTierWindowsProcesses";

/** Public routing and issuer pin only. No password, account, grant or private key. */
export const PUBLIC_COMMUNITY_TARGET: TrustedCommunityTarget = {
  communityId: "老蒯聊_5000_default", serverInstanceId: "老蒯聊_5000_default",
  serverHost: "voice.ruikang.wang", origin: "https://voice.ruikang.wang",
  bootstrap: {bootstrapProfileId: "laokuai-public270-9db53f79", upstreamCommit: "8b7f1f0196edb5b580829ed5f135050fb5853478",
    peerEndpoints: ["tcp://124.221.119.113:11014"], ipv4PrefixLength: 24,
    issuerPublicKeyB64: "iP6v39g6ghV7ziiJIV5gwcR+gGHYHz7f/cUEA3hiXyk=",
    issuerPublicKeyFingerprint: "81915f84f741f90338dc2289354e1beeb42673dcb293ed8e1372326616f13498"},
};
function isFixedPublicTarget(value: TrustedCommunityTarget): boolean {
  const expected = PUBLIC_COMMUNITY_TARGET;
  return value.communityId === expected.communityId && value.serverInstanceId === expected.serverInstanceId &&
    value.serverHost === expected.serverHost && value.origin === expected.origin &&
    value.bootstrap.bootstrapProfileId === expected.bootstrap.bootstrapProfileId &&
    value.bootstrap.upstreamCommit === expected.bootstrap.upstreamCommit &&
    value.bootstrap.ipv4PrefixLength === expected.bootstrap.ipv4PrefixLength &&
    value.bootstrap.issuerPublicKeyB64 === expected.bootstrap.issuerPublicKeyB64 &&
    value.bootstrap.issuerPublicKeyFingerprint === expected.bootstrap.issuerPublicKeyFingerprint &&
    value.bootstrap.peerEndpoints.length === expected.bootstrap.peerEndpoints.length &&
    value.bootstrap.peerEndpoints.every((endpoint, index) => endpoint === expected.bootstrap.peerEndpoints[index]);
}
export async function publicCommunityMode(root: string): Promise<"normal" | "needs-consent"> {
  try {
    const target = await readCommunityGrantTarget(root, PUBLIC_COMMUNITY_TARGET.communityId);
    return isFixedPublicTarget(target) ? "normal" : "needs-consent";
  } catch { return "needs-consent"; }
}
/** The elevated application creates this fixed machine policy after member admission. */
export async function approvePublicCommunity(root: string, serverId: string, _parent?: BrowserWindow,
  preparePermission: () => Promise<boolean> = hasEasyTierWindowsPermission): Promise<{accepted: boolean; reason?: "needs-permission"}> {
  if(serverId!==PUBLIC_COMMUNITY_TARGET.communityId)throw Error("community-not-provisioned");
  if(!(await preparePermission()))return {accepted:false,reason:"needs-permission"};
  if(await publicCommunityMode(root)==="normal")return {accepted:true};
  await mkdir(root,{recursive:true,mode:0o700});if((await lstat(root)).isSymbolicLink())throw Error("configuration-required");
  const destination=join(root,"activation.json");
  try {
    const info=await lstat(destination);if(!info.isFile()||info.isSymbolicLink()||info.size>131072)throw Error("configuration-required");
    const prior=JSON.parse(await readFile(destination,"utf8"));
    if(!prior || !Array.isArray(prior.grantCommunities))throw Error("configuration-required");
    for(const community of prior.grantCommunities) {
      if(!community || typeof community.communityId!=="string")throw Error("configuration-required");
      const target=await readCommunityGrantTarget(root,community.communityId);
      if(community.communityId!==PUBLIC_COMMUNITY_TARGET.communityId) {
        // An existing community policy is never replaced by the public preset.
        throw Error("other-community-policy-preserved");
      }
      if(!isFixedPublicTarget(target))throw Error("configuration-required");
    }
  } catch(error) {if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const policy:CommunityGrantPolicy={schemaVersion:3,approved:true,credentialOperationsApproved:true,driverPermissionApproved:true,
    localManagementApproved:true,expiresAtUnixMs:null,grantCommunities:[PUBLIC_COMMUNITY_TARGET]};
  const temporary=join(root,randomUUID()+".approval.json"),handle=await open(temporary,"wx",0o600);
  try {await protectOwnedFile(temporary);await handle.writeFile(JSON.stringify(policy));await handle.sync();await handle.close();await rename(temporary,destination);}
  catch(error){await handle.close().catch(()=>{});await unlink(temporary).catch(()=>{});throw error;}
  return {accepted:true};
}
