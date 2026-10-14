import { Alert, Divider, IconButton, Select, type SelectOption, Slider, Tabs, Tooltip } from "@gryt/ui";
import { voiceLog } from "@gryt/voice";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "@/i18n";
import { MAX_VOLUME_PERCENT } from "@/lib/audioVolume";
import { useSettings } from "@/settings";

import { PiArrowsClockwiseFill, PiWarningFill } from "../../../../lib/icons";
import { useMicrophone, useSFU,useSpeakers } from "../../../../lib/voiceFacade";
import { nativeVoiceEnabled, useNativeAudioStatus } from "../../../../lib/voiceFacade";
import { hasLiveAudioInput, readAnalyserDbfs } from "./audioObservation";
import { ReceiveLevelingSettings } from "./receiveLevelingSettings";
import { ReceivePriorSettings } from "./ReceivePriorSettings";
import { ReceiveVolumeSetting } from "./ReceiveVolumeSetting";
import { SettingGroup, SettingsContainer, SliderSetting, ToggleSetting } from "./settingsComponents";

/** Visualizer refresh rate. 30 fps is plenty for a level meter. */
const VISUALIZER_INTERVAL_MS = 33;

/**
 * Smoothing for the level indicator: an exponential moving average per sample.
 * Attack is fast so peaks show; release is slow so it does not flicker.
 */
const LEVEL_ATTACK = 0.6;
const LEVEL_RELEASE = 0.1;

/**
 * Interpolates between the 33 ms samples. Below the sample interval so the
 * indicator stays in step, and linear because an eased restart reads as stutter.
 */
const LEVEL_TRANSITION = "60ms linear";

/** The worklet exposes this same dBFS window for its legacy level meter. */
const GATE_MIN_DBFS = -100;
const GATE_MAX_DBFS = -30;

function dbfsToGateLevel(dbfs: number | null): number | null {
  if (dbfs === null || !Number.isFinite(dbfs)) return null;
  const bounded = Math.max(GATE_MIN_DBFS, Math.min(GATE_MAX_DBFS, dbfs));
  return ((bounded - GATE_MIN_DBFS) / (GATE_MAX_DBFS - GATE_MIN_DBFS)) * 100;
}

function formatDbfs(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${Math.round(value)} dBFS`;
}

/**
 * Drops options that repeat an id already in the list. The platform hands us a
 * device literally called "default" alongside the real one, colliding on key.
 */
function dedupeByValue(options: SelectOption[]): SelectOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = String(option.value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function AudioSettings() {
  return nativeVoiceEnabled ? <NativeAudioSettings/> : <LegacyAudioSettings/>;
}
function NativeAudioSettings() {
  const s=useSettings(), status=useNativeAudioStatus();
  const db=(rms:number|undefined)=>rms===undefined ? "—" : rms>0 ? `${(20*Math.log10(rms)).toFixed(1)} dBFS` : "−∞ dBFS";
  return <SettingsContainer>
    <p role="status">原生 AoO / Opus 音频通过社区 EasyTier 虚拟地址传输。使用 Windows 系统默认输入和输出设备；更改系统默认设备后重新进入房间。</p>
    <SettingGroup title="原生音频状态" description="实际 helper 遥测；仅反映本机采集及接收混音，不代表对方收到声音。">
      <p>状态：{status?.phase ?? "idle"} · 采集 {db(status?.captureRms)} · 播放混音 {db(status?.playbackRms)}</p>
      <p>发送包：{status?.packetsSent ?? 0} · 接收包：{status?.packetsReceived ?? 0} · 成员连接：{status?.peerCount ?? 0}</p>
    </SettingGroup>
    <ToggleSetting title="麦克风静音" description="停止向房间发送音频" checked={s.isMuted} onCheckedChange={s.setIsMuted}/>
    <ToggleSetting title="输出静音" description="静音所有接收音频并停止发送" checked={s.isDeafened} onCheckedChange={s.setIsDeafened}/>
    <SettingGroup title="输入模式" description="按键讲话沿用已保存的快捷键；频道强制 PTT 仍然有效。">
      <select aria-label="输入模式" value={s.inputMode} onChange={event=>s.setInputMode(event.target.value==="push_to_talk" ? "push_to_talk" : "voice_activity")}>
        <option value="voice_activity">持续采集（无降噪门限）</option><option value="push_to_talk">按键讲话</option>
      </select>
    </SettingGroup>
    <SliderSetting title="麦克风音量" description="原生输入增益" value={s.micVolume} onChange={s.setMicVolume} min={0} max={200}/>
    <ReceiveVolumeSetting/>
    <p>此原生版本尚未提供 RNNoise、自动增益、压缩器、噪声门限、自动接收均衡或浏览器麦克风试听。原有偏好保留，但本路径不应用这些效果。</p>
  </SettingsContainer>;
}
function LegacyAudioSettings() {
  const { t: tr } = useTranslation();
  const {
    micID,
    setMicID,
    outputDeviceID,
    setOutputDeviceID,
    micVolume,
    setMicVolume,
    noiseGateMode, setNoiseGateMode,
    noiseGate,
    setNoiseGate,
    noiseGateRelease,
    setNoiseGateRelease,
    setLoopbackEnabled,
    loopbackEnabled,
    rnnoiseEnabled,
    setRnnoiseEnabled,
    autoGainEnabled,
    setAutoGainEnabled,
    autoGainTargetDb,
    setAutoGainTargetDb,
    compressorEnabled,
    setCompressorEnabled,
    compressorAmount,
    setCompressorAmount,
    isMuted,
    setIsMuted,
    inputMode,
    setInputMode,
    micSilentWarningDismissed,
    setMicSilentWarningDismissed,
  } = useSettings();

  const { isConnected } = useSFU();
  const {
    devices,
    microphoneBuffer,
    getDevices,
    audioContext,
    getGateLevel,
    getAutomaticNoiseGateState,
    transmitSpeechActivityState,
  } =
    useMicrophone(true);
  const { devices: outputDevices, getOutputDevices } = useSpeakers();

  const muteStateBeforeLoopback = useRef<boolean | null>(null);

  const handleOutputDeviceChange = useCallback((id: string) => {
    setOutputDeviceID(id);
  }, [setOutputDeviceID]);

  const handleLoopbackChange = useCallback((enabled: boolean) => {
    voiceLog.divider(enabled ? "LOOPBACK ON" : "LOOPBACK OFF");
    voiceLog.step("LOOPBACK", 0, "Toggle requested", {
      enabled,
      isConnected,
      isMuted,
      hasAudioContext: !!audioContext,
      contextState: audioContext?.state,
      hasFinalAnalyser: !!microphoneBuffer.finalAnalyser,
      hasMuteGain: !!microphoneBuffer.muteGain,
      muteGainValue: microphoneBuffer.muteGain?.gain.value,
      noiseGateValue: microphoneBuffer.noiseGate?.gain.value,
      volumeGainValue: microphoneBuffer.volumeGain?.gain.value,
    });

    if (enabled) {
      muteStateBeforeLoopback.current = isMuted;
      setLoopbackEnabled(true);
      if (isConnected && !isMuted) {
        voiceLog.warn("LOOPBACK", "Auto-muting because connected to SFU");
        setIsMuted(true);
      }
    } else {
      setLoopbackEnabled(false);
    }
  }, [setLoopbackEnabled, isConnected, isMuted, setIsMuted, audioContext, microphoneBuffer]);

  useEffect(() => {
    if (loopbackEnabled || muteStateBeforeLoopback.current === null) return;
    voiceLog.info("LOOPBACK", "Restoring mute state", { was: muteStateBeforeLoopback.current });
    setIsMuted(muteStateBeforeLoopback.current);
    muteStateBeforeLoopback.current = null;
  }, [loopbackEnabled, setIsMuted]);

  useEffect(() => {
    if (!loopbackEnabled) return;
    const id = setInterval(() => {
      const buf = microphoneBuffer;
      const muteVal = buf.muteGain?.gain.value ?? null;
      // buf.noiseGate is only the fallback node; the real gate is the worklet.
      const gateVal = getGateLevel();
      const volVal = buf.volumeGain?.gain.value ?? null;

      const finalDbfs = readAnalyserDbfs(buf.finalAnalyser);
      const rawDbfs = hasLiveAudioInput(audioContext, buf.mediaStream) ? readAnalyserDbfs(buf.analyser) : null;

      voiceLog.info("LOOPBACK", "Periodic diagnostic", {
        contextState: audioContext?.state,
        muteGain: muteVal,
        noiseGate: gateVal,
        volumeGain: volVal,
        agcGain: buf.agcGain?.gain.value ?? null,
        rawDbfs,
        finalDbfs,
      });
    }, 2000);
    return () => clearInterval(id);
  }, [loopbackEnabled, microphoneBuffer, audioContext, getGateLevel]);

  const getRawVisualizerData = useCallback((): Uint8Array | null => {
    if (!microphoneBuffer.analyser) {
      return null;
    }

    const bufferLength = microphoneBuffer.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    microphoneBuffer.analyser.getByteFrequencyData(dataArray);
    return dataArray;
  }, [microphoneBuffer.analyser]);

  const [micRawVolume, setMicRawVolume] = useState(0);
  const [micRawDbfs, setMicRawDbfs] = useState<number | null>(null);
  const [micProcessedDbfs, setMicProcessedDbfs] = useState<number | null>(null);
  const [isMicLive, setIsMicLive] = useState(false);
  const [automaticGateState, setAutomaticGateState] = useState(() => getAutomaticNoiseGateState());
  const automaticGateStateRef = useRef(automaticGateState);
  automaticGateStateRef.current = automaticGateState;
  const [visualizerData, setVisualizerData] = useState<Uint8Array | null>(null);
  const devicesLoadedRef = useRef(false);

  // Smoothed copy of the detector level, for drawing only. Gate status comes from
  // the worklet in automatic mode and from the manual threshold otherwise.
  const [micDisplayVolume, setMicDisplayVolume] = useState(0);
  const micDisplayRef = useRef(0);

  useEffect(() => {
    if (!devicesLoadedRef.current) {
      devicesLoadedRef.current = true;
      getDevices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (devices.length > 0 && !micID) {
      const firstDevice = devices[0];
      setMicID(firstDevice.deviceId);
    }
  }, [devices, micID, setMicID]);

  // The automatic gate is owned by the AudioWorklet. Poll its read-only snapshot at a
  // low rate so the settings panel can show the current learned floor and decision without
  // moving the decision back to React or re-rendering at audio-block frequency.
  useEffect(() => {
    const read = () => setAutomaticGateState(getAutomaticNoiseGateState());
    read();
    const id = window.setInterval(read, 200);
    return () => window.clearInterval(id);
  }, [getAutomaticNoiseGateState, noiseGateMode, inputMode, audioContext]);

  useEffect(() => {
    const interval = setInterval(() => {
      // Prefer the level the gate itself decided on. Measuring separately here
      // made the meter and the gate disagree, so the threshold looked wrong.
      const liveInput = hasLiveAudioInput(audioContext, microphoneBuffer.mediaStream);
      let rawLevel: number | null = null;
      const rawDbfs = liveInput ? readAnalyserDbfs(microphoneBuffer.analyser) : null;
      const gateLevel = rawDbfs !== null ? getGateLevel() : null;
      setMicRawDbfs(rawDbfs);

      if (gateLevel !== null) {
        rawLevel = gateLevel;
      } else if (liveInput && microphoneBuffer.analyser) {
        rawLevel = dbfsToGateLevel(rawDbfs);
      }

      if (rawLevel !== null) {
        setMicRawVolume(Math.round(rawLevel));
        const gateOpen = noiseGateMode === "automatic"
          ? automaticGateStateRef.current.status === "available" && automaticGateStateRef.current.open
          : rawLevel >= noiseGate;
        setIsMicLive(gateOpen);

        // Rises quickly toward a peak, falls away slowly. Tracked in a ref so the
        // next sample continues from what was drawn, not what React committed.
        const previous = micDisplayRef.current;
        const weight = rawLevel > previous ? LEVEL_ATTACK : LEVEL_RELEASE;
        const smoothed = previous + (rawLevel - previous) * weight;

        micDisplayRef.current = smoothed;
        setMicDisplayVolume(smoothed);
      } else {
        setMicRawVolume(0);
        setIsMicLive(false);
        micDisplayRef.current = 0;
        setMicDisplayVolume(0);
      }

      // The monitor tap, not finalAnalyser: the meter shows what your processing
      // does to your voice, which has nothing to do with being muted.
      setMicProcessedDbfs(liveInput ? readAnalyserDbfs(microphoneBuffer.monitorAnalyser) : null);
      setVisualizerData(liveInput && rawDbfs !== null ? getRawVisualizerData() : null);
      // 30 fps. At 60 the panel re-rendered every 16 ms, which stutters badly on
      // weaker GPUs, and a level meter gains nothing from the extra frames.
    }, VISUALIZER_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      setVisualizerData(null);
      // Otherwise reopening the panel briefly shows the bar at whatever level
      // it held when it closed, then jumps.
      micDisplayRef.current = 0;
      setMicDisplayVolume(0);
    };
  }, [
    microphoneBuffer.analyser,
    microphoneBuffer.finalAnalyser,
    microphoneBuffer.monitorAnalyser,
    microphoneBuffer.mediaStream,
    audioContext,
    noiseGate,
    noiseGateMode,
    getRawVisualizerData,
    getGateLevel,
  ]);

  const AudioVisualizer = useMemo(() => {
    return () => {
      if (!visualizerData) return null;

      const bars = Array.from(visualizerData.slice(0, 32)).map((value, index) => {
        const height = Math.max(2, (value / 255) * 40);
        const isAboveThreshold = noiseGateMode === "automatic"
          ? automaticGateState.status === "available" && automaticGateState.open
          : micRawVolume >= noiseGate;
        return (
          <div
            key={index}
            style={{
              width: '3px',
              height: `${height}px`,
              backgroundColor: isAboveThreshold ? 'var(--gryt-success-9)' : 'var(--gryt-neutral-9)',
              marginRight: '1px',
              borderRadius: '1px',
            }}
          />
        );
      });

      return (
        <div className="flex items-end gap-0" style={{ height: '40px', padding: '4px' }}>
          {bars}
        </div>
      );
    };
  }, [visualizerData, micRawVolume, noiseGate, noiseGateMode, automaticGateState]);

  const isPTT = inputMode === "push_to_talk";
  const automaticGateStatus = automaticGateState.status !== "available"
    ? tr("pureVoice.autoGateWaiting")
    : automaticGateState.rmsDbfs === null
      ? tr("pureVoice.autoGateNoEvidence")
    : automaticGateState.open
      ? tr("pureVoice.autoGateOpen")
      : automaticGateState.openThresholdDbfs === null
        ? tr("pureVoice.autoGateLearning")
        : tr("pureVoice.autoGateClosed");

  return (
    <SettingsContainer>
      <h2>{tr("ui.audio")}</h2>

      <span className="font-bold text-gryt-muted">{tr("receiveVolume.common")}</span>
      <ReceiveVolumeSetting anchorId="output-volume" />
      <Divider />

      {/* First, because it decides what the rest of this section even shows:
          push to talk hides the noise gate below. It used to live further down
          the page in another section, so choosing it made the gate vanish with
          no visible cause. */}
      <SettingGroup anchorId="input-mode"
        title={tr("ui.inputMode")}
        description={tr("ui.voiceActivityTransmitsWheneverYouSpeakAboveThe")}
      >
        <Tabs
          value={inputMode}
          onValueChange={(v) =>
            setInputMode(v as "voice_activity" | "push_to_talk")
          }
        >
          {/* max-[339px]: tighter padding closes the 26px overflow at the
              300px Electron minimum without wrapping the sliding indicator. */}
          <Tabs.List aria-label={tr("ui.inputMode")} className="max-[339px]:gap-0.5">
            <Tabs.Tab value="voice_activity" className="max-[339px]:px-2">
              {tr("ui.voiceActivity")}
            </Tabs.Tab>
            <Tabs.Tab value="push_to_talk" className="max-[339px]:px-2">
              {tr("ui.pushToTalk")}
            </Tabs.Tab>
            <Tabs.Indicator />
          </Tabs.List>
        </Tabs>
      </SettingGroup>

      <Divider />

      {!audioContext && (
        <Alert severity="warning"><span className="inline-flex items-start gap-2"><PiWarningFill size={16} />{tr("ui.microphoneIsInitializingAudioLevelsAndNoiseGate")}</span></Alert>
      )}

      {/* ── Devices ── */}
      <span className="font-bold text-gryt-muted">{tr("ui.devices")}</span>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-medium">{tr("ui.microphone")}</span>
          <Tooltip title={tr("ui.refreshDeviceList")}>
            <IconButton tone="neutral" size="xsmall" onClick={getDevices}>
              <PiArrowsClockwiseFill size={12} />
            </IconButton>
          </Tooltip>
        </div>
        <Select
          value={micID || ""}
          onValueChange={(v) => setMicID(String(v))}
          placeholder={tr("ui.selectMicrophoneDevice")}
          options={dedupeByValue(
            devices.map((device, index) => ({
              label: device.label || tr("audio.microphoneDevice", { id: device.deviceId.slice(0, 8) }),
              // Before the permission prompt is answered every device comes back
              // with an empty id and label, so the label is no better a key.
              value: device.deviceId || `microphone-${index}`,
            })),
          )}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-medium">{tr("ui.speaker")}</span>
          <Tooltip title={tr("ui.refreshDeviceList")}>
            <IconButton tone="neutral" size="xsmall" onClick={getOutputDevices}>
              <PiArrowsClockwiseFill size={12} />
            </IconButton>
          </Tooltip>
        </div>
        <Select
          value={outputDeviceID || "default"}
          onValueChange={(v) => handleOutputDeviceChange(String(v))}
          placeholder={tr("ui.selectOutputDevice")}
          options={dedupeByValue([
            { label: tr("ui.default"), value: "default" },
            ...outputDevices.map((device, index) => ({
              label: device.label || tr("audio.speakerDevice", { id: device.deviceId.slice(0, 8) }),
              value: device.deviceId || `speaker-${index}`,
            })),
          ])}
        />
      </div>

      <Divider />

      {/* ── Input ── */}
      <span className="font-bold text-gryt-muted">{tr("ui.input")}</span>

      <SliderSetting
        anchorId="microphone-volume" title={tr("audio.microphoneVolume", { value: micVolume })}
        description={tr("ui.yourMicrophoneInputLevel100Unchanged2002x")}
        value={micVolume}
        onChange={setMicVolume}
        max={MAX_VOLUME_PERCENT}
      />

      {(
        <div className="flex flex-col gap-2">
          <span className="font-medium">{tr("ui.audioLevels")}</span>
          <div className="flex flex-col gap-1">
            <span className="text-gryt-muted">{tr("ui.audioSpectrumRawInput")}</span>
            <div style={{
              border: '1px solid var(--gryt-neutral-6)',
              borderRadius: '4px',
              padding: '4px',
              backgroundColor: 'var(--gryt-neutral-3)',
              minHeight: '48px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <AudioVisualizer />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-gryt-muted">
              {tr("ui.status")} {hasLiveAudioInput(audioContext, microphoneBuffer.mediaStream) ? tr("ui.active") : tr("audio.levelWaiting")}
              {loopbackEnabled && ` | ${tr("audio.playbackOn")}`}
            </span>
          </div>
          <div className="flex flex-col gap-1 text-sm" role="status" data-testid="audio-level-readout">
            <span className="text-gryt-muted">
              {tr("audio.levelReadout", {
                raw: formatDbfs(micRawDbfs),
                processed: formatDbfs(micProcessedDbfs),
              })}
            </span>
            <span className="text-gryt-muted">{tr("audio.levelBoundary")}</span>
          </div>
        </div>
      )}

      {!isPTT && <ToggleSetting anchorId="automatic-noise-gate" title={tr("pureVoice.autoGate")}
        description={tr("pureVoice.autoGateDescription")} checked={noiseGateMode === "automatic"}
        onCheckedChange={enabled => setNoiseGateMode(enabled ? "automatic" : "manual")} />}
      {!isPTT && noiseGateMode === "automatic" && <div
        className="flex flex-col gap-1 rounded-md border border-gryt-neutral-6 p-3 text-sm"
        role="status"
        data-testid="automatic-gate-observation"
      >
        <span className="font-medium">{tr("pureVoice.autoGateObservation")}</span>
        <span>{automaticGateStatus}</span>
        <span className="text-gryt-muted">
          {tr("pureVoice.autoGateFloor", { value: formatDbfs(automaticGateState.status === "available" ? automaticGateState.floorDbfs : null) })}
          {" · "}
          {tr("pureVoice.autoGateThreshold", {
            open: formatDbfs(automaticGateState.status === "available" ? automaticGateState.openThresholdDbfs : null),
            hold: formatDbfs(automaticGateState.status === "available" ? automaticGateState.holdThresholdDbfs : null),
          })}
        </span>
        <span>{tr("pureVoice.autoGateInput", { value: formatDbfs(automaticGateState.status === "available" ? automaticGateState.rmsDbfs : null) })}</span>
        <span className="text-gryt-muted">
          {tr("pureVoice.autoGateProbability", {
            value: automaticGateState.status === "available" && automaticGateState.probability !== null
              ? `${Math.round(automaticGateState.probability * 100)}%`
              : "—",
          })}
        </span>
        <span className="text-gryt-muted">{tr("pureVoice.autoGateThresholdNote")}</span>
      </div>}
      {!isPTT && noiseGateMode === "manual" && <div className="flex flex-col gap-2">
        <span className="font-medium">
          {tr("ui.noiseGate")} {noiseGate} / 100
        </span>
        <span className="text-gryt-muted">
          {tr("ui.audioBelowThisLevelWillBeMutedThe")}
        </span>

        <div style={{ position: 'relative' }}>
          <Slider
            value={noiseGate}
            onValueChange={(next) => setNoiseGate(Number(next))}
            max={100}
            min={0}
            step={1}
            style={{ position: 'relative', zIndex: 2 }}
          />

          {audioContext && micRawDbfs !== null && (
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: `${micDisplayVolume}%`,
                transform: 'translate(-50%, -50%)',
                width: '3px',
                height: '20px',
                backgroundColor: isMicLive ? 'var(--gryt-success-9)' : 'var(--gryt-neutral-9)',
                borderRadius: '2px',
                zIndex: 3,
                pointerEvents: 'none',
                transition: `left ${LEVEL_TRANSITION}, background-color 0.1s ease-out`,
              }}
            />
          )}

          {audioContext && micRawDbfs !== null && (
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '0',
                transform: 'translateY(-50%)',
                width: `${micDisplayVolume}%`,
                height: '8px',
                backgroundColor: isMicLive ? 'color-mix(in oklab, var(--gryt-success-9) 10%, transparent)' : 'var(--gryt-neutral-a4)',
                borderRadius: '4px',
                zIndex: 1,
                pointerEvents: 'none',
                transition: `width ${LEVEL_TRANSITION}, background-color 0.1s ease-out`,
              }}
            />
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-gryt-muted">
            {tr("audio.manualGateScale", {
              level: micRawDbfs === null ? "—" : micRawVolume,
              threshold: noiseGate,
            })}
          </span>
          <span className="font-medium" color={micRawVolume < noiseGate ? "red" : isMicLive ? "green" : "gray"}>
            {micRawDbfs === null ? tr("audio.levelWaiting") : micRawVolume < noiseGate ? tr("ui.gated") : isMicLive ? tr("ui.open") : tr("ui.quiet")}
          </span>
        </div>
        <span className="text-gryt-muted text-sm">{tr("audio.manualGateBoundary")}</span>

        <div className="flex flex-col gap-1 mt-2">
          <span className="font-medium">
            {tr("ui.release")} {noiseGateRelease} ms
          </span>
          <span className="text-gryt-muted">
            {tr("ui.howLongTheGateStaysOpenAfterYour")}
          </span>
          <Slider
            value={noiseGateRelease}
            onValueChange={(next) => setNoiseGateRelease(Number(next))}
            max={1000}
            min={0}
            step={10}
          />
        </div>
      </div>}

      <ToggleSetting anchorId="test-microphone"
        title={tr("ui.testMicrophone")}
        description={tr("ui.hearYourselfThroughYourSpeakersOrHeadphonesTo")}
        checked={loopbackEnabled}
        onCheckedChange={handleLoopbackChange}
      />

      <Divider />

      {/* ── Voice Processing ── */}
      <span className="font-bold text-gryt-muted">{tr("ui.voiceProcessing")}</span>
      <p className="text-gryt-muted text-sm">{tr("ui.voiceProcessingDescription")}</p>

      <ToggleSetting anchorId="noise-reduction"
        title={tr("ui.noiseReduction")}
        description={tr("ui.removesBackgroundNoiseBeforeYourVoiceIsSent")}
        checked={rnnoiseEnabled}
        onCheckedChange={setRnnoiseEnabled}
        statusText={rnnoiseEnabled
          ? tr(transmitSpeechActivityState.status === "available" && transmitSpeechActivityState.noiseSuppression?.status === "applied"
            ? "audio.rnnoiseActive" : "audio.rnnoisePending")
          : undefined
        }
      />

      <ToggleSetting anchorId="auto-gain"
        title={tr("ui.autoGain")}
        description={tr("ui.bringsYourMicrophoneToATargetVolumeQuiet")}
        checked={autoGainEnabled}
        onCheckedChange={setAutoGainEnabled}
        statusText={autoGainEnabled
          ? tr("audio.autoGainActive")
          : undefined
        }
      />

      {autoGainEnabled && (
        <SliderSetting
          anchorId="target-level" title={tr("audio.targetLevel", { value: autoGainTargetDb })}
          description={tr("ui.theVolumeYourVoiceIsBroughtToLower")}
          value={autoGainTargetDb}
          onChange={setAutoGainTargetDb}
          min={-30}
          max={-5}
          step={1}
        />
      )}

      <ToggleSetting anchorId="compressor"
        title={tr("ui.compressor")}
        description={tr("ui.narrowsTheGapBetweenYourQuietestAndLoudest")}
        checked={compressorEnabled}
        onCheckedChange={setCompressorEnabled}
        statusText={compressorEnabled
          ? tr("audio.compressorActive")
          : undefined
        }
      />

      {compressorEnabled && (
        <SliderSetting
          anchorId="compression-amount" title={tr("audio.compressionAmount", { value: compressorAmount })}
          description={tr("ui.howAggressivelyToCompressLowSubtleLevelingHigh")}
          value={compressorAmount}
          onChange={setCompressorAmount}
        />
      )}

      {/* The way back from the toast's "Don't show again". Reads as the warning
          rather than as the dismissal, so the switch is on by default and the
          stored flag is inverted here. */}
      <ToggleSetting anchorId="warn-me-when-my-microphone-goes-silent"
        title={tr("ui.warnMeWhenMyMicrophoneGoesSilent")}
        description={tr("ui.saysSoIfYourMicrophoneStopsSendingAnything")}
        checked={!micSilentWarningDismissed}
        onCheckedChange={(enabled) => setMicSilentWarningDismissed(!enabled)}
      />

      <Divider />

      <ReceiveLevelingSettings />
      <ReceivePriorSettings />

    </SettingsContainer>
  );
}
