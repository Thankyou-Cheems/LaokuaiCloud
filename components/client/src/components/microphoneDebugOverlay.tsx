import { useDeviceEnumeration } from "@gryt/voice";
import { useEffect, useState } from "react";

import { i18n, LocalizedText, useTranslation } from "@/i18n";
import { useSettings } from "@/settings";
import { useServerManagement,useSockets } from "@/socket";

import { PiCircleFill, PiMicrophoneFill } from "../lib/icons";
import { useVoiceLatency } from "../lib/voiceFacade";
import { nativeVoiceEnabled, useMicrophone,useNativeAudioStatus } from "../lib/voiceFacade";
import { DebugOverlay } from "./debugOverlay";

interface MicrophoneDebugOverlayProps {
  isVisible: boolean;
}

const StateDot = ({ on }: { on: boolean }) => (
  <PiCircleFill size={8} color={on ? "var(--gryt-success-11)" : "var(--gryt-danger-11)"} />
);

export function MicrophoneDebugOverlay({ isVisible }: MicrophoneDebugOverlayProps) {
  return nativeVoiceEnabled ? <NativeAudioDebug isVisible={isVisible}/> : <LegacyMicrophoneDebugOverlay isVisible={isVisible}/>;
}
function NativeAudioDebug({isVisible}:MicrophoneDebugOverlayProps) {
  const status=useNativeAudioStatus();
  if(!isVisible)return null;
  return <div role="status" className="fixed bottom-4 right-4 z-50 bg-gryt-surface p-3 rounded border border-gryt-border">
    原生 AoO / ET · {status?.phase ?? "idle"}<br/>采集 RMS {status?.captureRms.toFixed(4) ?? "—"} · 播放混音 RMS {status?.playbackRms.toFixed(4) ?? "—"}<br/>
    UDP 发 {status?.packetsSent ?? 0} / 收 {status?.packetsReceived ?? 0}<br/>浏览器媒体/DSP诊断不适用于此路径
  </div>;
}
function LegacyMicrophoneDebugOverlay({ isVisible }: MicrophoneDebugOverlayProps) {
  useTranslation();
  const { 
    microphoneBuffer, 
    audioContext
  } = useMicrophone(isVisible);
  
  const { devices, isLoading: devicesLoading, error: devicesError } = useDeviceEnumeration();
  const { micID, micVolume, noiseGate, isMuted, isDeafened } = useSettings();
  const { currentlyViewingServer } = useServerManagement();
  const { sockets } = useSockets();
  const { latency, modeLabel } = useVoiceLatency(isVisible);
  
  const [currentDevice, setCurrentDevice] = useState<InputDeviceInfo | null>(null);
  const [rawVolume, setRawVolume] = useState(0);
  const [processedVolume, setProcessedVolume] = useState(0);
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  const [socketRttMs, setSocketRttMs] = useState<number | null>(null);

  // Find current device info
  useEffect(() => {
    if (micID && devices.length > 0) {
      const device = devices.find((d: InputDeviceInfo) => d.deviceId === micID);
      setCurrentDevice(device || null);
    } else {
      setCurrentDevice(null);
    }
  }, [micID, devices]);

  // Monitor audio levels and transmission status
  useEffect(() => {
    if (!microphoneBuffer.analyser || !microphoneBuffer.finalAnalyser) {
      return;
    }

    const interval = setInterval(() => {
      // Raw audio level (for noise gate detection)
      if (microphoneBuffer.analyser) {
        const bufferLength = microphoneBuffer.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        microphoneBuffer.analyser.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        const rawVol = (rms / 255) * 100;
        setRawVolume(rawVol);
        
        // Check if transmitting (above noise gate)
        setIsTransmitting(rawVol > noiseGate && !isMuted && !isDeafened);
      }

      // Processed audio level (final output)
      if (microphoneBuffer.finalAnalyser) {
        const bufferLength = microphoneBuffer.finalAnalyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        microphoneBuffer.finalAnalyser.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        const processedVol = (rms / 255) * 100;
        setProcessedVolume(processedVol);
        
        // Calculate dB level
        const dbLevel = processedVol > 0 ? 20 * Math.log10(processedVol / 100) : -Infinity;
        setAudioLevel(dbLevel);
      }
    }, 50); // Update 20 times per second

    return () => clearInterval(interval);
  }, [microphoneBuffer.analyser, microphoneBuffer.finalAnalyser, noiseGate, isMuted, isDeafened]);

  // Socket ping RTT (currently viewed server)
  useEffect(() => {
    if (!isVisible) return;
    const host = currentlyViewingServer?.host;
    if (!host) return;
    const socket = sockets[host];
    if (!socket || !socket.connected) return;

    let alive = true;

    const onPong = (payload: { t0: number }) => {
      if (!alive) return;
      const t0 = payload?.t0;
      if (typeof t0 !== "number") return;
      setSocketRttMs(Math.max(0, Date.now() - t0));
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on("diagnostics:pong", onPong as any);
    const interval = setInterval(() => {
      const t0 = Date.now();
      socket.emit("diagnostics:ping", { t0 });
    }, 1000);

    return () => {
      alive = false;
      clearInterval(interval);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.off("diagnostics:pong", onPong as any);
    };
  }, [isVisible, currentlyViewingServer?.host, sockets]);


  return (
    <DebugOverlay
      isVisible={isVisible}
      title={i18n.t("shellFull.microphoneDebugOverlay_tsx_184d8b0360")}
      icon={<PiMicrophoneFill size={16} />}
      status={{
        active: !!audioContext,
        label: audioContext?.state || i18n.t("shellFull.microphoneDebugOverlay_tsx_6eef664840")
      }}
    >
      {/* Device Information */}
      <div style={{ marginBottom: "8px" }}>
        <div style={{ color: "var(--gryt-secondary-11)", fontWeight: "bold" }}>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_153f113cc6" />}</div>
        <div style={{ marginLeft: "8px", fontSize: "11px" }}>
          <div>ID: {micID ? micID.slice(0, 8) + "..." : i18n.t("shellFull.microphoneDebugOverlay_tsx_6eef664840")}</div>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_71dd2eff9b" />}{" "}{currentDevice?.label || i18n.t("shellFull.microphoneDebugOverlay_tsx_bc7819b34f")}</div>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_4a8c2fb2e5" />}{" "}{devicesLoading ? i18n.t("shellFull.microphoneDebugOverlay_tsx_b04ba49f84") : devicesError ? i18n.t("shellFull.microphoneDebugOverlay_tsx_7f2f6a15cf") : i18n.t("shellFull.microphoneDebugOverlay_tsx_d509764ac3", { value0: devices.length })}</div>
          {devicesError && (
            <div style={{ color: "var(--gryt-danger-11)", fontSize: "10px" }}>
              {devicesError}
            </div>
          )}
        </div>
      </div>

      {/* Audio Levels */}
      <div style={{ marginBottom: "8px" }}>
        <div style={{ color: "var(--gryt-secondary-11)", fontWeight: "bold" }}>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_3e1883dd5c" />}</div>
        <div style={{ marginLeft: "8px", fontSize: "11px" }}>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_6a145a03b0" />}{" "}{rawVolume.toFixed(1)}%</div>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_17b9bfdd8c" />}{" "}{processedVolume.toFixed(1)}%</div>
          <div>dB: {audioLevel === -Infinity ? "-∞" : audioLevel.toFixed(1)} dB</div>
        </div>
      </div>

      {/* Settings */}
      <div style={{ marginBottom: "8px" }}>
        <div style={{ color: "var(--gryt-secondary-11)", fontWeight: "bold" }}>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_9591a3f419" />}</div>
        <div style={{ marginLeft: "8px", fontSize: "11px" }}>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_d9d9ee5820" />}{" "}{micVolume}%</div>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_ec4033f358" />}{" "}{noiseGate}%</div>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_bfc427cd49" />}{" "}{isMuted ? i18n.t("shellFull.microphoneDebugOverlay_tsx_5397e0583f") : i18n.t("shellFull.microphoneDebugOverlay_tsx_816c52fd2b")}</div>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_9ef0115a56" />}{" "}{isDeafened ? i18n.t("shellFull.microphoneDebugOverlay_tsx_5397e0583f") : i18n.t("shellFull.microphoneDebugOverlay_tsx_816c52fd2b")}</div>
        </div>
      </div>

      {/* Status */}
      <div style={{ marginBottom: "8px" }}>
        <div style={{ color: "var(--gryt-secondary-11)", fontWeight: "bold" }}>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_11dc9e1952" />}</div>
        <div style={{ marginLeft: "8px", fontSize: "11px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_0c9fca06bf" />}{" "}<StateDot on={isTransmitting} /> {isTransmitting ? i18n.t("shellFull.microphoneDebugOverlay_tsx_5397e0583f") : i18n.t("shellFull.microphoneDebugOverlay_tsx_816c52fd2b")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_1c3c2d591a" />}{" "}<StateDot on={!!microphoneBuffer.mediaStream?.active} />{" "}
            {microphoneBuffer.mediaStream?.active ? i18n.t("shellFull.microphoneDebugOverlay_tsx_5397e0583f") : i18n.t("shellFull.microphoneDebugOverlay_tsx_816c52fd2b")}
          </div>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_691ef75a82" />}{" "}{audioContext?.state || i18n.t("shellFull.microphoneDebugOverlay_tsx_6eef664840")}</div>
        </div>
      </div>

      {/* Visual Audio Level Bar */}
      <div style={{ marginTop: "8px" }}>
        <div style={{ color: "var(--gryt-secondary-11)", fontWeight: "bold", marginBottom: "4px" }}>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_ff303351d1" />}</div>
        <div style={{ 
          width: "100%", 
          height: "8px", 
          backgroundColor: "var(--gryt-neutral-7)", 
          borderRadius: "4px",
          overflow: "hidden"
        }}>
          <div style={{
            width: `${Math.min(processedVolume, 100)}%`,
            height: "100%",
            backgroundColor: processedVolume > 80 ? "var(--gryt-danger-9)" : 
                           processedVolume > 50 ? "var(--gryt-warning-9)" : "var(--gryt-success-9)",
            transition: "width 0.1s ease-out"
          }} />
        </div>
        <div style={{ 
          fontSize: "10px", 
          color: "var(--gryt-neutral-9)", 
          marginTop: "2px",
          textAlign: "right" 
        }}>
          {processedVolume.toFixed(1)}%
        </div>
      </div>

      {/* Network / latency */}
      <div style={{ marginTop: "12px" }}>
        <div style={{ color: "var(--gryt-secondary-11)", fontWeight: "bold", marginBottom: "4px" }}>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_4dea3dc643" />}</div>
        <div style={{ marginLeft: "8px", fontSize: "11px" }}>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_9f6ebae7ae" />}{" "}{socketRttMs == null ? "—" : `${Math.round(socketRttMs)} ms`}</div>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_687ee05508" />}{" "}{latency.networkRttMs == null ? "—" : `${latency.networkRttMs.toFixed(1)} ms`}</div>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_7d0ffb0cee" />}{" "}{latency.jitterMs == null ? "—" : `${latency.jitterMs.toFixed(1)} ms`}</div>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_8e54383fcb" />}{" "}{latency.packetsLost == null ? "—" : `${latency.packetsLost}`}</div>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_b5dcd8bb4f" />}{" "}{latency.availableOutKbps == null ? "—" : `${Math.round(latency.availableOutKbps)} kbps`}</div>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_fa1da0b1bf" />}{" "}{latency.bitrateKbps == null ? "—" : `${latency.bitrateKbps.toFixed(1)} kbps`}</div>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_d50f2c549f" />}{" "}{latency.codec || "—"}</div>
        </div>
      </div>

      {/* Pipeline latency */}
      <div style={{ marginTop: "8px" }}>
        <div style={{ color: "var(--gryt-secondary-11)", fontWeight: "bold", marginBottom: "4px" }}>{i18n.t("shellFull.audioPipeline", { mode: modeLabel })}</div>
        <div style={{ marginLeft: "8px", fontSize: "11px" }}>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_dd82a506e6" />}{" "}{latency.contextBaseLatencyMs == null ? "—" : `${latency.contextBaseLatencyMs.toFixed(1)} ms`}</div>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_fd934d4d0b" />}{" "}{latency.contextOutputLatencyMs == null ? "—" : `${latency.contextOutputLatencyMs.toFixed(1)} ms`}</div>
          <div style={{ color: latency.rnnoiseBufferMs != null && latency.rnnoiseBufferMs > 50 ? "var(--gryt-warning-11)" : "inherit" }}>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_ead71485ce" />}{" "}{latency.rnnoiseBufferMs == null ? i18n.t("shellSecond.off") : `${latency.rnnoiseBufferMs.toFixed(1)} ms`}
          </div>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_ef1f453be5" />}{" "}{latency.localPipelineMs == null ? "—" : `${latency.localPipelineMs.toFixed(1)} ms`}</div>
        </div>
      </div>

      {/* Estimated totals */}
      <div style={{ marginTop: "8px" }}>
        <div style={{ color: "var(--gryt-success-11)", fontWeight: "bold", marginBottom: "4px" }}>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_7189ebcc32" />}</div>
        <div style={{ marginLeft: "8px", fontSize: "11px" }}>
          <div style={{ fontWeight: "bold" }}>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_a87cf11704" />}{" "}{latency.estimatedOneWayMs == null ? "—" : `${latency.estimatedOneWayMs.toFixed(1)} ms`}
          </div>
          <div>{<LocalizedText translationKey="shellFull.microphoneDebugOverlay_tsx_4dd4c60454" />}{" "}{latency.estimatedRoundTripMs == null ? "—" : `${latency.estimatedRoundTripMs.toFixed(1)} ms`}
          </div>
        </div>
      </div>
    </DebugOverlay>
  );
}
