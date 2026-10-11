import type { VoiceConfig, VoiceConfigCallbacks } from "@gryt/voice";
import { setVoiceHost, useMicrophone, useSFU, useSpeakers, VoiceConfigProvider, VoiceSingletonHooks } from "@gryt/voice";
import { type ReactNode,useEffect,useLayoutEffect,useMemo, useRef,useState } from "react";

import {useUserId} from "@/common";
import { useSettings } from "@/settings";
import { useServerManagement, useSockets } from "@/socket";

import {createMoveAuthoritySession} from "../../../../lib/moveAuthoritySession";
import {isMovePolicyAcknowledged,type MovePolicyBinding,type MovePolicyEvidence} from "../../../../lib/movePolicy";
import { transmitSpeechIndicator } from "../../../../lib/transmitSpeechIndicator";
import {emitAuthenticated} from "../../../socket/src/utils/tokenManager";
import {EffectiveVoicePolicyProvider} from "../components/EffectiveVoicePolicy";
import { ReceiveLevelingProvider } from "../components/ReceiveLevelingAdapter";
import { TransmitSpeechProvider } from "../components/TransmitSpeechAdapter";
import type { HybridVoicePolicy } from "./HybridVoiceBridge";
import { ReceiveCorrectionBridge } from "./ReceiveCorrectionBridge";
import { createRoomCoordinator } from "./roomCoordinator";
import { useOutputDevice } from "./useOutputDevice";
import { usePeerVoiceCues } from "./usePeerVoiceCues";
import { useSquadProtection } from "./useSquadProtection";
import { useVoiceLifecycle } from "./useVoiceLifecycle";
import { useVoiceModes } from "./useVoiceModes";
import {type ClientMoveAuthority,useVoiceMoves} from "./useVoiceMoves";
import { useVoiceQualityReporting } from "./useVoiceQualityReporting";
import { useVoiceConfigFromSettings } from "./voiceConfig";
import { electronVoiceHost } from "./voiceHost";
import { VoiceQualityBridge } from "./VoiceQualityBridge";

/**
 * Everything the engine cannot work out for itself, in one place. The host is set
 * at module scope: setting it during a render leaves the first connection short.
 */
setVoiceHost(electronVoiceHost);

const NO_STUN: string[] = [];
function VoiceMoveBridge({config,authorities,applyPolicy,evidence}:{config:VoiceConfig;authorities:Record<string,ClientMoveAuthority>;
  applyPolicy:(binding:MovePolicyBinding|undefined)=>void;evidence:{current:MovePolicyEvidence|undefined}}) {
  const {currentServerConnected:host,currentChannelConnected:channel}=useSFU();
  const {transmissionState}=useMicrophone(false);const {sockets}=useSockets();
  useLayoutEffect(()=>{evidence.current={host,channel,generation:sockets[host]?.id??"",config,transmission:transmissionState};},
    [host,channel,sockets,config,transmissionState,evidence]);
  useVoiceMoves(authorities,applyPolicy);
  return null;
}
function TransmitSpeechBridge({children,config}:{children?:ReactNode;config:VoiceConfig}) {
  const {transmitSpeechActivity,transmitSpeechActivityState,transmissionState}=useMicrophone();
  const {isConnected}=useSFU();
  const safe=transmitSpeechIndicator({speech:transmitSpeechActivity,speechState:transmitSpeechActivityState,connected:isConnected,
    muted:config.audio.muted,serverMuted:config.audio.serverMuted,transmission:transmissionState});
  return <TransmitSpeechProvider value={safe}>{children}</TransmitSpeechProvider>;
}

function ReceiveLevelingBridge({ children }: { children?: ReactNode }) {
  const { receiveLevelingEnabled, setReceiveLevelingEnabled } = useSettings();
  const { receiveLevelingState } = useSpeakers();
  const value = useMemo(() => ({ available: true as const, enabled: receiveLevelingEnabled,
    runtime: receiveLevelingState.status, reason: receiveLevelingState.reason,
    latencyMs: receiveLevelingState.latencyMs, setEnabled: setReceiveLevelingEnabled }),
  [receiveLevelingEnabled, receiveLevelingState, setReceiveLevelingEnabled]);
  return <ReceiveLevelingProvider value={value}>{children}</ReceiveLevelingProvider>;
}

function VoiceLifecycle() {
  useVoiceLifecycle();
  useOutputDevice();
  useSquadProtection();
  useVoiceModes();
  usePeerVoiceCues();
  useVoiceQualityReporting();
  return null;
}

/**
 * What the engine noticed, written down — only when nothing had been chosen.
 * Recording a fallback would let unplugging a headset replace the stored choice.
 */
function useDeviceCallbacks(): VoiceConfigCallbacks {
  const settings = useSettings();

  // Through a ref so the callbacks keep one identity for the life of the app: a
  // new object per settings change would reopen the microphone and the camera.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  return useMemo(
    () => ({
      onAudioDeviceChanged: (deviceId: string) => {
        if (settingsRef.current.micID) return;
        settingsRef.current.setMicID(deviceId);
      },

    }),
    [],
  );
}

export function VoiceProvider({ children, hybrid }: { children?: ReactNode; hybrid?: HybridVoicePolicy }) {
  const account=useUserId();
  const { currentlyViewingServer } = useServerManagement();
  const { sockets, serverDetailsList } = useSockets();
  const callbacks = useDeviceCallbacks();
  const [move,setMove]=useState<MovePolicyBinding>();
  const moveRef=useRef(move);moveRef.current=move;
  const evidence=useRef<MovePolicyEvidence|undefined>(undefined);
  const detailsRef=useRef(serverDetailsList);detailsRef.current=serverDetailsList;
  const socketsRef=useRef(sockets);socketsRef.current=sockets;
  const accountRef=useRef(account);accountRef.current=account;
  const logicalScopes=useRef<{account:typeof account;epoch:number;servers:Record<string,{id:string;epoch:number}>}>({account,epoch:0,servers:{}});
  if(logicalScopes.current.account!==account) {
    logicalScopes.current.account=account;logicalScopes.current.epoch++;logicalScopes.current.servers={};
  }
  for(const [serverHost,details] of Object.entries(serverDetailsList)) {
    const id=details.server_info?.server_id;if(!id)continue;
    const previous=logicalScopes.current.servers[serverHost];
    if(previous?.id!==id)logicalScopes.current.servers[serverHost]={id,epoch:(previous?.epoch??0)+1};
  }
  type Entry={scope:string;session:ReturnType<typeof createMoveAuthoritySession>;room:ReturnType<typeof createRoomCoordinator>};
  const entriesRef=useRef<Record<string,Entry>>({});
  const [entries,setEntries]=useState<Record<string,Entry>>({});
  const scopeFingerprint=JSON.stringify(Object.entries(sockets).map(([serverHost,socket])=>
    [serverHost,socket.connected?socket.id:null,serverDetailsList[serverHost]?.server_info?.server_id,account]));
  useEffect(()=>{
    const next:Record<string,Entry>={};
    for(const [serverHost,socket] of Object.entries(sockets)) {
      const serverId=detailsRef.current[serverHost]?.server_info?.server_id;
      if(!account || !serverId || !socket.connected || !socket.id)continue;
      const scope=JSON.stringify([account,serverId,socket.id]);
      const old=entriesRef.current[serverHost];
      if(old?.scope===scope){next[serverHost]=old;continue;}
      old?.session.dispose();
      const session=createMoveAuthoritySession(serverId,[socket,()=>detailsRef.current[serverHost]?.server_info?.voice_atomic_move_enabled===true,
        (event,payload,current)=>emitAuthenticated(socket,event,payload,serverHost,current),
        (requestId,policy)=>evidence.current!==undefined && isMovePolicyAcknowledged(moveRef.current,requestId,policy,evidence.current)],()=>setEntries({...entriesRef.current}));
      // Retained SDK coordinators resolve the new authenticated generation.
      // Account/server changes cannot retarget them or revive old authorities.
      const accountEpoch=logicalScopes.current.epoch;
      const serverEpoch=logicalScopes.current.servers[serverHost]?.epoch;
      const sameIdentity=()=>accountRef.current===account && logicalScopes.current.epoch===accountEpoch &&
        logicalScopes.current.servers[serverHost]?.epoch===serverEpoch && detailsRef.current[serverHost]?.server_info?.server_id===serverId;
      next[serverHost]={scope,session,room:createRoomCoordinator(
        ()=>sameIdentity() ? socketsRef.current[serverHost] : undefined,serverHost,
        ()=>sameIdentity() ? entriesRef.current[serverHost]?.session.authority : undefined)};
    }
    for(const [serverHost,old] of Object.entries(entriesRef.current))if(!next[serverHost])old.session.dispose();
    if(Object.keys(next).length!==Object.keys(entriesRef.current).length || Object.entries(next).some(([key,entry])=>entriesRef.current[key]!==entry)) { entriesRef.current=next;setEntries(next); }
  },[account,sockets,scopeFingerprint]);
  useEffect(()=>()=>{for(const entry of Object.values(entriesRef.current))entry.session.dispose();entriesRef.current={};},[]);
  const authorities=useMemo(()=>Object.fromEntries(Object.entries(entries).map(([serverHost,entry])=>[serverHost,entry.session.authority])),[entries]);

  const host = currentlyViewingServer?.host;
  const details = host ? serverDetailsList[host] : undefined;

  // Identity stays stable while the host does, so the engine is not handed a new
  // coordinator on every render of the app shell.
  const target = useMemo(() => {
    if (!host) return null;
    const entry=entries[host];
    return entry ? { id:host,room:entry.room } : null;
  }, [host, entries]);

  const stunHosts = details?.stun_hosts ?? NO_STUN;
  const config = useVoiceConfigFromSettings(stunHosts,move);
  const {currentServerConnected:callHost,currentChannelConnected:callChannel}=useSFU();
  const channelPolicy=serverDetailsList[callHost]?.channels.find(channel=>channel.id===callChannel);
  const requiredPushToTalk=channelPolicy?.requirePushToTalk===true || (move?.host===callHost && move.destinationChannelId===callChannel && move.policy.requirePTT);

  // Preserve the provider element when a singleton publishes an unchanged call scope.
  // Recreating its context would rerender the singleton runners that publish to us.
  return useMemo(() => (
    <VoiceConfigProvider config={config} callbacks={callbacks} target={target}>
      {/* Runs the body of every singleton hook inside @gryt/voice, once. The
          client's own <SingletonHooks /> only knows about the client's registry;
          these are a second one. Without this the hooks return their initial
          values forever and voice silently does nothing. */}
      <VoiceSingletonHooks />
      <VoiceMoveBridge config={config} authorities={authorities} applyPolicy={setMove} evidence={evidence}/>
      {/* Inside the provider, because it consumes useSFU. Runs the three
          behaviours that were deliberately left out of the package: the connect
          sound, ending a call when its server is removed, and the server hanging
          up on us. */}
      <ReceiveCorrectionBridge config={config} hybrid={hybrid}>
        <VoiceLifecycle />
        <EffectiveVoicePolicyProvider value={{inputMode:config.audio.inputMode,requiredPushToTalk:requiredPushToTalk===true,
          serverMuted:config.audio.serverMuted,serverDeafened:config.audio.serverDeafened,canSpeak:config.audio.transmitEligible===true}}>
          <VoiceQualityBridge><TransmitSpeechBridge config={config}><ReceiveLevelingBridge>{children}</ReceiveLevelingBridge></TransmitSpeechBridge></VoiceQualityBridge>
        </EffectiveVoicePolicyProvider>
      </ReceiveCorrectionBridge>
    </VoiceConfigProvider>
  ),[config,callbacks,target,authorities,evidence,requiredPushToTalk,children,hybrid]);
}
