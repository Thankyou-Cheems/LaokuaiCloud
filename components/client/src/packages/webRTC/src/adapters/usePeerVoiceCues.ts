import { useEffect, useRef } from "react";

import { useSettings } from "@/settings";
import { useSockets } from "@/socket";

import { PeerCuePolicy } from "../../../../lib/peerVoiceCues";
import { useSFU } from "../../../../lib/voiceFacade";
import { useVoiceSounds } from "./useVoiceSounds";

/** Real room events only; decode/resume cannot resurrect a cue from an old connection. */
export function usePeerVoiceCues() {
  const { isConnected, currentServerConnected: host, currentChannelConnected: channel } = useSFU();
  const { sockets } = useSockets();
  const settings = useSettings();
  const { announce } = useVoiceSounds();
  const socket = sockets[host];
  const signature = JSON.stringify([host,channel,isConnected,socket?.id]);
  const revision = useRef({ signature: "", generation: 0 });
  if(revision.current.signature !== signature)revision.current={signature,generation:revision.current.generation+1};
  const key=JSON.stringify([signature,revision.current.generation]);
  const current=useRef({key,settings,isConnected,channel,socket});
  current.current={key,settings,isConnected,channel,socket};
  const policy=useRef(new PeerCuePolicy());
  useEffect(()=>{
    if(!socket || !isConnected || !channel)return;
    const event=(kind:"join"|"leave")=>(payload:{clientId?:string;channelId?:string})=>{
      const arrived=Date.now();
      const allowed=()=>{
        const live=current.current;const s=live.settings;
        return live.key===key && live.socket===socket && socket.connected && live.isConnected && payload.channelId===live.channel &&
          s.peerVoiceCues.enabled && !s.peerVoiceCues.dnd && !s.isDeafened && !s.isServerDeafened && s.outputVolume>0 &&
          (kind==="join" ? s.connectSoundEnabled : s.disconnectSoundEnabled);
      };
      if(!payload?.clientId || !policy.current.accept({connectionKey:key,selfId:socket.id??"",memberId:payload.clientId,kind,eligible:allowed(),now:arrived}))return;
      announce(kind === "join" ? "peerJoined" : "peerLeft", `${key}:${payload.clientId}`,
        ()=>allowed() && Date.now()-arrived<5000);
    };
    const join=event("join"),leave=event("leave");
    socket.on("voice:peer:joined",join);socket.on("voice:peer:left",leave);
    return ()=>{socket.off("voice:peer:joined",join);socket.off("voice:peer:left",leave);};
  },[socket,isConnected,channel,key,announce]);
}
