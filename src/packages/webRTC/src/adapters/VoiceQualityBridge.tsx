/* eslint-disable react-refresh/only-export-components -- The context and its read hook share one adapter. */
import { useSFU } from "@gryt/voice";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

import { useSockets } from "@/socket";

import type { VoiceQualityReport } from "../../../../lib/voiceQualityStats";
import { VoiceQualityStore } from "../../../../lib/voiceQualityStore";

const EMPTY:ReadonlyMap<string,VoiceQualityReport>=new Map();
const Context=createContext(EMPTY);
const key=(host:string,member:string)=>JSON.stringify([host,member]);
export function useMemberVoiceQuality(host?:string,member?:string):VoiceQualityReport|undefined {
  const readings=useContext(Context);return host && member ? readings.get(key(host,member)) : undefined;
}
/** Only the authenticated current-room socket publishes teammates' own SFU measurements. */
export function VoiceQualityBridge({children}:{children?:ReactNode}) {
  const {isConnected,currentServerConnected:host,currentChannelConnected:channel}=useSFU();
  const {sockets,clients}=useSockets(); const socket=sockets[host];
  const scope=JSON.stringify([host,channel,socket?.id,isConnected]);
  const roster=useRef(clients);roster.current=clients;
  const [state,setState]=useState<{scope:string;readings:ReadonlyMap<string,VoiceQualityReport>}>({scope:"",readings:EMPTY});
  useEffect(()=>{
    if(!isConnected || !channel || !socket?.connected) {setState({scope,readings:EMPTY});return;}
    let disposed=false;const store=new VoiceQualityStore();
    const members=()=>Object.entries(roster.current[host]??{}).filter(([,client])=>
      client.hasJoinedChannel && client.voiceChannelId===channel && !!client.serverUserId);
    const known=()=>new Set(members().map(([id])=>id));
    const publish=()=>{
      if(disposed)return;
      const list=members();store.retain(known());const readings=new Map<string,VoiceQualityReport>();
      const counts=new Map<string,number>();for(const [,client] of list)counts.set(client.serverUserId!,1+(counts.get(client.serverUserId!)??0));
      for(const [id,client] of list) {
        const report=store.read(id,performance.now());
        if(report && counts.get(client.serverUserId!)===1)readings.set(key(host,client.serverUserId!),report);
      }
      setState({scope,readings});
    };
    const update=(value:unknown)=>{if(!disposed && socket.connected && store.accept(value,known(),performance.now()))publish();};
    const clear=()=>{store.reset();setState({scope,readings:EMPTY});};
    socket.on("voice:quality:update",update);socket.on("disconnect",clear);
    publish();const timer=setInterval(publish,1000);
    return()=>{disposed=true;clearInterval(timer);socket.off("voice:quality:update",update);socket.off("disconnect",clear);};
  },[scope,host,channel,isConnected,socket]);
  return <Context.Provider value={state.scope===scope ? state.readings : EMPTY}>{children}</Context.Provider>;
}
