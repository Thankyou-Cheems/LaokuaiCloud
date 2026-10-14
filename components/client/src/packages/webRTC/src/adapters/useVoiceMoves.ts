import {createElement,useEffect,useRef,useState} from "react";
import toast from "react-hot-toast";

import {useUserId} from "@/common";
import {i18n} from "@/i18n";
import {useSockets} from "@/socket";

import {createMoveAuthority} from "../../../../lib/moveAuthority";
import type {MovePolicyBinding} from "../../../../lib/movePolicy";
import {readMovePrepare} from "../../../../lib/movePrepare";
import { useMicrophone, useSFU } from "../../../../lib/voiceFacade";
import {emitAuthenticated} from "../../../socket/src/utils/tokenManager";
import {VoiceMoveRecoveryNotice} from "../components/VoiceMoveRecoveryNotice";

export type ClientMoveAuthority=ReturnType<typeof createMoveAuthority>;
export function useVoiceMoves(authorities:Record<string,ClientMoveAuthority>,applyPolicy:(binding:MovePolicyBinding|undefined)=>void) {
  const userId=useUserId();
  const sfu=useSFU();const {transmissionState}=useMicrophone(false);const {sockets}=useSockets();
  const {currentServerConnected:host}=sfu;const socket=sockets[host];const authority=authorities[host];
  const supported=authority?.stagingSupported===true;
  const latest=useRef({sfu,transmissionState});latest.current={sfu,transmissionState};
  const recovery=useRef<{host:string;channel:string;generation:string;requestId:string;mode:"reconnect"|"resume"}|undefined>(undefined);
  const [retryRequest,setRetryRequest]=useState<{requestId:string;attempt:number}>();
  const completed=useRef<{host:string;channel:string;source:string;generation:string;requestId:string;
    revision:number;resumeRequired:boolean;promoted:boolean;settings:NonNullable<ReturnType<typeof readMovePrepare>>["channelSettings"]}|undefined>(undefined);
  const retryNotice=(current:()=>boolean,retryPromotion?:()=>void)=>{
    const transaction=completed.current;if(!current() || !transaction)return;
    recovery.current=undefined;
    toast.error(createElement(VoiceMoveRecoveryNotice,{
      phase:!transaction.promoted && latest.current.sfu.currentChannelConnected===transaction.source ? "source" : "destination",
      onRetry:()=>{
        if(!current() || completed.current!==transaction)return;
        if(retryPromotion){retryPromotion();return;}
        setRetryRequest(previous=>({requestId:transaction.requestId,attempt:(previous?.attempt??0)+1}));
      },
    }),{id:"voice-move",duration:Infinity});
  };
  useEffect(()=>{
    const pending=recovery.current;
    if(pending?.mode==="reconnect" && completed.current?.requestId===pending.requestId && sfu.isConnected && sfu.connectionError!=="destination_recovery_required" &&
      host===pending.host && sfu.currentChannelConnected===pending.channel && authority?.generation===pending.generation &&
      transmissionState.publicationAcknowledged===true) {
      if(completed.current)completed.current.resumeRequired=false;
      recovery.current=undefined;applyPolicy(undefined);
    }
  },[host,sfu.isConnected,sfu.currentChannelConnected,sfu.connectionError,authority,transmissionState,applyPolicy]);
  useEffect(()=>{
    const transaction=completed.current;
    if(!transaction)return;
    if(host!==transaction.host || authority?.generation!==transaction.generation) {
      completed.current=undefined;recovery.current=undefined;return;
    }
    if(sfu.currentChannelConnected!==transaction.channel) {
      if(!transaction.promoted && sfu.currentChannelConnected===transaction.source)return;
      completed.current=undefined;recovery.current=undefined;return;
    }
    transaction.promoted=true;
    const failed=sfu.connectionError==="destination_recovery_required";
    const explicitRetry=retryRequest?.requestId===transaction.requestId;
    if((!failed && !(explicitRetry && transaction.resumeRequired)) || recovery.current || !socket || !authority)return;
    let disposed=false;
    const current=()=>!disposed && socket.connected && socket.id===transaction.generation && authority.stagingSupported;
    recovery.current={host,channel:transaction.channel,generation:transaction.generation,requestId:transaction.requestId,mode:failed?"reconnect":"resume"};
    void (async()=>{
      const confirmation=await authority.confirmCommit(transaction.requestId);
      if(!current() || confirmation.status!=="committed" || confirmation.sourceChannelId!==transaction.source ||
        confirmation.destinationChannelId!==transaction.channel)throw new Error("stale_move_confirmation");
      const policy=authority.getDestinationPolicy(transaction.requestId);if(!policy)throw new Error("missing_destination_policy");
      applyPolicy({host,generation:transaction.generation,requestId:transaction.requestId,destinationChannelId:transaction.channel,
        policy,beforePromotionRevision:transaction.revision});
      const until=Date.now()+8000;
      while(current() && Date.now()<until) {
        if(authority.isDestinationPolicyApplied(transaction.requestId,transaction.settings)) {
          if(!failed && transaction.resumeRequired) {
            await latest.current.sfu.resumeMoveTransmission!(transaction.requestId);
            if(current()){transaction.resumeRequired=false;recovery.current=undefined;applyPolicy(undefined);}
            return;
          }
          toast.error(i18n.t("pureVoice.moveRecovery",{host}),{id:"voice-move",duration:12000});return;
        }
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      throw new Error("destination_policy_not_acknowledged");
    })().catch(()=>retryNotice(current));
    return()=>{disposed=true;};
  },[host,sfu.currentChannelConnected,sfu.connectionError,authority,socket,applyPolicy,retryRequest]);
  useEffect(()=>{
    if(!socket || !authority || !supported || !sfu.prepareMove || !sfu.commitMove ||
      !sfu.abortMove || !sfu.resumeMoveTransmission)return;
    let disposed=false;
    type Request=NonNullable<ReturnType<typeof readMovePrepare>>;
    const records=new Map<string,{request:Request;ready:Promise<unknown>;commit?:Promise<void>;revision:number}>();
    const moveStatus=(request:Request,phase:"promoting"|"promoted"|"failed")=>window.dispatchEvent(new CustomEvent("voice_move_playback_status", { detail: {
      host, source:request.sourceChannelId, channel:request.destinationChannelId,
      requestId:request.requestId, account:userId, generation:authority.generation, phase,
    } }));
    const retirePlayback=()=>{for(const record of records.values())moveStatus(record.request,"failed");};
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
      recovery.current=undefined;
      completed.current={host,channel:record.request.destinationChannelId,source:record.request.sourceChannelId,
        generation:authority.generation,requestId:record.request.requestId,revision:record.revision,resumeRequired:true,promoted:false,settings:record.request.channelSettings};
      record.commit=(async()=>{
        await record.ready;if(!current())return;
        const bindConfirmedPolicy=async()=>{
          // Events never authorize policy. The fresh query must confirm the exact transaction.
          const confirmation=await authority.confirmCommit(record.request.requestId);
          if(!current() || completed.current?.requestId!==record.request.requestId || confirmation.status!=="committed" || confirmation.sourceChannelId!==record.request.sourceChannelId ||
            confirmation.destinationChannelId!==record.request.destinationChannelId)throw new Error("stale_move_confirmation");
          const policy=authority.getDestinationPolicy(record.request.requestId);if(!policy)throw new Error("missing_destination_policy");
          applyPolicy({host,generation:authority.generation,requestId:record.request.requestId,
            destinationChannelId:record.request.destinationChannelId,policy,beforePromotionRevision:record.revision});
        };
        // Bound to the destination only: source config is unchanged before promotion.
        // Install it first because commit may promote a failed destination then reject.
        await bindConfirmedPolicy();
        moveStatus(record.request,"promoting");
        let destinationRecovery=false;
        try {
          await latest.current.sfu.commitMove!(record.request.requestId);
          if(current())moveStatus(record.request,"promoted");else moveStatus(record.request,"failed");
        }
        catch(error) {
          moveStatus(record.request,"failed");
          if(!error || typeof error!=="object" || !("code" in error) || error.code!=="destination_recovery_required")throw error;
          destinationRecovery=true;
          recovery.current={host,channel:record.request.destinationChannelId,generation:authority.generation,requestId:record.request.requestId,mode:"reconnect"};
        }
        if(!current())return;
        if(completed.current?.requestId===record.request.requestId)completed.current.promoted=true;
        // Keep transaction identity after release so a later destination failure
        // can requery policy; live configuration need not retain stale controls.
        await bindConfirmedPolicy();
        const until=Date.now()+8000;
        while(current() && Date.now()<until) {
          if(authority.isDestinationPolicyApplied(record.request.requestId,record.request.channelSettings)) {
            if(destinationRecovery) {
              // Public connect uses the viewed server. Let the user select this
              // destination explicitly; never reconnect against a different view.
              toast.error(i18n.t("pureVoice.moveRecovery",{host}),{id:"voice-move",duration:12000});
              return;
            }
            await latest.current.sfu.resumeMoveTransmission!(record.request.requestId);
            if(current() && completed.current?.requestId===record.request.requestId){completed.current.resumeRequired=false;applyPolicy(undefined);}
            return;
          }
          await new Promise(resolve=>setTimeout(resolve,25));
        }
        throw new Error("destination_policy_not_acknowledged");
      })();
      void record.commit.catch(()=>{
        if(completed.current?.requestId!==record.request.requestId)return;
        if(!completed.current.promoted && latest.current.sfu.currentChannelConnected===record.request.sourceChannelId) {
          retryNotice(current,()=>{record.commit=undefined;result(value);});return;
        }
        if(latest.current.sfu.currentChannelConnected===record.request.destinationChannelId)retryNotice(current);else report();
      });
    };
    socket.on("voice:move:prepare",prepare);socket.on("voice:move:result",result);
    // Advertise only with the real installed methods, bound authority and live server/SFU probe.
    void send("voice:move:client",{v:1,staging:true}).catch(()=>{});
    const unsubscribe=authority.onInvalidated(()=>{retirePlayback();disposed=true;applyPolicy(undefined);});
    return()=>{
      retirePlayback();
      disposed=true;unsubscribe();socket.off("voice:move:prepare",prepare);socket.off("voice:move:result",result);
      // The SDK owns pending transport disposal on authority invalidation/call changes.
      records.clear();
    };
  },[host,socket,authority,supported,sfu.prepareMove,sfu.commitMove,sfu.abortMove,sfu.resumeMoveTransmission,applyPolicy,userId]);
}
