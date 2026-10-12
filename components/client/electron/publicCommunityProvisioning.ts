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
export async function approvePublicCommunity(root: string, serverId: string, parent?: BrowserWindow): Promise<{accepted: boolean; reason?: "needs-permission"}> {
  if(serverId!==PUBLIC_COMMUNITY_TARGET.communityId)throw Error("community-not-provisioned");
  if(!(await hasEasyTierWindowsPermission())) {
    const options={type: "info" as const, message: "联机需要管理员权限", detail: "请关闭应用，再以同一 Windows 用户的管理员权限启动唠蒯云。语音聊天可在普通权限下使用。"};
    if(parent)await dialog.showMessageBox(parent,options);else await dialog.showMessageBox(options);
    return {accepted:false,reason:"needs-permission"};
  }
  if(await publicCommunityMode(root)==="normal")return {accepted:true};
  const options={type:"question" as const,buttons:["同意并启用联机","取消"],defaultId:1,cancelId:1,
    message:"启用 voice.ruikang.wang 社区联机？",detail:"本程序将创建自己的虚拟网卡，并连接该社区的公共节点。社区密码只用于取得普通成员资格；每台设备生成独立身份。运行期间会开启仅监听 127.0.0.1 的管理连接，其他本机程序也可访问该端口。关闭联机或退出应用时关闭自身实例并清理凭据。本程序不会修改防火墙。"};
  const answer=parent?await dialog.showMessageBox(parent,options):await dialog.showMessageBox(options);
  if(answer.response!==0)return {accepted:false};
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
