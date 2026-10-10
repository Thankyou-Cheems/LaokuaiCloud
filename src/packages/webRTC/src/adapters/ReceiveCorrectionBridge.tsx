import { exportReceiveLevelPrior, type ReceiveAutoLevelSnapshot, useSFU, useSpeakers } from "@gryt/voice";
import { type ReactNode, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { useUserId } from "@/common";
import { useSockets } from "@/socket";

import { ReceiveCorrectionRegistry } from "../../../../lib/receiveCorrectionRegistry";
import { ReceivePriorCache, type ReceivePriorScope } from "../../../../lib/receivePriorCache";
import { ReceivePriorSession } from "../../../../lib/receivePriorSession";
import { ReceiveCorrectionProvider } from "../components/ReceiveCorrectionAdapter";
import { ReceivePriorProvider } from "../components/ReceivePriorAdapter";
import { useReceiveAudioRoles } from "./useReceiveAudioRoles";

/** SDK batches are authoritative; no client RMS estimator or sampling timer. */
export function ReceiveCorrectionBridge({ children }: { children?: ReactNode }) {
  const account=useUserId();const {serverDetailsList}=useSockets();const {currentServerConnected:host}=useSFU();
  const context=useRef({account,serverDetailsList});context.current={account,serverDetailsList};
  const [cache]=useState(()=>{try{return new ReceivePriorCache(localStorage);}catch{return new ReceivePriorCache(undefined);}});
  const [,refresh]=useState(0);
  const [session]=useState(()=>new ReceivePriorSession<ReceiveAutoLevelSnapshot>(cache,exportReceiveLevelPrior));
  const scopeFor=(serverHost:string,member:string):ReceivePriorScope|undefined=>{
    const current=context.current;const serverInstanceId=current.serverDetailsList[serverHost]?.server_info?.server_id;
    return current.account && serverInstanceId && member ? {accountId:current.account,serverInstanceId,remoteUserId:member} : undefined;
  };
  const [registry] = useState(() => new ReceiveCorrectionRegistry({
    bound:(control,identity)=>{
      const participant:unknown=JSON.parse(identity.participantId);
      if(!Array.isArray(participant) || participant.length!==2 || !participant.every(value=>typeof value==="string"))return;
      const scope=scopeFor(participant[0],participant[1]);
      if(scope)session.bind(identity,scope,(prior,expected)=>control.setPrior(prior,expected));
    },
    unbound:identity=>session.unbind(identity),
    measured:snapshot=>{if(session.observe(snapshot))refresh(value=>value+1);},
  }));
  const scopeKey=JSON.stringify([account,serverDetailsList[host]?.server_info?.server_id]);
  useLayoutEffect(()=>{
    cache.setAccount(account);session.reset();registry.clear();refresh(value=>value+1);
  },[cache,session,registry,scopeKey,account]);
  const { receiveAutoLevels,audioContext } = useSpeakers();
  useReceiveAudioRoles(registry,scopeKey);
  useLayoutEffect(() => { registry.acceptBatch(receiveAutoLevels); }, [registry, receiveAutoLevels]);
  useLayoutEffect(() => () => registry.clear(), [registry]);
  const readings = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  return <ReceivePriorProvider value={{available:cache.available,count:cache.count(),
    clearMember:(serverHost,member)=>{const scope=scopeFor(serverHost,member);if(scope){session.clear(scope,audioContext?.currentTime);refresh(value=>value+1);}},
    clearAll:()=>{session.clear(undefined,audioContext?.currentTime);refresh(value=>value+1);}}}>
    <ReceiveCorrectionProvider value={readings}>{children}</ReceiveCorrectionProvider>
  </ReceivePriorProvider>;
}
