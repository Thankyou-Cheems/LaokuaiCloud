import {useMicrophone,useSFU} from "@gryt/voice";
import {useEffect,useRef} from "react";
import toast from "react-hot-toast";

import {i18n} from "@/i18n";
import {useSockets} from "@/socket";

import {createMoveAuthority} from "../../../../lib/moveAuthority";
import type {MovePolicyBinding} from "../../../../lib/movePolicy";
import {readMovePrepare} from "../../../../lib/movePrepare";
import {emitAuthenticated} from "../../../socket/src/utils/tokenManager";

export type ClientMoveAuthority=ReturnType<typeof createMoveAuthority>;
export function useVoiceMoves(authorities:Record<string,ClientMoveAuthority>,applyPolicy:(binding:MovePolicyBinding|undefined)=>void) {
  const sfu=useSFU();const {transmissionState}=useMicrophone(false);const {sockets}=useSockets();
  const {currentServerConnected:host}=sfu;const socket=sockets[host];const authority=authorities[host];
  const supported=authority?.stagingSupported===true;
  const latest=useRef({sfu,transmissionState});latest.current={sfu,transmissionState};
  useEffect(()=>{
    if(!socket || !authority || !supported || !sfu.prepareMove || !sfu.commitMove ||
      !sfu.abortMove || !sfu.resumeMoveTransmission)return;
    let disposed=false;
    type Request=NonNullable<ReturnType<typeof readMovePrepare>>;
    const records=new Map<string,{request:Request;ready:Promise<unknown>;commit?:Promise<void>;revision:number}>();
    const current=()=>!disposed && socket.connected && socket.id===authority.generation && authority.stagingSupported;
    const send=(event:string,payload:Record<string,unknown>)=>emitAuthenticated(socket,event,payload,host,current);
    const report=()=>{if(current())toast.error(i18n.t("pureVoice.moveFailed"),{id:"voice-move"});};
    const prepare=(value:unknown)=>{
      const state=latest.current;
      const request=readMovePrepare(value,authority.generation,state.sfu.currentChannelConnected);
      if(!request || !current() || state.sfu.currentServerConnected!==host || records.has(request.requestId))return;
      const revision=state.transmissionState.publicationRevision;
      if(!Number.isSafeInteger(revision)){report();return;}
      const ready=(async()=>{
        const prepared=await latest.current.sfu.prepareMove!(request);
        if(!current() || prepared.requestId!==request.requestId || !prepared.streamId)throw new Error("stale_move_prepare");
        if(!await send("voice:move:ready",{requestId:prepared.requestId,streamId:prepared.streamId}))throw new Error("authority_send_failed");
      })();
      records.set(request.requestId,{request,ready,revision:revision!});
      if(records.size>16)records.delete(records.keys().next().value!);
      void ready.catch(()=>{
        if(current())void send("voice:move:abort",{requestId:request.requestId}).catch(()=>{});
        report();
      });
    };
    const result=(value:unknown)=>{
      if(!value || typeof value!=="object" || !current())return;
      const row=value as Record<string,unknown>;
      if(typeof row.requestId!=="string")return;
      const record=records.get(row.requestId);if(!record)return;
      if(row.v!==1 || row.generation!==authority.generation || row.sourceChannelId!==record.request.sourceChannelId ||
        row.destinationChannelId!==record.request.destinationChannelId)return;
      if(row.invalidated===true){authority.invalidate("move_invalidated");return;}
      if(row.status==="aborted" || row.status==="failed") {
        void latest.current.sfu.abortMove!(row.requestId).catch(report);return;
      }
      if(row.status!=="committed" || record.commit)return;
      record.commit=(async()=>{
        await record.ready;if(!current())return;
        await latest.current.sfu.commitMove!(record.request.requestId);
        if(!current())return;
        // Never use the event's controls as authority. commitMove has queried the same generation.
        const confirmation=await authority.confirmCommit(record.request.requestId);
        if(!current() || confirmation.status!=="committed" || confirmation.sourceChannelId!==record.request.sourceChannelId ||
          confirmation.destinationChannelId!==record.request.destinationChannelId)throw new Error("stale_move_confirmation");
        const policy=authority.getDestinationPolicy(record.request.requestId);if(!policy)throw new Error("missing_destination_policy");
        applyPolicy({host,generation:authority.generation,requestId:record.request.requestId,
          destinationChannelId:record.request.destinationChannelId,policy,beforePromotionRevision:record.revision});
        const until=Date.now()+8000;
        while(current() && Date.now()<until) {
          if(authority.isDestinationPolicyApplied(record.request.requestId,record.request.channelSettings)) {
            await latest.current.sfu.resumeMoveTransmission!(record.request.requestId);
            if(current())applyPolicy(undefined);
            return;
          }
          await new Promise(resolve=>setTimeout(resolve,25));
        }
        throw new Error("destination_policy_not_acknowledged");
      })();
      void record.commit.catch(report);
    };
    socket.on("voice:move:prepare",prepare);socket.on("voice:move:result",result);
    // Advertise only with the real installed methods, bound authority and live server/SFU probe.
    void send("voice:move:client",{v:1,staging:true}).catch(()=>{});
    const unsubscribe=authority.onInvalidated(()=>{disposed=true;applyPolicy(undefined);});
    return()=>{
      disposed=true;unsubscribe();socket.off("voice:move:prepare",prepare);socket.off("voice:move:result",result);
      // The SDK owns pending transport disposal on authority invalidation/call changes.
      records.clear();
    };
  },[host,socket,authority,supported,sfu.prepareMove,sfu.commitMove,sfu.abortMove,sfu.resumeMoveTransmission,applyPolicy]);
}
