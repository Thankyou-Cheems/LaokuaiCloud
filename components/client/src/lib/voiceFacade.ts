import { type LatencyBreakdown, useMicrophone as useLegacyMicrophone, useSFU as useLegacySFU, useSpeakers as useLegacySpeakers, useVoiceLatency as useLegacyVoiceLatency } from "@gryt/voice";
import { createContext, useContext } from "react";

import type { NativeLanAudioStatus } from "./nativeLanAudio";

/** Chosen once before React mounts. Native builds never mount SDK singleton runners. */
export const nativeVoiceEnabled = typeof window !== "undefined" && window.electronAPI?.nativeLanVoiceEnabled === true;
export interface NativeVoiceFacade {
  sfu: ReturnType<typeof useLegacySFU>;
  microphone: ReturnType<typeof useLegacyMicrophone>;
  speakers: ReturnType<typeof useLegacySpeakers>;
  status: NativeLanAudioStatus;
}
export const NativeVoiceContext = createContext<NativeVoiceFacade | null>(null);
function useNative() {
  const value = useContext(NativeVoiceContext);
  if (!value) throw new Error("Native voice provider is missing");
  return value;
}
function useNativeSFU() { return useNative().sfu; }
function useNativeMicrophone() { return useNative().microphone; }
function useNativeSpeakers() { return useNative().speakers; }
export const useSFU = nativeVoiceEnabled ? useNativeSFU : useLegacySFU;
export const useMicrophone: typeof useLegacyMicrophone = nativeVoiceEnabled ? useNativeMicrophone : useLegacyMicrophone;
export const useSpeakers: () => ReturnType<typeof useLegacySpeakers> = nativeVoiceEnabled ? useNativeSpeakers : useLegacySpeakers;
const unmeasuredLatency: LatencyBreakdown = {contextBaseLatencyMs:null,contextOutputLatencyMs:null,rnnoiseBufferMs:null,
  networkRttMs:null,oneWayNetworkMs:null,jitterMs:null,jitterBufferMs:null,packetsLost:null,packetsSent:null,packetsReceived:null,
  codec:null,bitrateKbps:null,availableOutKbps:null,sfuEndpoint:null,remoteAddress:null,localAddress:null,candidateType:null,
  localPipelineMs:null,estimatedOneWayMs:null,estimatedRoundTripMs:null};
/** Native audio exposes no WebRTC latency measurement. Never acquire SDK config here. */
function useNativeVoiceLatency() {return {latency:unmeasuredLatency,modeLabel:"原生 AoO / ET · 延迟尚未测量"};}
export const useVoiceLatency: typeof useLegacyVoiceLatency = nativeVoiceEnabled ? useNativeVoiceLatency : useLegacyVoiceLatency;
/** Actual native telemetry; no synthetic MediaStream, AudioContext or analyser. */
export function useNativeAudioStatus() { return useContext(NativeVoiceContext)?.status; }
