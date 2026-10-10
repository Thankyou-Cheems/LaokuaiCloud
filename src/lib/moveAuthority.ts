export interface MoveAuthorityReply {
  requestId:string;status:"committed"|"pending"|"aborted";generation:string;
  sourceChannelId:string;destinationChannelId:string;
}
interface SocketLike {
  id?:string;connected:boolean;
  on(event:string,listener:(value?:unknown)=>void):unknown;
  off(event:string,listener:(value?:unknown)=>void):unknown;
}
export interface MoveDestinationSettings {
  requirePTT:boolean;disableRNNoise:boolean;maxBitrate:number|null;eSportsMode:boolean;
  speak:boolean;shareVideo:boolean;shareScreen:boolean;isMuted:boolean;isDeafened:boolean;
}
export interface MoveSdkSettings {
  requirePushToTalk:boolean;disableRnnoise:boolean;maxBitrate:number|null;eSportsMode:boolean;
}
export function destinationSettings(value:unknown):MoveDestinationSettings|undefined {
  if(!value || typeof value!=="object")return;
  const row=value as Record<string,unknown>;
  for(const key of ["requirePTT","disableRNNoise","eSportsMode","speak","shareVideo","shareScreen","isMuted","isDeafened"])
    if(typeof row[key]!=="boolean")return;
  if(row.maxBitrate!==null && (typeof row.maxBitrate!=="number" || !Number.isFinite(row.maxBitrate) || row.maxBitrate<=0))return;
  return {requirePTT:row.requirePTT as boolean,disableRNNoise:row.disableRNNoise as boolean,maxBitrate:row.maxBitrate as number|null,
    eSportsMode:row.eSportsMode as boolean,speak:row.speak as boolean,shareVideo:row.shareVideo as boolean,shareScreen:row.shareScreen as boolean,
    isMuted:row.isMuted as boolean,isDeafened:row.isDeafened as boolean};
}
type AuthenticatedSend=(event:string,payload:Record<string,unknown>,current:()=>boolean)=>Promise<boolean>;
/** A fresh query is proof only on the same authenticated socket generation. No channel fields are fabricated. */
export function createMoveAuthority(socket:SocketLike,supported:boolean|(()=>boolean),send:AuthenticatedSend,
  policyApplied?:(requestId:string,settings:MoveDestinationSettings)=>boolean) {
  const generation=socket.id??"";let invalidated=false;
  const invalidationListeners=new Set<(reason:string)=>void>();
  const committedPolicies=new Map<string,MoveDestinationSettings>();
  const pending=new Map<string,{promise:Promise<MoveAuthorityReply>;reject:(error:Error)=>void;cleanup:()=>void}>();
  const current=()=>!invalidated && socket.connected && !!generation && socket.id===generation;
  const supports=()=>typeof supported==="function" ? supported()===true : supported;
  const invalidate=(reason="authority_invalidated")=>{
    if(invalidated)return;invalidated=true;
    for(const work of pending.values()){work.cleanup();work.reject(new Error("authority_invalidated"));}
    pending.clear();committedPolicies.clear();for(const listener of invalidationListeners)listener(reason);
  };
  const invalidationEvents=["disconnect","server:challenge","token:revoked","server:kicked","voice:device:disconnect","voice:kicked","voice:room:leave"];
  const eventListeners=invalidationEvents.map(event=>({event,listener:()=>invalidate(event)}));
  const left=(joined?:unknown)=>{if(joined===false)invalidate("voice:channel:joined=false");};
  for(const {event,listener} of eventListeners)socket.on(event,listener);
  socket.on("voice:channel:joined",left);
  return {
    generation,
    get valid(){return current();},
    get stagingSupported(){return current() && supports();},
    getDestinationPolicy(requestId:string):MoveDestinationSettings|undefined {
      const policy=current() ? committedPolicies.get(requestId) : undefined;
      return policy ? {...policy} : undefined;
    },
    confirmCommit(requestId:string):Promise<MoveAuthorityReply> {
      if(!current())return Promise.reject(new Error("authority_invalidated"));
      if(!supports())return Promise.reject(new Error("staging_unsupported"));
      if(!requestId || requestId.length>128)return Promise.reject(new Error("invalid_request_id"));
      const previous=pending.get(requestId);if(previous)return previous.promise;
      let reject!:(error:Error)=>void;let timer:ReturnType<typeof setTimeout>;
      let callback!:(value?:unknown)=>void;
      const cleanup=()=>{clearTimeout(timer);socket.off("voice:move:result",callback);pending.delete(requestId);};
      const promise=new Promise<MoveAuthorityReply>((resolve,fail)=>{
        reject=fail;
        callback=(value)=>{
          if(!value || typeof value!=="object")return;
          const row=value as Record<string,unknown>;if(row.requestId!==requestId)return;
          if(!current()){cleanup();fail(new Error("authority_invalidated"));return;}
          if(row.v!==1 || row.generation!==generation || typeof row.sourceChannelId!=="string" || !row.sourceChannelId || row.sourceChannelId.length>128 ||
            typeof row.destinationChannelId!=="string" || !row.destinationChannelId || row.destinationChannelId.length>128 ||
            !["committed","aborted","pending","preparing","prepared"].includes(row.status as string)) {
            cleanup();fail(new Error("invalid_authority_reply"));return;
          }
          if(row.invalidated===true){cleanup();invalidate("move_invalidated");fail(new Error("authority_invalidated"));return;}
          const policy=destinationSettings(row.channelSettings);
          if(row.status==="committed" && policy) {
            committedPolicies.set(requestId,policy);
            if(committedPolicies.size>32)committedPolicies.delete(committedPolicies.keys().next().value!);
          } else committedPolicies.delete(requestId);
          cleanup();resolve({requestId,generation:row.generation,sourceChannelId:row.sourceChannelId,destinationChannelId:row.destinationChannelId,
            status:row.status==="committed" ? "committed" : row.status==="aborted" ? "aborted" : "pending"});
        };
        socket.on("voice:move:result",callback);
        timer=setTimeout(()=>{cleanup();fail(new Error("authority_query_timeout"));},8000);
      });
      pending.set(requestId,{promise,reject,cleanup});
      void send("voice:move:query",{requestId},current).then(sent=>{
        if(!sent && pending.has(requestId)){cleanup();reject(new Error("authority_send_failed"));}
      }).catch(()=>{if(pending.has(requestId)){cleanup();reject(new Error("authority_send_failed"));}});
      return promise;
    },
    isDestinationPolicyApplied(requestId:string,settings:MoveSdkSettings):boolean {
      if(!current() || !supports() || !policyApplied)return false;
      const policy=committedPolicies.get(requestId);
      if(!policy || settings.requirePushToTalk!==policy.requirePTT || settings.disableRnnoise!==policy.disableRNNoise ||
        settings.maxBitrate!==policy.maxBitrate || settings.eSportsMode!==policy.eSportsMode)return false;
      try{return policyApplied(requestId,{...policy})===true;}catch{return false;}
    },
    onInvalidated(listener:(reason:string)=>void):()=>void {
      if(!current()){listener("authority_invalidated");return()=>{};}
      invalidationListeners.add(listener);return()=>{invalidationListeners.delete(listener);};
    },
    invalidate,
    dispose(){invalidate();invalidationListeners.clear();for(const {event,listener} of eventListeners)socket.off(event,listener);socket.off("voice:channel:joined",left);},
  };
}
