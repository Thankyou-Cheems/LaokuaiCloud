import type {Socket} from "socket.io-client";

import {emitAuthenticated} from "./tokenManager";

const pending=new Map<string,Promise<void>>();
/** Resolve only a server-confirmed membership change, not restored audio or a sent request. */
export function requestVoiceMove(socket:Socket,host:string,target:{clientId:string;serverUserId:string;source:string},destination:string):Promise<void> {
  const key=JSON.stringify([host,socket.id,target.serverUserId]);const previous=pending.get(key);if(previous)return previous;
  const requestId=crypto.randomUUID();const generation=socket.id;
  const current=()=>socket.connected && socket.id===generation;
  let query:ReturnType<typeof setTimeout>;let timeout:ReturnType<typeof setTimeout>;
  const operation=new Promise<void>((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(query);clearTimeout(timeout);socket.off("voice:move:result",result);socket.off("disconnect",disconnected);};
    const disconnected=()=>{cleanup();reject(new Error("authority_invalidated"));};
    const result=(value:unknown)=>{
      if(!value || typeof value!=="object")return;
      const reply=value as Record<string,unknown>;if(reply.requestId!==requestId)return;
      if(!current()){disconnected();return;}
      if(reply.v!==1 || reply.generation!==target.clientId || reply.sourceChannelId!==target.source || reply.destinationChannelId!==destination){
        cleanup();reject(new Error("invalid_authority_reply"));return;
      }
      if(reply.invalidated===true){cleanup();reject(new Error("authority_invalidated"));return;}
      if(reply.status==="committed"){cleanup();resolve();}
      else if(reply.status==="aborted" || reply.status==="failed") {cleanup();reject(new Error(typeof reply.error==="string" ? reply.error : "move_failed"));}
    };
    socket.on("voice:move:result",result);socket.on("disconnect",disconnected);
    query=setTimeout(()=>{void emitAuthenticated(socket,"voice:move:query",{requestId},host,current).catch(()=>{});},18000);
    timeout=setTimeout(()=>{cleanup();reject(new Error("move_confirmation_unknown"));},45000);
    void emitAuthenticated(socket,"voice:move:user",{requestId,targetServerUserId:target.serverUserId,
      sourceChannelId:target.source,destinationChannelId:destination},host,current).then(sent=>{
      if(!sent){cleanup();reject(new Error("authority_send_failed"));}
    }).catch(()=>{cleanup();reject(new Error("authority_send_failed"));});
  });
  pending.set(key,operation);void operation.then(()=>pending.delete(key),()=>pending.delete(key));return operation;
}
