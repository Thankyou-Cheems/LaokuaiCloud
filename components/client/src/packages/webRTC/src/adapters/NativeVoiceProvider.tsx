import { SFUConnectionState } from "@gryt/voice";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useUserId } from "@/common";
import { useSettings } from "@/settings";
import { useServerManagement, useSockets } from "@/socket";

import { type NativeLanAudioDesired, type NativeLanAudioStatus } from "../../../../lib/nativeLanAudio";
import { createNativeRoomSession, type NativeRoomControls } from "../../../../lib/nativeRoomSession";
import { NativeVoiceContext, type NativeVoiceFacade } from "../../../../lib/voiceFacade";
import { emitAuthenticated } from "../../../socket/src/utils/tokenManager";
import { EffectiveVoicePolicyProvider } from "../components/EffectiveVoicePolicy";
import { ReceiveLevelingProvider } from "../components/ReceiveLevelingAdapter";
import { TransmitSpeechProvider } from "../components/TransmitSpeechAdapter";
import { usePeerVoiceCues } from "./usePeerVoiceCues";
import { useSquadProtection } from "./useSquadProtection";
import { useVoiceLifecycle } from "./useVoiceLifecycle";
import { useVoiceModes } from "./useVoiceModes";

const idle: NativeLanAudioStatus = {phase:"idle",peerCount:0,muted:true,deafened:true,captureRms:0,playbackRms:0,packetsSent:0,packetsReceived:0,processErrors:0};
const unsupported = () => { throw new Error("原生 ET 语音仅支持社区音频房间"); };
const noAction = () => {};
function NativeLifecycle() { useVoiceLifecycle(); useSquadProtection(); useVoiceModes(); usePeerVoiceCues(); return null; }

export function NativeVoiceProvider({children}:{children?:ReactNode}) {
  const settings = useSettings(), account = useUserId();
  const {currentlyViewingServer} = useServerManagement();
  const {sockets,serverDetailsList} = useSockets();
  const [call,setCall] = useState({host:"",room:"",state:SFUConnectionState.DISCONNECTED,error:null as string|null});
  const [status,setStatus] = useState(idle);
  const [pttHeld,setPttHeld] = useState(false), [suppressed,setSuppressed] = useState(false);
  const isPttActive = useRef(false);
  const sequence = useRef(0);
  const active = useRef<null | {host:string;socket:typeof sockets[string];generation:string|undefined;mediaConnected:boolean;session:ReturnType<typeof createNativeRoomSession>;cleanup:()=>void}>(null);
  const latest = useRef({settings,account,sockets,serverDetailsList,currentlyViewingServer});
  latest.current = {settings,account,sockets,serverDetailsList,currentlyViewingServer};
  const controls: NativeRoomControls = {muted:settings.isMuted || settings.isServerMuted || settings.isDeafened || settings.isServerDeafened,
    deafened:settings.isDeafened || settings.isServerDeafened,pttRequired:settings.inputMode === "push_to_talk",pttHeld,suppressed,
    inputGain:Math.max(0,Math.min(2,settings.micVolume/100)),outputGain:Math.max(0,Math.min(2,settings.outputVolume/100)),
    memberVolumes:Object.fromEntries(Object.entries(settings.userVolumes).map(([id,volume])=>[id,Math.max(0,Math.min(2,volume/100))]))};
  const controlsRef = useRef(controls); controlsRef.current = controls;
  const reconcile = useCallback(async (desired: NativeLanAudioDesired|null) => {
    const api = window.nativeLanAudio;
    if (!api) throw new Error("原生音频组件不可用");
    return api.reconcile(desired);
  },[]);
  const disconnect = useCallback(async (done?:()=>void) => {
    sequence.current++;
    const previous = active.current; active.current = null;
    if (previous) { previous.session.close(); previous.cleanup();
      if (previous.socket.connected) previous.socket.emit("voice:native:leave",{v:1}); }
    setStatus(idle); setCall({host:"",room:"",state:SFUConnectionState.DISCONNECTED,error:null});
    await reconcile(null); done?.();
  },[reconcile]);
  const connect = useCallback(async (room:string) => {
    const request=sequence.current+1;
    await disconnect();
    if(sequence.current!==request)return;
    const current=latest.current, host=current.currentlyViewingServer?.host;
    if (!host || !current.account || room.startsWith("dm_")) throw new Error("原生 ET 语音仅支持已认证社区音频房间");
    const socket=current.sockets[host], serverId=current.serverDetailsList[host]?.server_info?.server_id;
    if (!socket?.connected || !serverId) throw new Error("社区连接不可用");
    if (current.serverDetailsList[host]?.server_info?.native_lan_voice_enabled!==true) throw new Error("此社区后端尚未启用原生 ET 语音，请更新后端后重试");
    if (!current.serverDetailsList[host]?.channels.some(channel=>channel.id===room && channel.type==="voice")) throw new Error("语音房间不可用");
    const session=createNativeRoomSession(serverId,room);
    const entry={host,socket,generation:socket.id,mediaConnected:false,session,cleanup:noAction}; active.current=entry;
    let admitted=false;
    const valid=()=>active.current===entry && session.active && latest.current.account===current.account &&
      latest.current.serverDetailsList[host]?.server_info?.server_id===serverId && socket.connected && socket.id===entry.generation;
    const fail=(reason:string)=> { if (!valid()) return; void disconnect().catch(noAction).then(()=>setCall({host:"",room:"",state:SFUConnectionState.DISCONNECTED,error:reason})); };
    const update=()=> {
      if (!valid()) return;
      const desired=session.desired(controlsRef.current);
      if(!desired)setStatus(idle);
      if(!desired && entry.mediaConnected){entry.mediaConnected=false;socket.emit("voice:native:media",{v:1,connected:false});}
      void reconcile(desired).catch(()=>fail("原生音频启动失败"));
      setCall(previous=>({...previous,room:session.room,state:desired ? SFUConnectionState.CONNECTING : SFUConnectionState.RECONNECTING}));
    };
    const snapshot=(value:unknown)=> { if (valid() && session.accept(value)) {admitted=true;update();} };
    const moved=(value:{v?:number;status?:string;generation?:string;sourceChannelId?:string;destinationChannelId?:string})=> {
      if(!valid() || value?.v!==1 || value.status!=="committed" || value.generation!==entry.generation || value.sourceChannelId!==session.room || !value.destinationChannelId)return;
      session.move(value.destinationChannelId); setStatus(idle);update();
    };
    const stopped=(value:{reason?:string})=> {
      if (!valid()) return;
      if (value?.reason==="server_deafened") {admitted=true;session.suspend(); update();}
      else fail("原生语音会话已结束");
    };
    const error=(value:{error?:string})=> {
      if(!valid())return;
      const transient=value?.error==="binding_unavailable" || value?.error==="native_voice_unavailable";
      if(transient && admitted)return;
      fail("原生语音准入失败，请检查社区联机状态");
    };
    const lost=()=> { if(active.current===entry) void disconnect().catch(noAction).then(()=>setCall({host:"",room:"",state:SFUConnectionState.DISCONNECTED,error:"社区连接已断开"})); };
    socket.on("voice:native:snapshot",snapshot);socket.on("voice:native:stopped",stopped);socket.on("voice:native:error",error);socket.on("disconnect",lost);socket.on("voice:move:committed",moved);
    let binding: Awaited<ReturnType<NonNullable<typeof window.nativeLanAudio>["getBinding"]>>;
    const heartbeat=setInterval(()=> {
      if(!valid())return;
      void window.nativeLanAudio!.getBinding(serverId).then(next=>{
        if(!valid() || !next)return;
        if(binding && JSON.stringify(binding)!==JSON.stringify(next)) {
          session.suspend();update();binding=next;
          return emitAuthenticated(socket,"voice:native:join",{v:1,channelId:session.room,binding},host,valid);
        }
        binding=next;return emitAuthenticated(socket,"voice:native:heartbeat",{v:1,binding},host,valid);
      }).catch(noAction);
    },5000);
    const lease=setInterval(()=> {if(valid() && !session.desired(controlsRef.current)) {update();}},500);
    const joinTimeout=setTimeout(()=> {if(valid() && !admitted) fail("原生语音准入超时");},10000);
    entry.cleanup=()=> {clearInterval(heartbeat);clearInterval(lease);clearTimeout(joinTimeout);socket.off("voice:native:snapshot",snapshot);socket.off("voice:native:stopped",stopped);socket.off("voice:native:error",error);socket.off("disconnect",lost);socket.off("voice:move:committed",moved);};
    setCall({host,room,state:SFUConnectionState.REQUESTING_ACCESS,error:null});
    try {
      binding=await window.nativeLanAudio!.getBinding(serverId);
      if (!valid()) return;
      if (!binding) throw new Error("社区 EasyTier 尚未取得有效成员地址");
      if(!await emitAuthenticated(socket,"voice:native:join",{v:1,channelId:room,binding},host,valid)) throw new Error("社区身份不可用");
    } catch (failure) { if(valid()) await disconnect(); throw failure; }
  },[disconnect,reconcile]);
  useEffect(()=> {
    const api=window.nativeLanAudio;
    if(!api)return;
    return api.onStatus(next=> {
      const entry=active.current;
      if (!entry || next.serverId!==latest.current.serverDetailsList[entry.host]?.server_info?.server_id || next.roomId!==entry.session.room) return;
      // Queued telemetry cannot revive media after a lease/policy suspension.
      if(next.phase==="running" && !entry.session.desired(controlsRef.current))return;
      setStatus(next);
      const connected=next.phase==="running";
      if(connected!==entry.mediaConnected) {
        entry.mediaConnected=connected;
        entry.socket.emit("voice:native:media",{v:1,connected});
      }
      setCall(previous=>({...previous,state:next.phase==="running" ? SFUConnectionState.CONNECTED : next.phase==="error" ? SFUConnectionState.RECONNECTING : SFUConnectionState.CONNECTING,
        error:next.error ? `原生音频：${next.error}` : null}));
    });
  },[]);
  const controlsKey=JSON.stringify(controls);
  useEffect(()=> {const entry=active.current;if(entry) void reconcile(entry.session.desired(controlsRef.current)).catch(()=>setCall(previous=>({...previous,state:SFUConnectionState.RECONNECTING,error:"原生音频控制失败"})));},[controlsKey,reconcile]);
  useEffect(()=> {if(active.current) void disconnect().catch(noAction);},[account,disconnect]);
  useEffect(()=>()=> {const entry=active.current;active.current=null;entry?.session.close();entry?.cleanup();void reconcile(null).catch(noAction);},[reconcile]);
  const running=call.state===SFUConnectionState.CONNECTED && status.phase==="running";
  const speech=running && !status.muted && active.current?.session.desired(controls)?.muted===false && status.captureRms>0.01;
  const facade = useMemo<NativeVoiceFacade>(()=>({status,
    sfu:{microphoneCodecState:{status:"idle",reason:null,requested:null,effectiveMaxBitrateBps:null,remoteMaxAverageBitrateBps:null,limitedBy:[],senderMaxBitrateBps:null,remoteOfferMatches:null,rtpVerified:false,errorName:null},streams:{},streamSources:{},videoStreams:{},error:call.error,connect,disconnect,
      addVideoTrack:unsupported,removeVideoTrack:unsupported,addScreenVideoTrack:unsupported,removeScreenVideoTrack:unsupported,addScreenAudioTrack:unsupported,removeScreenAudioTrack:unsupported,
      currentServerConnected:call.host,currentChannelConnected:call.room,isConnected:running,connectionState:call.state,connectionError:call.error,
      isConnecting:call.state!==SFUConnectionState.DISCONNECTED && !running,getPeerConnection:()=>null,getConnectionEpoch:()=>null,activeSfuUrl:null,callAloneTimeoutSeconds:0,stillHere:noAction},
    microphone:{addHandle:noAction,removeHandle:noAction,microphoneBuffer:{},isBrowserSupported:true,devices:[],audioContext:undefined,isLoaded:running,
      getDevices:async()=>{},getVisualizerData:()=>null,getGateLevel:()=>null,getAutomaticNoiseGateState:()=>({status:"unavailable",reason:"platform_unsupported"}),
      isTransmitting:running && !status.muted,transmitSpeechActivity:speech,transmitSpeechActivityState:{status:"unavailable",reason:"platform_unsupported"},setTransmitConnected:noAction,isPttActive,
      setPushToTalkActive:(held:boolean)=>{isPttActive.current=held;setPttHeld(held);},setTransmitSuppressed:setSuppressed,retryTransmission:()=>{
        const entry=active.current;if(!entry)return;
        void reconcile(null).then(()=> {if(active.current===entry && entry.session.active && entry.socket.connected && entry.socket.id===entry.generation)return reconcile(entry.session.desired(controlsRef.current));}).catch(noAction);
      },
      transmissionState:{status:status.phase==="error" ? "failed" : !running ? "disabled" : status.muted ? "suppressed" : "ready",generation:0,publicationAllowed:running && !status.muted},
      micUnavailable:status.error==="audio-device" ? "failed" : null,isAcquiring:status.phase==="starting"},
    speakers:{devices:[],audioContext:undefined,remoteBusNode:undefined,receiveLevelingState:{status:"disabled",latencyMs:0},receiveAutoLevels:{kind:"receive-auto-levels",schemaVersion:1,snapshots:[]},getOutputDevices:noAction,applyOutputDevice:unsupported},
  }),[status,call,connect,disconnect,running,speech,reconcile]);
  const entry=active.current;
  // Effective publication includes self mute/deafen. It cannot decide whether
  // the microphone control is allowed to undo that local choice. Older v1
  // hosts fall back only to this authenticated channel's permission list.
  const channelPermissions=entry ? serverDetailsList[entry.host]?.channels.find(channel=>channel.id===entry.session.room)?.myPermissions : undefined;
  const canSpeak=entry ? (entry.session.canSpeak ?? channelPermissions?.includes("speak")===true) : true;
  return <NativeVoiceContext.Provider value={facade}><EffectiveVoicePolicyProvider value={{inputMode:active.current?.session.requirePTT ? "push_to_talk" : settings.inputMode,
    requiredPushToTalk:active.current?.session.requirePTT===true,serverMuted:settings.isServerMuted,serverDeafened:settings.isServerDeafened,canSpeak}}>
    <ReceiveLevelingProvider value={{available:false,enabled:null,runtime:"unknown"}}><TransmitSpeechProvider value={speech}><NativeLifecycle/>{children}</TransmitSpeechProvider></ReceiveLevelingProvider>
  </EffectiveVoicePolicyProvider></NativeVoiceContext.Provider>;
}
