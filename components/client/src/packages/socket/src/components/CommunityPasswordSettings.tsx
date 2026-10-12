import {Button, TextField} from "@gryt/ui";
import {useEffect, useState} from "react";
import toast from "react-hot-toast";

type SocketPort={connected:boolean;emit(event:string,data?:unknown):void;on(event:string,listener:(value:unknown)=>void):void;off(event:string,listener:(value:unknown)=>void):void};
/** Manual owner input only. Never reads, prefills, copies or logs a password. */
export function CommunityPasswordSettings({host,socket,accessToken,canEdit}:{host:string;socket?:SocketPort;accessToken:string|null;canEdit:boolean}) {
  const [password,setPassword]=useState(""),[confirmation,setConfirmation]=useState("");
  useEffect(()=>{setPassword("");setConfirmation("");},[host]);
  useEffect(()=>{
    if(!socket)return;
    const updated=()=>{toast.success("共享密码已保存，非成员须通过密码验证。已有成员与管理员身份保留。");socket.emit("server:settings:get");};
    socket.on("server:password:updated",updated);return()=>socket.off("server:password:updated",updated);
  },[socket]);
  const save=()=>{
    if(!canEdit||!socket?.connected||!accessToken||!password||password!==confirmation||password.length>128)return;
    socket.emit("server:password:set",{accessToken,password});setPassword("");setConfirmation("");
  };
  return <div className="flex flex-col gap-2">
    <strong>社区共享密码 · {host}</strong>
    <p className="text-sm text-gryt-muted">请在本机手动设置。密码区分大小写，不作为邀请码、链接或管理员授权使用；新成员通过后可独立加入社区联机。</p>
    <TextField type="password" autoComplete="new-password" aria-label="新社区共享密码" value={password} disabled={!canEdit} onChange={e=>setPassword(e.target.value)} maxLength={128}/>
    <TextField type="password" autoComplete="new-password" aria-label="确认社区共享密码" value={confirmation} disabled={!canEdit} onChange={e=>setConfirmation(e.target.value)} maxLength={128}/>
    <Button size="small" onClick={save} disabled={!canEdit||!socket?.connected||!accessToken||!password||password!==confirmation}>保存密码并启用密码准入</Button>
  </div>;
}
