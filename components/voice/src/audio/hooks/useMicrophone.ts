import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useVoiceCallbacks, useVoiceConfig } from "../../config";
import { getVoicePlatform } from "../../platform";
import { singletonHook } from "../../shared/singletonHook";
import type { AudioPipeline, NoiseSuppressor } from "../../types";
import { voiceLog } from "../../webrtc/hooks/voiceLogger";
import {
  createNoiseGateNode,
  ensureNoiseGateWorklet,
} from "../processors/noiseGateProcessor";
import { getIsBrowserSupported } from "../utils/mediaDevices";
import {
  AutomaticNoiseGateState,
  MicrophoneBufferType,
  MicrophoneInterface,
  MicrophoneUnavailableReason,
} from "../types/Microphone";
import {
  createMicrophoneBuffer,
  usePipelineControls,
} from "./microphonePipeline";
import {
  acquireMicrophoneForRequest,
  isSameMicrophoneRequest,
  type MicrophoneRequest,
} from "./microphoneRequest";
import { useSharedAudioContext } from "./useAudioContext";
import { useHandles } from "./useHandles";
import { usePushToTalkGate } from "./usePushToTalkGate";
import { TransmissionController, type TransmissionState } from "../lib/transmission";
import { loadTransmitCapture } from "../processors/transmitCaptureProcessor";
import { createTransmitEvidence } from "../processors/transmitSpeechProcessor";
import type { TransmitSpeechActivity, TransmitSpeechActivityState } from "../lib/transmitSpeechActivity";

/* Held open briefly after the last consumer, so a remount does not drop and
   re-acquire the device — which some drivers take a visible moment over. */
const MIC_RELEASE_GRACE_MS = 2_000;

/**
 * getUserMedia rejects with a DOMException whose `name` says what went wrong. Only the two
 * cases worth different advice are singled out; the rest is "failed".
 */
function classifyMicFailure(error: unknown): MicrophoneUnavailableReason {
  const name = (error as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "no-device";
  }
  return "failed";
}

/* Virtual and loopback inputs by name, because nothing in the API marks them.
   Picking one as the default captures silence or the user's own output. */
const VIRTUAL_INPUT_PATTERNS = [
  "blackhole",
  "soundflower",
  "loopback",
  "vb-audio",
  "vb-cable",
  "cable output",
  "virtual audio",
  "voicemeeter",
  "ishowu",
];

function isVirtualInput(device: MediaDeviceInfo): boolean {
  const label = device.label.toLowerCase();
  return VIRTUAL_INPUT_PATTERNS.some((pattern) => label.includes(pattern));
}

/**
 * The device to fall back on when nothing is stored, or the stored one has gone. Prefers
 * the first real input; if every input is virtual, the first is still returned.
 */
function pickDefaultDevice(
  devices: InputDeviceInfo[],
): InputDeviceInfo | undefined {
  return devices.find((d) => !isVirtualInput(d)) ?? devices[0];
}

/* Only ever compared for distinctness within one page. */
let nextHandleId = 0;

function createHandleId(): string {
  nextHandleId += 1;
  return `mic-handle-${nextHandleId}`;
}

function useCreateMicrophoneHook() {
  const { handles, addHandle, removeHandle, isLoaded } = useHandles();

  const config = useVoiceConfig();
  const speechEnabled = config.audio.transmitSpeechActivityEnabled === true;
  const automaticGate = config.audio.noiseGateMode === "automatic";
  const frameAlignedSpeech = speechEnabled || automaticGate;
  const { onAudioDeviceChanged } = useVoiceCallbacks();

  // Fixed for the lifetime of the process, so it is read once. `createAudioPipeline` being
  // present is what says this platform builds its own graph — see VoicePlatform.
  const platform = useMemo(() => getVoicePlatform(), []);
  const platformPipeline = platform.createAudioPipeline;
  const {
    deviceId: micID,
    loopback: loopbackEnabled,
    volume: micVolume,
    muted: isMuted,
    serverMuted: isServerMuted,
    noiseGate,
    noiseGateRelease,
    noiseSuppression: rnnoiseEnabled,
    inputMode,
    autoGain: { enabled: autoGainEnabled, targetDb: autoGainTargetDb },
    compressorEnabled,
    compressorAmount,
  } = config.audio;
  const { eSportsMode: eSportsModeEnabled } = config.connection;

  const effectiveMuted = isMuted || isServerMuted;
  const { audioContext, activate: activateAudioContext } =
    useSharedAudioContext();

  const [devices, setDevices] = useState<InputDeviceInfo[]>([]);
  const [micStream, setMicStream] = useState<MediaStream | undefined>(
    undefined,
  );
  const [currentDeviceId, setCurrentDeviceId] = useState<string | undefined>(
    micID,
  );
  const [micRecoveryTick, setMicRecoveryTick] = useState(0);

  const rnnoiseProcessorRef = useRef<NoiseSuppressor | null>(null);
  const [rnnoiseFault,setRnnoiseFault]=useState(false);
  const [rnnoiseNode, setRnnoiseNode] = useState<AudioWorkletNode | null>(null);
  const [noiseGateNode, setNoiseGateNode] = useState<AudioWorkletNode | null>(
    null,
  );
  const [registeredCaptureContext, setRegisteredCaptureContext] = useState<AudioContext>();
  const captureRegistered = registeredCaptureContext === audioContext && !!audioContext;
  const [rnnoiseRecoveryTick, setRnnoiseRecoveryTick] = useState(0);
  const [pipelineGeneration, setPipelineGeneration] = useState(0);
  const [transmissionState, setTransmissionState] = useState<TransmissionState>({ status: "disabled", generation: 0 });
  const suppressionRef = useRef(false);
  const [speechEvidenceNode,setSpeechEvidenceNode]=useState<AudioWorkletNode | null>(null);
  const transmitConnectedRef = useRef(false);
  const [transmitConnected, setTransmitConnectedState] = useState(false);
  const [speechActivity, setSpeechActivity] = useState<TransmitSpeechActivity>({ status: "unavailable", reason: "processor_loading" });
  const updateSpeechRef = useRef<() => void>(() => {});
  const previousSpeechEligibility=useRef(false);
  const previousFrameAlignedSpeech=useRef(frameAlignedSpeech);
  const freshRequest = useRef<(generation: number) => Promise<void>>(async () => { throw new Error("pipeline-unavailable"); });
  const pipelineWaiter = useRef<{ generation: number; resolve(): void; reject(error: Error): void } | null>(null);
  const transmission = useMemo(() => audioContext && !platformPipeline
    ? new TransmissionController(audioContext, generation => freshRequest.current(generation)) : undefined,
  [audioContext, platformPipeline]);
  const suppressionEnabled = config.audio.transmitSuppressionEnabled === true;

  useEffect(() => {
    if (!audioContext || !suppressionEnabled || captureRegistered) return;
    let cancelled = false;
    loadTransmitCapture(audioContext).then(() => { if (!cancelled) setRegisteredCaptureContext(audioContext); }, () => {
      if (!cancelled) transmission?.fail("capture-worklet-load-failed");
    });
    return () => { cancelled = true; };
  }, [audioContext, suppressionEnabled, captureRegistered, transmission]);
  useEffect(() => {
    if (!transmission) {
      return;
    }
    const unsubscribe = transmission.subscribe(state => { setTransmissionState(state); updateSpeechRef.current(); });
    return () => { unsubscribe(); transmission.dispose(); };
  }, [transmission]);
  useEffect(() => {
    transmission?.setEnabled(suppressionEnabled);
    if (suppressionEnabled) transmission?.setSuppressed(suppressionRef.current);
    else suppressionRef.current = false;
  }, [transmission, suppressionEnabled]);
  useEffect(() => {
    if (!transmission) setTransmissionState({ status: suppressionEnabled ? platformPipeline ? "failed" : "suspended" : "disabled",
      reason: suppressionEnabled ? platformPipeline ? "transmission-platform-unsupported" : "awaiting-audio-context" : undefined, generation: 0 });
  }, [transmission, suppressionEnabled, platformPipeline]);
  const [isGateOpen, setIsGateOpen] = useState(false);
  /* State, not just the ref below: the connect flow reads a ref, but anything
     rendering "still opening…" needs a re-render when it changes. */
  const [isAcquiring, setIsAcquiring] = useState(false);
  const [micUnavailable, setMicUnavailable] =
    useState<MicrophoneUnavailableReason | null>(null);
  const gateOpenRef = useRef(false);
  const gateLevelRef = useRef(0);
  const autoGateRef=useRef({open:false,floorDbfs:null as number|null,probability:null as number|null,
    rmsDbfs:null as number|null,openThresholdDbfs:null as number|null,holdThresholdDbfs:null as number|null});
  const autoGateObservedAtRef = useRef(0);

  const releaseMicTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micStreamRef = useRef<MediaStream | undefined>(undefined);
  /**
   * The request for the currently selected device. An older OS request may still settle,
   * but its result is stale and must never replace this one.
   */
  const micRequestRef = useRef<MicrophoneRequest | null>(null);

  micStreamRef.current = micStream;

  // "Can this client do voice at all", which is what every caller uses it for. A platform
  // supplying its own pipeline can, and asking a phone about `mediaDevices` is wrong.
  const isBrowserSupported = useMemo(
    () => !!platformPipeline || getIsBrowserSupported(),
    [platformPipeline],
  );

  const clearPendingMicRelease = useCallback(() => {
    if (releaseMicTimerRef.current) {
      clearTimeout(releaseMicTimerRef.current);
      releaseMicTimerRef.current = null;
    }
  }, []);

  const stopMicStream = useCallback((reason: string) => {
    const stream = micStreamRef.current;
    if (!stream) return;

    voiceLog.info("MIC", reason);
    stream.getTracks().forEach((track) => track.stop());
    micStreamRef.current = undefined;
    setMicStream(undefined);
  }, []);

  useEffect(() => {
    return () => {
      clearPendingMicRelease();
    };
  }, [clearPendingMicRelease]);

  // Initialize / tear down RNNoise AudioWorklet + Worker.
  useEffect(() => {
    if (!rnnoiseEnabled || !audioContext || (frameAlignedSpeech && (audioContext.sampleRate!==48000 || handles.length===0))) {
      if (rnnoiseProcessorRef.current) {
        voiceLog.info("MIC", "Destroying RNNoise processor");
        rnnoiseProcessorRef.current.destroy();
        rnnoiseProcessorRef.current = null;
      }

      setRnnoiseNode(null);
      return;
    }

    // Undefined where the platform denoises before the engine sees the stream, which is
    // every native platform. Not a failure — the same shape as rnnoiseEnabled being off.
    const processor = platform.createNoiseSuppressor?.();
    if (!processor) {
      setRnnoiseNode(null);
      return;
    }

    let cancelled = false;setRnnoiseFault(false);
    processor.setFailureListener?.(reason => {
      if(cancelled)return;
      if(frameAlignedSpeech) {setRnnoiseFault(true);processor.destroy();rnnoiseProcessorRef.current=null;setRnnoiseNode(null);setSpeechActivity({status:"unavailable",reason:"processor_failed"});}
      if(transmission?.enabled || transmission?.state.status === "recovering")transmission?.fail(reason);
    });

    rnnoiseProcessorRef.current = processor;

    voiceLog.step("MIC", 1, "Initializing RNNoise AudioWorklet + Worker", {
      sampleRate: audioContext.sampleRate,
    });

    processor
      .initialize(audioContext)
      .then(() => {
        if (cancelled) {
          processor.destroy();
          return;
        }

        processor.setEnabled(true);
        setRnnoiseNode(processor.getNode());
        voiceLog.ok("MIC", 1, "RNNoise AudioWorklet + Worker ready");
      })
      .catch((error) => {
        setRnnoiseFault(true);processor.destroy(); if(rnnoiseProcessorRef.current===processor)rnnoiseProcessorRef.current=null;
        voiceLog.fail(
          "MIC",
          1,
          "Failed to initialize RNNoise processor",
          error,
        );
      });

    return () => {
      cancelled = true;
      processor.destroy();
      rnnoiseProcessorRef.current = null;
      setRnnoiseNode(null);
    };
  }, [rnnoiseEnabled, audioContext, platform, rnnoiseRecoveryTick, frameAlignedSpeech, handles.length>0]);

  useEffect(() => {
    if(!frameAlignedSpeech || !audioContext || (audioContext.sampleRate!==44100 && audioContext.sampleRate!==48000) || platformPipeline || rnnoiseNode || handles.length===0
      || (rnnoiseEnabled && audioContext.sampleRate===48000 && !rnnoiseFault && platform.createNoiseSuppressor)) {setSpeechEvidenceNode(null);return;}
    let cancelled=false;let node: AudioWorkletNode | undefined;
    void createTransmitEvidence(audioContext).then(value=>{
      node=value;
      if(cancelled){value.port.postMessage("dispose");value.port.close();value.disconnect();return;}
      value.port.onmessage=event=>{if(event.data?.type==="fault") {setSpeechActivity({status:"unavailable",reason:"processor_failed"});transmission?.fail("speech-analyzer-failed");}};
      value.onprocessorerror=()=>{setSpeechActivity({status:"unavailable",reason:"processor_failed"});transmission?.fail("speech-processor-error");};
      setSpeechEvidenceNode(value);
    },()=>setSpeechActivity({status:"unavailable",reason:"processor_failed"}));
    return()=>{cancelled=true;node?.port.postMessage("dispose");node?.port.close();node?.disconnect();setSpeechEvidenceNode(null);};
  },[frameAlignedSpeech,audioContext,platformPipeline,rnnoiseNode,rnnoiseEnabled,rnnoiseFault,platform,handles.length>0,pipelineGeneration]);

  // Register the noise gate worklet. The gate has to run on the audio thread,
  // otherwise it stops applying whenever the window is hidden (GRYT-18).
  useEffect(() => {
    if (!audioContext) {
      setNoiseGateNode(null);
      return;
    }

    let cancelled = false;

    ensureNoiseGateWorklet(audioContext)
      .then(() => {
        if (cancelled) return;

        const node = createNoiseGateNode(audioContext);

        // Legacy noise-gate activity is separate from post-publication RNN speech activity.
        node.port.onmessage = (event) => {
          const data = event.data;
          if (!data) return;

          if(data.type==="automatic-gate") {
            autoGateRef.current={open:data.open===true,floorDbfs:data.floorDbfs,probability:data.probability,
              rmsDbfs:data.rmsDbfs,openThresholdDbfs:data.openThresholdDbfs,holdThresholdDbfs:data.holdThresholdDbfs};
            autoGateObservedAtRef.current = performance.now();return;
          }
          if (typeof data.level === "number") {
            gateLevelRef.current = data.level;
          }
          if (typeof data.open === "boolean") {
            gateOpenRef.current = data.open;
            // Only a state update on transitions — level arrives ~47x/sec and
            // must not re-render anything.
            setIsGateOpen((prev) => (prev === data.open ? prev : data.open));
          }
        };

        node.onprocessorerror=()=>{transmission?.fail("noise-gate-processor-error");setSpeechActivity({status:"unavailable",reason:"processor_failed"});};
        setNoiseGateNode(node);
        voiceLog.ok("MIC", 1, "Noise gate AudioWorklet ready");
      })
      .catch((error) => {
        if(frameAlignedSpeech) {transmission?.fail("speech-gate-worklet-load-failed");setSpeechActivity({status:"unavailable",reason:"processor_failed"});}
        // Legacy manual mode retains its main-thread fallback.
        voiceLog.fail(
          "MIC",
          1,
          "Failed to register noise gate worklet — falling back to main thread",
          error,
        );
      });

    return () => {
      cancelled = true;
      setNoiseGateNode(null);
      setIsGateOpen(false);
      gateOpenRef.current = false;
      gateLevelRef.current = 0;
      autoGateObservedAtRef.current = 0;
    };
  }, [audioContext]);

  /**
   * Level the gate is actually deciding on, 0-100. Returns null when the
   * worklet is unavailable so callers can fall back to their own measurement.
   */
  const getGateLevel = useCallback(
    () => (noiseGateNode ? gateLevelRef.current : null),
    [noiseGateNode],
  );

  /**
   * Legacy noise-gate eligibility, not a speech classification or remote delivery proof.
   * Null when the noise-gate worklet is unavailable.
   */
  const isTransmitting = noiseGateNode ? isGateOpen && !effectiveMuted
    && (!transmission || transmission.gate.gain.value > 0) : null;

  /**
   * The platform's own pipeline, on platforms that have one. Null on the web, where the Web
   * Audio graph below runs instead. The two paths never both exist.
   */
  const [ownPipeline, setOwnPipeline] = useState<AudioPipeline | null>(null);

  useEffect(() => {
    if (!platformPipeline || !micStream) {
      setOwnPipeline(null);
      return;
    }

    const pipeline = platformPipeline({
      source: micStream,
      noiseSuppression: rnnoiseEnabled,
      compressorAmount,
    });

    setOwnPipeline(pipeline);

    return () => {
      pipeline.destroy();
      setOwnPipeline(null);
    };
  }, [platformPipeline, micStream, rnnoiseEnabled, compressorAmount]);

  // Gain is pushed rather than rebuilt into, because rebuilding on every slider drag would
  // restart capture. Mute is pushed by usePushToTalkGate, which also owns the talk button.
  useEffect(() => {
    ownPipeline?.setGain(micVolume);
  }, [ownPipeline, micVolume]);

  freshRequest.current = async generation => {
    if (!transmission || !audioContext || !micStream) throw new Error("capture-unavailable");
    await loadTransmitCapture(audioContext);
    setRegisteredCaptureContext(audioContext);
    if (rnnoiseEnabled && !frameAlignedSpeech) {
      const reset = rnnoiseProcessorRef.current?.resetForTransmission;
      if (!reset) throw new Error("rnnoise-fresh-barrier-unavailable");
      await reset.call(rnnoiseProcessorRef.current);
    }
    if (transmission.generation !== generation) throw new Error("fresh-audio-superseded");
    await new Promise<void>((resolve, reject) => {
      pipelineWaiter.current?.reject(new Error("fresh-audio-superseded"));
      pipelineWaiter.current = { generation, resolve, reject };
      setPipelineGeneration(generation);
    });
    if (transmission.generation !== generation) throw new Error("fresh-audio-superseded");
    // New native nodes and their capture ACK precede reset of the shared model queue.
    if(frameAlignedSpeech && rnnoiseNode) {
      const reset=rnnoiseProcessorRef.current?.resetForTransmission;
      if(!reset)throw new Error("rnnoise-fresh-barrier-unavailable");
      await reset.call(rnnoiseProcessorRef.current);
      if(transmission.generation !== generation)throw new Error("fresh-audio-superseded");
    }
  };

  const microphoneBuffer = useMemo<MicrophoneBufferType>(() => {
    if (platformPipeline) {
      // Two fields out of eighteen; the rest stay undefined because they are AudioNodes and
      // there is no graph. Every field is optional, so the meters draw nothing.
      return ownPipeline
        ? { mediaStream: micStream, processedStream: ownPipeline.output }
        : {};
    }

    if (!audioContext) {
      voiceLog.info("MIC", "No AudioContext yet — pipeline deferred");
      return {};
    }

    voiceLog.step("PIPELINE", 1, "Creating audio processing pipeline", {
      hasMicStream: !!micStream,
      micStreamTracks: micStream?.getAudioTracks().length ?? 0,
      rnnoiseActive: !!rnnoiseNode,
    });

    transmission?.detach();
    let buf: MicrophoneBufferType;
    try { buf = createMicrophoneBuffer({
      audioContext,
      micStream,
      rnnoiseNode,
      speechEvidenceNode,
      frameAlignedSpeech,
      noiseGateNode,
      eSportsModeEnabled,
      autoGainEnabled,
      compressorEnabled,
      captureGeneration: captureRegistered ? pipelineGeneration : undefined,
    }); } catch {
      transmission?.fail("pipeline-build-failed");
      pipelineWaiter.current?.reject(new Error("pipeline-build-failed")); pipelineWaiter.current = null;
      return { publicationStream: transmission?.stream, mediaStream: micStream };
    }

    voiceLog.ok("PIPELINE", 1, "Audio pipeline created", {
      hasProcessedStream: !!buf.processedStream,
      processedStreamTracks: buf.processedStream?.getAudioTracks().length ?? 0,
    });

    return { ...buf, publicationStream: transmission?.stream };
  }, [
    platformPipeline,
    ownPipeline,
    audioContext,
    micStream,
    rnnoiseNode,
    speechEvidenceNode,
    frameAlignedSpeech,
    noiseGateNode,
    eSportsModeEnabled,
    autoGainEnabled,
    compressorEnabled,
    transmission,
    captureRegistered,
    pipelineGeneration,
  ]);

  const { getVisualizerData } = usePipelineControls({
    microphoneBuffer,
    audioContext,
    micStream,
    micVolume,
    isMuted: effectiveMuted,
    noiseGate,
    noiseGateRelease,
    loopbackEnabled,
    inputMode,
    eSportsModeEnabled,
    autoGainEnabled,
    autoGainTargetDb,
    compressorAmount,
  });

  const { isPttActive, setActive: setPushToTalkCore } = usePushToTalkGate(
    microphoneBuffer,
    audioContext,
    ownPipeline,
  );

  const speechUserEligible = () => frameAlignedSpeech && config.audio.transmitEligible === true && transmitConnectedRef.current
    && handles.length > 0 && !!micStream?.getAudioTracks().some(track => track.readyState === "live" && track.enabled)
    && !effectiveMuted && (inputMode !== "push_to_talk" || isPttActive.current)
    && !suppressionRef.current;
  const speechAllowed = () => speechUserEligible() && transmission?.state.publicationAllowed===true;
  updateSpeechRef.current = () => {
    const allowed=speechAllowed(); const now=audioContext?.currentTime??0;
    noiseGateNode?.parameters.get("eligible")?.setValueAtTime(allowed?1:0,now);
    rnnoiseNode?.parameters.get("evidenceEnabled")?.setValueAtTime(frameAlignedSpeech?1:0,now);
    rnnoiseNode?.parameters.get("allowed")?.setValueAtTime(allowed?1:0,now);
    speechEvidenceNode?.parameters.get("allowed")?.setValueAtTime(allowed?1:0,now);
    if(allowed!==previousSpeechEligibility.current) {
      previousSpeechEligibility.current=allowed;speechEvidenceNode?.port.postMessage("reset-history");
    }
    // The final audio-thread boundary applies permission plus its own actual mute/PTT/Squad gate.
    transmission?.setSpeechControl(frameAlignedSpeech,speechUserEligible(),(speaking,available)=>{
      setSpeechActivity(available?speaking:{status:"unavailable",reason:"processor_stale"});
    });
  };
  const setTransmitConnected = useCallback((connected: boolean) => {
    transmitConnectedRef.current=connected;
    if(!connected)setSpeechActivity(false);
    setTransmitConnectedState(connected);updateSpeechRef.current();
  },[]);
  useEffect(()=>{
    if(previousFrameAlignedSpeech.current && !frameAlignedSpeech) {
      pipelineWaiter.current?.reject(new Error("fresh-audio-superseded"));pipelineWaiter.current=null;
    }
    previousFrameAlignedSpeech.current=frameAlignedSpeech;
    const now=audioContext?.currentTime??0;
    noiseGateNode?.parameters.get("evidenceEnabled")?.setValueAtTime(frameAlignedSpeech?1:0,now);
    noiseGateNode?.parameters.get("automatic")?.setValueAtTime(automaticGate && inputMode!=="push_to_talk"?1:0,now);
    noiseGateNode?.port.postMessage("reset-evidence");
    speechEvidenceNode?.port.postMessage("reset-history");
    updateSpeechRef.current();
  },[frameAlignedSpeech,automaticGate,noiseGateNode,rnnoiseNode,speechEvidenceNode,audioContext,inputMode,micVolume,autoGainEnabled,autoGainTargetDb,compressorEnabled,compressorAmount,micID,micStream,pipelineGeneration]);
  useEffect(()=>{updateSpeechRef.current();},[config.audio.transmitEligible,transmitConnected,effectiveMuted,inputMode,transmissionState,handles.length]);
  useEffect(()=>{
    if(!frameAlignedSpeech || platformPipeline)return;
    const ended=()=>{setSpeechActivity(false);updateSpeechRef.current();};
    const tracks=micStream?.getAudioTracks()??[];tracks.forEach(track=>track.addEventListener?.("ended",ended));
    return()=>tracks.forEach(track=>track.removeEventListener?.("ended",ended));
  },[micStream,frameAlignedSpeech,platformPipeline]);
  const visibleSpeechActivity: TransmitSpeechActivity = !speechEnabled ? {status:"unavailable",reason:"disabled"}
    : platformPipeline ? {status:"unavailable",reason:"platform_unsupported"}
    : !audioContext ? {status:"unavailable",reason:"awaiting_audio_context"}
    : audioContext.sampleRate!==44100 && audioContext.sampleRate!==48000 ? {status:"unavailable",reason:"unsupported_sample_rate"}
    : transmissionState.status==="failed" ? {status:"unavailable",reason:"processor_failed"}
    : !noiseGateNode || !(rnnoiseNode || speechEvidenceNode) ? {status:"unavailable",reason:"processor_loading"}
    : !speechAllowed() ? false : speechActivity;
  const getAutomaticNoiseGateState = useCallback((): AutomaticNoiseGateState => !automaticGate?{status:"unavailable",reason:"manual_mode"}
    : platformPipeline?{status:"unavailable",reason:"platform_unsupported"}
    : !micStream?.getAudioTracks().some(track=>track.readyState==="live" && track.enabled && !track.muted)?{status:"unavailable",reason:"awaiting_input"}
    : audioContext?.state!=="running"?{status:"unavailable",reason:"context_suspended"}
    : audioContext && audioContext.sampleRate!==44100 && audioContext.sampleRate!==48000?{status:"unavailable",reason:"unsupported_sample_rate"}
    : transmissionState.status==="failed"?{status:"unavailable",reason:"processor_failed"}
    : !noiseGateNode || !(rnnoiseNode || speechEvidenceNode)?{status:"unavailable",reason:"processor_loading"}
    : !autoGateObservedAtRef.current || performance.now()-autoGateObservedAtRef.current>500?{status:"unavailable",reason:"stale_evidence"}
    : {status:"available",...autoGateRef.current,open:speechAllowed() && autoGateRef.current.open},
  [automaticGate,platformPipeline,audioContext,micStream,transmissionState.status,noiseGateNode,rnnoiseNode,speechEvidenceNode,config.audio.transmitEligible,transmitConnected,effectiveMuted,inputMode,handles.length]);
  const transmitSpeechActivity=visibleSpeechActivity===true;
  const transmitSpeechActivityState: TransmitSpeechActivityState = typeof visibleSpeechActivity==="boolean"
    ? {status:"available",source:rnnoiseNode?"rnnoise":"webrtc_rnn",noiseSuppression:!rnnoiseEnabled?{status:"disabled"}
      :rnnoiseNode?{status:"applied"}:{status:"unavailable",reason:audioContext?.sampleRate!==48000?"unsupported_sample_rate"
        :rnnoiseFault?"processor_failed":platformPipeline?"platform_unsupported":"processor_loading"}} : visibleSpeechActivity;

  const applyTransmissionReasons = useCallback(() => transmission?.setReasons({
    userMuted: isMuted, serverMuted: isServerMuted, pttRequired: inputMode === "push_to_talk", pttHeld: isPttActive.current,
  }), [transmission, isMuted, isServerMuted, inputMode, isPttActive]);
  useEffect(() => { applyTransmissionReasons(); }, [applyTransmissionReasons]);
  const setPushToTalkActive = useCallback((active: boolean) => {
    if (suppressionEnabled && platformPipeline) { ownPipeline?.setMuted(true); return; }
    setPushToTalkCore(active); applyTransmissionReasons(); updateSpeechRef.current();
  }, [setPushToTalkCore, applyTransmissionReasons, suppressionEnabled, platformPipeline, ownPipeline]);
  const setTransmitSuppressed = useCallback((suppressed: boolean) => {
    suppressionRef.current = suppressed; transmission?.setSuppressed(suppressed); updateSpeechRef.current();
  }, [transmission]);
  const retryTransmission = useCallback(() => {
    if (rnnoiseEnabled && transmission?.state.status === "failed") setRnnoiseRecoveryTick(value => value + 1);
    else transmission?.retry();
  }, [transmission, rnnoiseEnabled]);
  useEffect(() => {
    if (rnnoiseNode && transmission?.state.status === "failed") transmission.retry();
  }, [rnnoiseNode, transmission]);
  useEffect(() => {
    if (micStream && transmission?.state.reason === "capture-unavailable") transmission.retry();
  }, [micStream, transmission]);
  useEffect(() => {
    const buf = microphoneBuffer;
    let cancelled = false;
    if (transmission && buf.finalAnalyser) {
      if (buf.captureBarrier) buf.captureBarrier.onprocessorerror = () => transmission.fail("capture-processor-error");
      const fresh = buf.captureFresh ?? (suppressionEnabled ? new Promise<void>(() => {}) : Promise.resolve());
      transmission.attach(buf.finalAnalyser, fresh, buf.speechCarrier);
      void (buf.captureFresh ?? Promise.resolve()).then(() => {
        if (cancelled) return;
        const waiter = pipelineWaiter.current;
        if (waiter && waiter.generation === pipelineGeneration) { waiter.resolve(); pipelineWaiter.current = null; }
      });
    }
    return () => { cancelled = true; transmission?.detach(); buf.disposePipeline?.(); };
  }, [microphoneBuffer, transmission, pipelineGeneration]);
  useEffect(() => {
    if (suppressionEnabled && ownPipeline) ownPipeline.setMuted(true);
  }, [suppressionEnabled, ownPipeline, effectiveMuted, inputMode]);

  const getDevices = useCallback(async () => {
    if (platformPipeline) {
      // Nothing to enumerate. On a phone the input is a route picked by the OS, so running
      // the enumeration path would give an empty list, which is read as "no microphone".
      return;
    }

    if (!isBrowserSupported) return;

    try {
      const permissionStream = await platform.getMicrophone();

      try {
        permissionStream.getTracks().forEach((track) => track.stop());
      } catch {
        // ignore
      }

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioDevices = allDevices.filter(
        (d) => d.kind === "audioinput",
      ) as InputDeviceInfo[];

      setDevices(audioDevices);

      // Permission can be granted with nothing plugged in, so an empty list is
      // its own failure rather than a variant of "denied".
      setMicUnavailable(audioDevices.length > 0 ? null : "no-device");

      if (audioDevices.length > 0) {
        let selectedDeviceId = micID;

        const fallbackDeviceId = pickDefaultDevice(audioDevices)?.deviceId;

        if (
          selectedDeviceId &&
          !audioDevices.find((d) => d.deviceId === selectedDeviceId)
        ) {
          selectedDeviceId = fallbackDeviceId;
        } else if (!selectedDeviceId) {
          selectedDeviceId = fallbackDeviceId;
        }

        if (selectedDeviceId !== currentDeviceId) {
          setCurrentDeviceId(selectedDeviceId);
        }
      }
    } catch (error) {
      console.error("Error enumerating devices:", error);
      // The earliest and most reliable place to learn there is no usable microphone. The
      // acquisition path below never runs then, so denied permission used to look healthy.
      setMicUnavailable(classifyMicFailure(error));
    }
  }, [isBrowserSupported, currentDeviceId, micID]);

  useEffect(() => {
    if (micID && micID !== currentDeviceId) {
      setCurrentDeviceId(micID);
    }
  }, [micID, currentDeviceId]);

  // Re-enumerate when devices come and go, so plugging in headphones shows
  // them without reopening the app. useCamera does the same for video.
  useEffect(() => {
    if (!isBrowserSupported) return;
    if (!navigator.mediaDevices?.addEventListener) return;

    const handleDeviceChange = () => {
      voiceLog.info("MIC", "Input devices changed — re-enumerating");
      getDevices();
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange,
      );
    };
  }, [isBrowserSupported, getDevices]);

  useEffect(() => {
    if (handles.length > 0 && !currentDeviceId) {
      getDevices();
    }
  }, [handles.length, currentDeviceId, getDevices]);

  useEffect(() => {
    async function initializeDevice(deviceId: string | undefined) {
      // A platform with its own pipeline has no device list, so "no device id" is normal
      // rather than a race. It means the platform default, which is what no argument asks.
      if (!deviceId && !platformPipeline) {
        voiceLog.info("MIC", "No device ID — skipping initialization");
        // Not "no microphone". This runs during normal startup before enumeration has named
        // a device; getDevices and the acquisition failure below are the real signals.
        return;
      }

      const inFlight = micRequestRef.current;
      if (isSameMicrophoneRequest(inFlight, deviceId)) {
        voiceLog.info(
          "MIC",
          "A getUserMedia for this device is already in flight — reusing it",
        );
        return;
      }

      const request: MicrophoneRequest = { deviceId };
      micRequestRef.current = request;
      setIsAcquiring(true);
      voiceLog.step("MIC", 2, "Requesting getUserMedia", { deviceId });

      try {
        const result = await acquireMicrophoneForRequest(
          request,
          () => micRequestRef.current,
          (requestedDeviceId) => platform.getMicrophone(requestedDeviceId),
          (error) => {
            voiceLog.fail(
              "MIC",
              2,
              `getUserMedia failed for device ${deviceId}`,
              error,
            );
            voiceLog.step("MIC", "2b", "Trying fallback (default device)");
          },
        );

        if (result.status === "stale") {
          voiceLog.info(
            "MIC",
            `Ignoring microphone result for superseded device ${deviceId ?? "default"}`,
          );
          return;
        }

        if (result.status === "failed") {
          voiceLog.fail(
            "MIC",
            "2b",
            "Fallback getUserMedia also failed — no microphone!",
            result.fallbackError,
          );
          setMicUnavailable(classifyMicFailure(result.fallbackError));
          return;
        }

        const stream = result.stream;
        const tracks = stream.getAudioTracks();

        if (result.source === "fallback") {
          voiceLog.ok("MIC", "2b", "Fallback getUserMedia succeeded", {
            tracks: tracks.map((t) => ({
              id: t.id,
              label: t.label,
            })),
          });
        } else {
          voiceLog.ok("MIC", 2, "getUserMedia succeeded", {
            trackCount: tracks.length,
            tracks: tracks.map((t) => ({
              id: t.id,
              label: t.label,
              readyState: t.readyState,
            })),
          });
        }

        const previous = micStreamRef.current;
        if (previous && previous !== stream) {
          previous.getTracks().forEach((track) => track.stop());
        }

        micStreamRef.current = stream;
        setMicStream(stream);
        setMicUnavailable(null);

        // Reports rather than writes: the engine does not own the setting. Nothing
        // to report when no device was named — that is the default path.
        if (result.source === "selected" && deviceId && deviceId !== micID) {
          onAudioDeviceChanged?.(deviceId);
        }
      } finally {
        // A superseded request is not allowed to clear the busy flag for its replacement.
        if (micRequestRef.current === request) {
          micRequestRef.current = null;
          setIsAcquiring(false);
        }
      }
    }

    if (handles.length > 0) {
      clearPendingMicRelease();

      // Not on a platform that builds its own graph: `activate` constructs an AudioContext,
      // and on React Native that is a ReferenceError rather than a degraded pipeline.
      if (!platformPipeline) activateAudioContext();

      if (audioContext?.state === "suspended") {
        audioContext.resume().catch(() => {});
      }

      const existing = micStreamRef.current;
      const liveTrack = existing
        ?.getAudioTracks()
        .find((track) => track.readyState === "live");

      if (liveTrack) {
        // A live track isn't enough — it has to be the device the user picked,
        // otherwise selecting a new microphone silently keeps the old one.
        const activeDeviceId = liveTrack.getSettings().deviceId;

        // "default" is a moving target: it resolves to whatever the OS considers default, so
        // it cannot be compared by id. Only re-acquire when both ids are known and differ.
        const deviceMatches =
          !currentDeviceId ||
          currentDeviceId === "default" ||
          !activeDeviceId ||
          activeDeviceId === currentDeviceId;

        if (deviceMatches) {
          voiceLog.info(
            "MIC",
            `Active handles: ${handles.length} — keeping existing live microphone`,
          );
          return;
        }

        voiceLog.info(
          "MIC",
          `Selected device changed (${activeDeviceId} → ${currentDeviceId}) — re-acquiring`,
        );
        stopMicStream("Switching to the newly selected input device");
      }

      voiceLog.info(
        "MIC",
        `Active handles: ${handles.length} — initializing device`,
      );
      initializeDevice(currentDeviceId);
      return;
    }

    if (micRequestRef.current) {
      voiceLog.info("MIC", "No active handles — superseding pending microphone request");
      micRequestRef.current = null;
      setIsAcquiring(false);
    }

    if (!micStreamRef.current) return;

    // No handles means no call, including while hidden — a call still holds one. Special-
    // casing hidden kept the microphone open on an idle minimised app with the light on.
    clearPendingMicRelease();

    releaseMicTimerRef.current = setTimeout(() => {
      if (handles.length === 0) {
        stopMicStream("No active handles — releasing microphone");
      }
    }, MIC_RELEASE_GRACE_MS);

    return () => {
      clearPendingMicRelease();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    handles.length,
    currentDeviceId,
    micRecoveryTick,
    activateAudioContext,
    audioContext,
    clearPendingMicRelease,
    stopMicStream,
    platformPipeline,
  ]);

  useEffect(() => {
    if (!micStream || handles.length === 0) return;

    const tracks = micStream.getAudioTracks();
    if (tracks.length === 0) return;

    const checkInterval = setInterval(() => {
      const currentTracks = micStream.getAudioTracks();
      const hasLiveTracks =
        currentTracks.length > 0 &&
        currentTracks.some((track) => track.readyState === "live");

      if (!hasLiveTracks && handles.length > 0) {
        voiceLog.warn(
          "MIC",
          "Microphone tracks are no longer live — reinitializing",
        );
        setMicStream(undefined);
        micStreamRef.current = undefined;
        setMicRecoveryTick((value) => value + 1);
      }

      if (audioContext?.state === "suspended" && handles.length > 0) {
        audioContext.resume().catch(() => {});
      }
    }, 1000);

    return () => {
      clearInterval(checkInterval);
    };
  }, [micStream, handles.length, audioContext]);

  return {
    addHandle,
    removeHandle,
    microphoneBuffer,
    isBrowserSupported,
    devices,
    audioContext,
    isLoaded,
    getDevices,
    getVisualizerData,
    getGateLevel,
    getAutomaticNoiseGateState,
    isTransmitting,
    transmitSpeechActivity,
    transmitSpeechActivityState,
    setTransmitConnected,
    isPttActive,
    setPushToTalkActive,
    setTransmitSuppressed,
    retryTransmission,
    transmissionState,
    micUnavailable,
    isAcquiring,
  };
}

const init: MicrophoneInterface = {
  devices: [],
  isBrowserSupported: undefined,
  microphoneBuffer: {
    input: undefined,
    output: undefined,
    rawOutput: undefined,
    analyser: undefined,
    finalAnalyser: undefined,
    mediaStream: undefined,
    processedStream: undefined,
    muteGain: undefined,
    volumeGain: undefined,
    noiseGate: undefined,
    noiseGateWorklet: undefined,
    rnnoiseNode: undefined,
  },
  audioContext: undefined,
  addHandle: () => {},
  removeHandle: () => {},
  isLoaded: false,
  getDevices: async () => {},
  getVisualizerData: () => null,
  // Null until the gate worklet exists, so callers fall back to their own
  // measurement rather than treating "not transmitting" as fact.
  getGateLevel: () => null,
  getAutomaticNoiseGateState: () => ({status:"unavailable",reason:"manual_mode"}),
  isTransmitting: null,
  transmitSpeechActivity: false,
  transmitSpeechActivityState: { status: "unavailable", reason: "disabled" },
  setTransmitConnected: () => {},
  isPttActive: { current: false },
  setPushToTalkActive: () => {},
  setTransmitSuppressed: () => {},
  retryTransmission: () => {},
  transmissionState: { status: "disabled", generation: 0 },
  micUnavailable: null,
  isAcquiring: false,
};

const singletonMicrophone = singletonHook(init, useCreateMicrophoneHook);

export const useMicrophone = (shouldAccess: boolean = false) => {
  const mic = singletonMicrophone();
  const handleIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!shouldAccess) {
      if (handleIdRef.current) {
        mic.removeHandle(handleIdRef.current);
        handleIdRef.current = null;
      }

      return;
    }

    if (!handleIdRef.current) {
      const id = createHandleId();
      handleIdRef.current = id;
      mic.addHandle(id);
    }

    return () => {
      if (handleIdRef.current) {
        mic.removeHandle(handleIdRef.current);
        handleIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAccess]);

  return mic;
};
