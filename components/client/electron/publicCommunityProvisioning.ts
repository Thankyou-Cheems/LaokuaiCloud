import {randomUUID} from "node:crypto";
import {lstat, mkdir, open, readFile, rename, unlink} from "node:fs/promises";
import {join} from "node:path";

import {type BrowserWindow,dialog} from "electron";

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
export async function publicCommunityMode(root: string): Promise<"normal" | "needs-consent"> {
  try {await readCommunityGrantTarget(root, PUBLIC_COMMUNITY_TARGET.communityId);return "normal";} catch {return "needs-consent";}
}
/** Only a native user-confirmed dialog may create this machine's approval. */
export async function approvePublicCommunity(root: string, serverId: string, parent?: BrowserWindow,
  preparePermission: () => Promise<boolean> = hasEasyTierWindowsPermission): Promise<{accepted: boolean; reason?: "needs-permission"}> {
  if(serverId!==PUBLIC_COMMUNITY_TARGET.communityId)throw Error("community-not-provisioned");
  if(await publicCommunityMode(root)==="normal")return (await preparePermission()) ? {accepted:true} : {accepted:false,reason:"needs-permission"};
  const options={type:"question" as const,buttons:["同意并启用联机","取消"],defaultId:1,cancelId:1,
    message:"允许这台设备自动加入社区联机？",detail:"你已加入 voice.ruikang.wang。确认后会记住本机同意，以后恢复社区自动联机，无需再找开关。Windows 将为联机组件请求系统权限；聊天窗口保持普通权限，不安装后台服务。设备使用独立短期凭据，运行时创建自己的虚拟网卡和仅监听本机的管理端口。退出社区或应用时关闭自身实例。本程序不会修改防火墙。"};
  const answer=parent?await dialog.showMessageBox(parent,options):await dialog.showMessageBox(options);
  if(answer.response!==0)return {accepted:false};
  if(!(await preparePermission()))return {accepted:false,reason:"needs-permission"};
  await mkdir(root,{recursive:true,mode:0o700});if((await lstat(root)).isSymbolicLink())throw Error("configuration-required");
  const destination=join(root,"activation.json");
  try {
    const info=await lstat(destination);if(!info.isFile()||info.isSymbolicLink()||info.size>131072)throw Error("configuration-required");
    const prior=JSON.parse(await readFile(destination,"utf8"));
    if(!Array.isArray(prior.grantCommunities)||prior.grantCommunities.some((c:{communityId?:unknown;origin?:unknown})=>c.communityId!==PUBLIC_COMMUNITY_TARGET.communityId||c.origin!==PUBLIC_COMMUNITY_TARGET.origin))throw Error("other-community-policy-preserved");
  } catch(error) {if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const policy:CommunityGrantPolicy={schemaVersion:3,approved:true,credentialOperationsApproved:true,driverPermissionApproved:true,
    localManagementApproved:true,expiresAtUnixMs:null,grantCommunities:[PUBLIC_COMMUNITY_TARGET]};
  const temporary=join(root,randomUUID()+".approval.json"),handle=await open(temporary,"wx",0o600);
  try {await protectOwnedFile(temporary);await handle.writeFile(JSON.stringify(policy));await handle.sync();await handle.close();await rename(temporary,destination);}
  catch(error){await handle.close().catch(()=>{});await unlink(temporary).catch(()=>{});throw error;}
  return {accepted:true};
}
