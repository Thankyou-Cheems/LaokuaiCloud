import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it, mock } from "node:test";
import { initSqlite } from "../../db/sqlite/connection";
import { upsertServerChannel } from "../../db/sqlite/channels";
import { createServerConfigIfNotExists, setServerRole } from "../../db/sqlite/servers";
import { upsertUser } from "../../db/sqlite/users";
import { generateAccessToken } from "../../utils/jwt";
import type { Clients } from "../../types";
import type { HandlerContext } from "./types";
import { registerVoiceMoveHandlers } from "./voiceMove";
import type { SfuMoveCommand, SfuMovePhase, SfuMoveResult } from "../../sfu/moveProtocol";
import { createPermissionScope, replacePermissionRules, setChannelPermissionScope } from "../../db/sqlite/channelScopes";
import { resetChannelPermissionCache } from "../../services/channelPermissions";
import { reconcileVoiceMoves } from "../utils/voiceMoveLifecycle";
import * as channelPermissions from "../../services/channelPermissions";

const HOST="move.synthetic.test:5001";
let seq=0;
before(async()=>{
 process.env.DATA_DIR=mkdtempSync(join(tmpdir(),"gryt-move-test-"));
 await initSqlite();
 await createServerConfigIfNotExists();
 for(const id of ["source","destination"]) await upsertServerChannel({channelId:id,name:id,type:"voice",position:10});
});
async function fixture(actorRole="admin",targetRole="member",staging=true) {
 const clients:Clients={};const sockets=new Map();const deliveries:{id:string;event:string;data:unknown}[]=[];
 const io={sockets:{sockets},emit(){},to(){return {emit(){}}}};
 const active=new Map<string,{roomId:string;userId:string;connectedAt:number}>();
 let sfuStatus:SfuMoveResult["status"]="prepared";
 let loseCommitAck=false;let commitCount=0;let prepareCount=0;
 let supported=true;let loseRefreshAck=false;
 let onCommit: (()=>void|Promise<void>)|undefined;let removed=false;let refreshCount=0;let refreshed:SfuMoveCommand|undefined;
 const sfu={isConnected:()=>true,registerRoom:async()=>{},getActiveUsers:()=>active,getTrackedUser:(u:string)=>active.get(u),
 generateClientJoinToken:(room:string,user:string)=>({room_id:room,user_id:user,user_token:"synthetic",server_id:"server"}),
 requestMove:async(phase:SfuMovePhase,r:SfuMoveCommand)=>{
  if(phase==="probe") return {request_id:r.request_id,status:supported ? "supported" : "failed"};
  if(phase==="prepare") prepareCount++;
  if(phase==="abort"&&sfuStatus!=="committed") sfuStatus="aborted";
  if(phase==="commit") { commitCount++;sfuStatus="committed";await onCommit?.();if(loseCommitAck) throw new Error("synthetic lost ack"); }
  if(phase==="refresh") { refreshCount++;refreshed={...r,capabilities:[...r.capabilities]};if(loseRefreshAck) throw new Error("synthetic unknown refresh ack"); }
  if(phase==="remove") { if(sfuStatus==="committed") removed=true;else sfuStatus="aborted"; }
  return {request_id:r.request_id,status:sfuStatus,removed,user_id:r.user_id,source_room_id:r.source_room_id,destination_room_id:r.destination_room_id};
 },untrackUserConnection:(u:string)=>active.delete(u),trackUserConnection:(roomId:string,userId:string)=>{active.set(userId,{roomId,userId,connectedAt:Date.now()});return true}};
 async function member(role:string){
  const id=`socket-${++seq}`;const gryt=`synthetic-${seq}`;const user=await upsertUser(gryt,id);await setServerRole(user.server_user_id,role);
  const accessToken=generateAccessToken({grytUserId:gryt,serverUserId:user.server_user_id,nickname:id,serverHost:HOST,tokenVersion:0});
  const rooms=new Set([id,"voice:server:source"]);
  const once=new Map<string,()=>void>();
  const socket={id,connected:true,rooms,handshake:{headers:{host:HOST}},once(event:string,run:()=>void){once.set(event,run)},emit(event:string,data:unknown){deliveries.push({id,event,data});return true},join:(r:string)=>rooms.add(r),leave:(r:string)=>rooms.delete(r),to(){return {emit(){}}}};
  clients[id]={serverUserId:user.server_user_id,grytUserId:gryt,accessToken,nickname:id,hasJoinedChannel:true,voiceChannelId:"source",streamID:"old-stream",isConnectedToVoice:true,isMuted:false,isDeafened:false,isServerMuted:false,isServerDeafened:false,cameraEnabled:false,screenShareEnabled:false} as Clients[string];sockets.set(id,socket);
  active.set(user.server_user_id,{roomId:"server_source",userId:user.server_user_id,connectedAt:Date.now()});
  const handlers=registerVoiceMoveHandlers({io,socket,clientId:id,serverId:"server",clientsInfo:clients,sfuClient:sfu,getClientIp:()=>"127.0.0.1",clientAddressIsOwn:()=>true} as unknown as HandlerContext,{enabled:true});
  const call=async(event:string,payload:object,token=accessToken)=>{let result:unknown;await handlers[event]({...payload,accessToken:token},(v:unknown)=>{result=v});return result as {status:string;error?:string;generation?:string;sourceChannelId?:string;destinationChannelId?:string;channelSettings?:{speak:boolean;isMuted:boolean;isDeafened:boolean}}};
  return {id,userId:user.server_user_id,accessToken,call,rooms,socket,disconnect(){socket.connected=false;once.get("disconnect")?.()}};
 }
 const actor=await member(actorRole),target=await member(targetRole);
 if(staging) await target.call("voice:move:client",{v:1,staging:true});
 return {actor,target,clients,deliveries,active,sockets,setReady(){sfuStatus="ready"},unsupportedSFU(){supported=false},loseCommitAck(){loseCommitAck=true},loseRefreshAck(value=true){loseRefreshAck=value},onCommit(run:()=>void|Promise<void>){onCommit=run},reconcile(){reconcileVoiceMoves(io as unknown as HandlerContext["io"])},removed(){return removed},refreshed(){return refreshed},counts(){return {commitCount,prepareCount,refreshCount}},status(){return sfuStatus}};
}
describe("authenticated atomic voice moves",()=>{
 it("rechecks target authentication on actor recovery query after committed history",async()=>{
  const f=await fixture(),requestId=randomUUID();
  await f.actor.call("voice:move:user",{requestId,targetServerUserId:f.target.userId,sourceChannelId:"source",destinationChannelId:"destination"});f.setReady();
  assert.equal((await f.target.call("voice:move:ready",{requestId,streamId:"new"})).status,"committed");
  f.clients[f.target.id].accessToken="invalid-synthetic-session-token";
  const authority=await f.actor.call("voice:move:query",{requestId}) as {status:string;invalidated?:boolean};
  assert.equal(authority.status,"committed");assert.equal(authority.invalidated,true);assert.equal(f.removed(),true);
 });
 it("refreshes committed recovery queries and invalidates a later leave without rebinding",async()=>{
  const f=await fixture(),requestId=randomUUID(),scope=await createPermissionScope({});
  await setChannelPermissionScope("destination",scope);resetChannelPermissionCache();
  try {
   await f.actor.call("voice:move:user",{requestId,targetServerUserId:f.target.userId,sourceChannelId:"source",destinationChannelId:"destination"});f.setReady();
   assert.equal((await f.target.call("voice:move:ready",{requestId,streamId:"new"})).status,"committed");
   f.clients[f.target.id].isServerMuted=true;f.clients[f.target.id].isServerDeafened=true;
   await replacePermissionRules(scope,[{roleId:"member",permission:"speak",effect:"deny"}]);resetChannelPermissionCache();
   const authority=await f.target.call("voice:move:query",{requestId});
   assert.equal(authority.status,"committed");assert.equal(authority.channelSettings?.speak,false);assert.equal(authority.channelSettings?.isMuted,true);assert.equal(authority.channelSettings?.isDeafened,true);
   f.clients[f.target.id].hasJoinedChannel=false;
   const invalid=await f.target.call("voice:move:query",{requestId}) as {status:string;invalidated?:boolean};
   assert.equal(invalid.status,"committed");assert.equal(invalid.invalidated,true);assert.equal(f.removed(),true);
   assert.equal(f.deliveries.filter(d=>d.event==="voice:move:committed").length,1);
  } finally {await setChannelPermissionScope("destination",null);resetChannelPermissionCache();}
 });
 it("keeps unknown refresh ACK pending and resolves with a later authority query",async()=>{
  const f=await fixture(),requestId=randomUUID();
  await f.actor.call("voice:move:user",{requestId,targetServerUserId:f.target.userId,sourceChannelId:"source",destinationChannelId:"destination"});f.setReady();f.loseRefreshAck();
  assert.equal((await f.target.call("voice:move:ready",{requestId,streamId:"new"})).status,"pending");
  assert.equal(f.deliveries.some(d=>d.event==="voice:move:committed"),false);assert.equal(f.status(),"committed");
  f.loseRefreshAck(false);assert.equal((await f.target.call("voice:move:query",{requestId})).status,"committed");assert.equal(f.counts().commitCount,1);
 });
 it("refreshes destination grants and latest moderation changed while the commit ACK travelled",async()=>{
  const f=await fixture(),requestId=randomUUID(),scope=await createPermissionScope({});
  await setChannelPermissionScope("destination",scope);resetChannelPermissionCache();
  try {
   await f.actor.call("voice:move:user",{requestId,targetServerUserId:f.target.userId,sourceChannelId:"source",destinationChannelId:"destination"});f.setReady();
   f.onCommit(async()=>{f.clients[f.target.id].isServerMuted=true;f.clients[f.target.id].isDeafened=true;
    await replacePermissionRules(scope,[{roleId:"member",permission:"speak",effect:"deny"},{roleId:"member",permission:"share_video",effect:"deny"}]);resetChannelPermissionCache();f.reconcile();});
   const result=await f.target.call("voice:move:ready",{requestId,streamId:"new"});
   assert.equal(result.status,"committed");assert.equal(result.channelSettings?.speak,false);assert.equal(result.channelSettings?.isMuted,true);assert.equal(result.channelSettings?.isDeafened,true);
   assert.equal(f.refreshed()?.capabilities.includes("speak"),false);assert.equal(f.refreshed()?.capabilities.includes("share_video"),false);assert.equal(f.refreshed()?.is_deafened,true);assert.equal(f.counts().refreshCount,1);
  } finally {await setChannelPermissionScope("destination",null);resetChannelPermissionCache();}
 });
 it("fences a destination setting write during final permission reads",async()=>{
  const f=await fixture(),requestId=randomUUID();
  await f.actor.call("voice:move:user",{requestId,targetServerUserId:f.target.userId,sourceChannelId:"source",destinationChannelId:"destination"});f.setReady();
  const original=channelPermissions.mayInChannel;let changed=false;
  const patch=mock.method(channelPermissions,"mayInChannel",async (...args:Parameters<typeof original>)=>{
   const decision=await original(...args);
   if(args[2]==="speak"&&!changed){changed=true;await upsertServerChannel({channelId:"destination",name:"destination",type:"voice",requirePushToTalk:true})}
   return decision;
  });
  try {assert.equal((await f.target.call("voice:move:ready",{requestId,streamId:"new"})).status,"aborted");assert.equal(changed,true);assert.equal(f.counts().commitCount,0);}
  finally {patch.mock.restore();await upsertServerChannel({channelId:"destination",name:"destination",type:"voice",requirePushToTalk:false});}
 });
 it("removes precisely the committed transaction when a removal clears the roster during ACK",async()=>{
  const f=await fixture(),requestId=randomUUID();
  await f.actor.call("voice:move:user",{requestId,targetServerUserId:f.target.userId,sourceChannelId:"source",destinationChannelId:"destination"});f.setReady();
  f.onCommit(()=>{f.clients[f.target.id].hasJoinedChannel=false;f.clients[f.target.id].voiceChannelId="";f.reconcile()});
  const result=await f.target.call("voice:move:ready",{requestId,streamId:"new"});
  assert.equal(result.status,"committed");assert.equal(f.removed(),true);
  assert.equal(f.clients[f.target.id].hasJoinedChannel,false);assert.equal(f.clients[f.target.id].voiceChannelId,"");
  assert.equal(f.deliveries.some(d=>d.event==="voice:move:committed"),false);
 });
 it("rejects cached replay after the same socket context changes authenticated identity",async()=>{
  const f=await fixture(),requestId=randomUUID(),payload={requestId,targetServerUserId:f.target.userId,sourceChannelId:"source",destinationChannelId:"destination"};
  await f.actor.call("voice:move:user",payload);
  const replacement=await fixture();Object.assign(f.clients[f.actor.id],replacement.clients[replacement.actor.id]);
  assert.equal((await f.actor.call("voice:move:user",payload,replacement.actor.accessToken)).error,"request_conflict");
 });
 it("aborts prepared media when an authoritative leave invalidates the source",async()=>{
  const f=await fixture(),requestId=randomUUID();
  await f.actor.call("voice:move:user",{requestId,targetServerUserId:f.target.userId,sourceChannelId:"source",destinationChannelId:"destination"});
  f.clients[f.target.id].hasJoinedChannel=false;f.reconcile();
  assert.equal((await f.actor.call("voice:move:query",{requestId})).status,"aborted");assert.equal(f.counts().commitCount,0);
 });
 it("keeps source roster until SFU confirms commit and deduplicates retry",async()=>{
  const f=await fixture();const requestId=randomUUID();const payload={requestId,targetServerUserId:f.target.userId,sourceChannelId:"source",destinationChannelId:"destination"};
  const prepared=await f.actor.call("voice:move:user",payload);
  assert.equal(prepared.status,"prepared");assert.equal(f.clients[f.target.id].voiceChannelId,"source");assert.equal(f.clients[f.target.id].hasJoinedChannel,true);
  f.setReady();const committed=await f.target.call("voice:move:ready",{requestId,streamId:"new-stream"});
  assert.equal(committed.status,"committed");assert.equal(f.clients[f.target.id].voiceChannelId,"destination");assert.equal(f.clients[f.target.id].streamID,"new-stream");
  assert.equal((await f.actor.call("voice:move:user",payload)).status,"committed");
  const authority=await f.target.call("voice:move:query",{requestId});
  assert.equal(authority.generation,f.target.id);assert.equal(authority.sourceChannelId,"source");assert.equal(authority.destinationChannelId,"destination");
  assert.equal(f.deliveries.filter(x=>x.event==="voice:move:committed").length,1);
  assert.equal(f.deliveries.some(x=>x.event==="voice:kicked"||x.event==="voice:room:leave"),false);
 });
 it("refuses member actors and equal/higher targets without preparing media",async()=>{
  for(const roles of [["member","member"],["admin","admin"],["admin","owner"]]) {
   const f=await fixture(...roles);const result=await f.actor.call("voice:move:user",{requestId:randomUUID(),targetServerUserId:f.target.userId,sourceChannelId:"source",destinationChannelId:"destination"});
   assert.equal(result.status,"failed");assert.equal(f.counts().prepareCount,0);assert.equal(f.clients[f.target.id].voiceChannelId,"source");
  }
 });
 it("refuses target destination visibility/join denial and non-voice destinations",async()=>{
  const f=await fixture();const scope=await createPermissionScope({});
  await setChannelPermissionScope("destination",scope);
  try {
   for(const permission of ["read_messages","join_voice"]) {
    await replacePermissionRules(scope,[{roleId:"member",permission,effect:"deny"}]);resetChannelPermissionCache();
    const r=await f.actor.call("voice:move:user",{requestId:randomUUID(),targetServerUserId:f.target.userId,sourceChannelId:"source",destinationChannelId:"destination"});
    assert.equal(r.status,"failed");assert.equal(f.counts().prepareCount,0);
   }
  } finally {await setChannelPermissionScope("destination",null);resetChannelPermissionCache();}
  await upsertServerChannel({channelId:"text-only",name:"Text",type:"text"});
  assert.equal((await f.actor.call("voice:move:user",{requestId:randomUUID(),targetServerUserId:f.target.userId,sourceChannelId:"source",destinationChannelId:"text-only"})).status,"failed");
 });
 it("rechecks actor permission immediately before commit and keeps source on abort",async()=>{
  const f=await fixture(),requestId=randomUUID();
  await f.actor.call("voice:move:user",{requestId,targetServerUserId:f.target.userId,sourceChannelId:"source",destinationChannelId:"destination"});
  await setServerRole(f.actor.userId,"member");f.setReady();
  assert.equal((await f.target.call("voice:move:ready",{requestId,streamId:"staged"})).status,"aborted");
  assert.equal(f.clients[f.target.id].voiceChannelId,"source");assert.equal(f.counts().commitCount,0);
 });
 it("resolves a lost commit ack through query and never reports a false failure",async()=>{
  const f=await fixture(),requestId=randomUUID();
  await f.actor.call("voice:move:user",{requestId,targetServerUserId:f.target.userId,sourceChannelId:"source",destinationChannelId:"destination"});
  f.setReady();f.loseCommitAck();
  assert.equal((await f.target.call("voice:move:ready",{requestId,streamId:"staged"})).status,"committed");
  assert.equal((await f.actor.call("voice:move:query",{requestId})).status,"committed");
  assert.equal(f.counts().commitCount,1);assert.equal(f.deliveries.filter(d=>d.event==="voice:move:committed").length,1);
 });
 it("does not trust client-ready and serializes duplicate concurrent requests",async()=>{
  const f=await fixture(),requestId=randomUUID(),payload={requestId,targetServerUserId:f.target.userId,sourceChannelId:"source",destinationChannelId:"destination"};
  const results=await Promise.all([f.actor.call("voice:move:user",payload),f.actor.call("voice:move:user",payload)]);
  assert.equal(results.every(r=>r.status==="prepared"),true);assert.equal(f.counts().prepareCount,1);
  assert.equal((await f.target.call("voice:move:ready",{requestId,streamId:"staged"})).status,"prepared");
  assert.equal(f.counts().commitCount,0);assert.equal(f.clients[f.target.id].voiceChannelId,"source");
  assert.equal((await f.actor.call("voice:move:abort",{requestId})).status,"aborted");
 });
 it("rejects old target and actor generations, and aborts actor disconnect before commit",async()=>{
  const f=await fixture(),requestId=randomUUID();
  await f.actor.call("voice:move:user",{requestId,targetServerUserId:f.target.userId,sourceChannelId:"source",destinationChannelId:"destination"});
  f.setReady();f.actor.disconnect();
  assert.equal((await f.target.call("voice:move:ready",{requestId,streamId:"staged"})).status,"aborted");
  assert.equal(f.counts().commitCount,0);assert.equal(f.clients[f.target.id].voiceChannelId,"source");
  const g=await fixture(),id=randomUUID();
  await g.actor.call("voice:move:user",{requestId:id,targetServerUserId:g.target.userId,sourceChannelId:"source",destinationChannelId:"destination"});
  g.clients[g.target.id]={...g.clients[g.target.id]};g.setReady();
  assert.equal((await g.target.call("voice:move:ready",{requestId:id,streamId:"staged"})).status,"failed");
  assert.equal(g.counts().commitCount,0);await g.actor.call("voice:move:abort",{requestId:id});
 });
 it("reuses an existing seat at the configured limit",async()=>{
  const previous=process.env.VOICE_MAX_USERS;process.env.VOICE_MAX_USERS="2";
  try {const f=await fixture();const r=await f.actor.call("voice:move:user",{requestId:randomUUID(),targetServerUserId:f.target.userId,sourceChannelId:"source",destinationChannelId:"destination"});assert.equal(r.status,"prepared");}
  finally {if(previous===undefined) delete process.env.VOICE_MAX_USERS;else process.env.VOICE_MAX_USERS=previous;}
 });
 it("requires token/context identity, SDK staging, SFU support and actual source seat",async()=>{
  const f=await fixture();const payload={requestId:randomUUID(),targetServerUserId:f.target.userId,sourceChannelId:"source",destinationChannelId:"destination"};
  assert.equal((await f.actor.call("voice:move:user",payload,f.target.accessToken)).error,"unauthenticated_connection");
  f.active.delete(f.target.userId);assert.equal((await f.actor.call("voice:move:user",payload)).error,"seat_or_source_changed");
  const old=await fixture("admin","member",false);
  assert.equal((await old.actor.call("voice:move:user",{...payload,targetServerUserId:old.target.userId})).error,"unsupported_sdk");
  const legacy=await fixture();legacy.unsupportedSFU();
  assert.equal((await legacy.actor.call("voice:move:user",{...payload,targetServerUserId:legacy.target.userId})).error,"unsupported_sfu");
  assert.equal(legacy.counts().prepareCount,0);assert.equal(legacy.clients[legacy.target.id].voiceChannelId,"source");
 });
 it("retains mute/deafen in authority result and aborts changed staged PTT settings",async()=>{
  const f=await fixture(),requestId=randomUUID();f.clients[f.target.id].isMuted=true;f.clients[f.target.id].isServerDeafened=true;
  await f.actor.call("voice:move:user",{requestId,targetServerUserId:f.target.userId,sourceChannelId:"source",destinationChannelId:"destination"});f.setReady();
  const result=await f.target.call("voice:move:ready",{requestId,streamId:"new"});
  assert.equal(result.status,"committed");assert.equal(result.channelSettings?.isMuted,true);assert.equal(result.channelSettings?.isDeafened,true);
  const g=await fixture(),id=randomUUID();
  await g.actor.call("voice:move:user",{requestId:id,targetServerUserId:g.target.userId,sourceChannelId:"source",destinationChannelId:"destination"});g.setReady();
  await upsertServerChannel({channelId:"destination",name:"destination",type:"voice",requirePushToTalk:true});
  try {assert.equal((await g.target.call("voice:move:ready",{requestId:id,streamId:"new"})).status,"aborted");assert.equal(g.counts().commitCount,0);assert.equal(g.clients[g.target.id].voiceChannelId,"source");}
  finally {await upsertServerChannel({channelId:"destination",name:"destination",type:"voice",requirePushToTalk:false});}
 });
});
