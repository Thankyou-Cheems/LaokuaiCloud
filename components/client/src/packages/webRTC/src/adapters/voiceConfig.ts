import { useSFU,type VoiceConfig } from "@gryt/voice";
import { useMemo } from "react";

import { useSettings } from "@/settings";
import { useSockets } from "@/socket";

import type { MovePolicyBinding } from "../../../../lib/movePolicy";
import { receiveMicrophoneStreamIds } from "../../../../lib/pureVoicePolicy";
import { useSquadGateEnabled } from "../../../../lib/squadRuntime";
import { voicePresetCodec } from "../../../../lib/voiceTransportPreset";

/**
 * The client's settings, in the shape the engine asks for — **the one place that
 * knows both**. Media placeholders are inert under the enforced audio-only policy.
 */
export function useVoiceConfigFromSettings(stunHosts: string[],move?:MovePolicyBinding): VoiceConfig {
  const s = useSettings();
  const transmitSuppressionEnabled = useSquadGateEnabled();
  const {currentServerConnected:host,currentChannelConnected:channel}=useSFU();
  const {clients,serverDetailsList,sockets}=useSockets();
  const details=serverDetailsList[host];
  const currentChannel=details?.channels.find(item=>item.id===channel);
  const permissions=currentChannel?.myPermissions ?? details?.server_info?.permissions;
  const socket=sockets[host];
  const own=socket?.id ? clients[host]?.[socket.id] : undefined;
  const policy=move?.host===host && move.destinationChannelId===channel && move.generation===socket?.id ? move.policy : undefined;
  const transmitEligible=!!host && !!channel && socket?.connected===true && Array.isArray(permissions) && permissions.includes("speak") && policy?.speak!==false;
  const serverMuted=own?.isServerMuted===true || policy?.isMuted===true;
  const serverDeafened=own?.isServerDeafened===true || policy?.isDeafened===true;
  const requestedBitrate=policy ? policy.maxBitrate : currentChannel?.maxBitrate;
  const maxBitrate=typeof requestedBitrate==="number" && Number.isFinite(requestedBitrate) && requestedBitrate>0 ? requestedBitrate : null;
  const inputMode=policy?.requirePTT || currentChannel?.requirePushToTalk ? "push_to_talk" : s.inputMode;
  const noiseSuppression=!(policy?.disableRNNoise || currentChannel?.disableRnnoise) && s.rnnoiseEnabled;
  const eSportsMode=policy?.eSportsMode===true || currentChannel?.eSportsMode===true || s.eSportsModeEnabled;
  // Permission comes from the authenticated signalling roster, not the media
  // connection state that this policy itself controls. Our publication is not
  // a remote receive source; announcing it must not tear down our own PC.
  const microphones=useMemo(()=>receiveMicrophoneStreamIds({host,channelId:channel,
    connected:socket?.connected===true && !!own?.serverUserId,
    clients:Object.entries(clients[host]??{}).filter(([id])=>id!==socket?.id).map(([,client])=>client)}),
    [host,channel,socket?.connected,socket?.id,own?.serverUserId,clients]);

  return useMemo(
    () => ({
      audio: {
        deviceId: s.micID,
        muted: s.isMuted,
        serverMuted,
        deafened: s.isDeafened,
        serverDeafened,
        inputMode,
        volume: s.micVolume,
        outputVolume: s.outputVolume,
        receiveLevelingEnabled: s.receiveLevelingEnabled,
        transmitSuppressionEnabled,
        loopback: s.loopbackEnabled,
        noiseSuppression,
        noiseGate: s.noiseGate,
        noiseGateMode:s.noiseGateMode,
        transmitSpeechActivityEnabled:true,
        transmitEligible,
        noiseGateRelease: s.noiseGateRelease,
        autoGain: { enabled: s.autoGainEnabled, targetDb: s.autoGainTargetDb },
        compressorEnabled: s.compressorEnabled,
        compressorAmount: s.compressorAmount,
      },
      camera:{quality:"480p",fps:30,mirrored:false},
      screen:{quality:"480p",fps:30,gamingMode:false},
      connection: {
        mediaMode:"audio-only",
        microphoneCodec:voicePresetCodec(s.voiceTransportPreset),
        receiveMicrophoneStreamIds:microphones,
        stunHosts,
        eSportsMode,
        maxBitrate,
      },
    }),
    [
      s.micID, s.isMuted, serverMuted, s.isDeafened, serverDeafened,inputMode,noiseSuppression,eSportsMode,
      s.receiveLevelingEnabled, transmitSuppressionEnabled,
      s.micVolume, s.outputVolume, s.loopbackEnabled,
      s.noiseGate, s.noiseGateMode, s.noiseGateRelease, s.autoGainEnabled, s.autoGainTargetDb,
      s.compressorEnabled, s.compressorAmount, transmitEligible,microphones,
      stunHosts,maxBitrate,s.voiceTransportPreset,
    ],
  );
}
