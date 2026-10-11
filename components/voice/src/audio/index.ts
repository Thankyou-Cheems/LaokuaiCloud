// Capture, the pipeline, device enumeration and the level helpers. Keyboard handling that
// writes mute and deafen has no audio graph in it and belongs to the embedder.
export {
  CAMERA_FPS_OPTIONS,
  type CameraFps,
  type CameraQuality,
  QUALITY_CONSTRAINTS,
  useCamera,
} from "./hooks/useCamera";
export {
  type SharedAudioContextValue,
  useSharedAudioContext,
} from "./hooks/useAudioContext";
export { useDeviceEnumeration } from "./hooks/useDeviceEnumeration";
export { useHandles } from "./hooks/useHandles";
export {
  type NativeAudioCaptureState,
  useNativeAudioCapture,
} from "./hooks/useNativeAudioCapture";
export {
  type EncodedFrameCallback,
  type NativeScreenCaptureState,
  useNativeScreenCapture,
} from "./hooks/useNativeScreenCapture";
export { useMicrophone } from "./hooks/useMicrophone";
export type { TransmissionState } from "./lib/transmission";
export type { AutomaticNoiseGateState } from "./types/Microphone";
export type { TransmitSpeechActivityState } from "./lib/transmitSpeechActivity";
export { TRANSMIT_SPEECH_THRESHOLD, TRANSMIT_SPEECH_FRAME_MS } from "./lib/transmitSpeechActivity";
export { useSpeakers } from "./hooks/useSpeakers";
export type { ReceiveLevelingState, ReceiveAudioRole, ReceiveStreamControl } from "./lib/receiveGraph";
export { RECEIVE_AUTO_LEVEL_TELEMETRY_HZ } from "./lib/receiveAutoLevels";
export { RECEIVE_LEVEL_PRIOR_SCHEMA, validateReceiveLevelPrior, exportReceiveLevelPrior } from "./lib/receiveLevelPrior";
export type { ReceiveLevelPrior } from "./lib/receiveLevelPrior";
export type { ReceiveAutoLevelStatus, ReceiveAutoLevelLimitReason, ReceiveAutoLevelIdentity,
  ReceiveAutoLevelSnapshot, ReceiveAutoLevelBatch } from "./lib/receiveAutoLevels";
export { type LatencyBreakdown, useVoiceLatency } from "./hooks/useVoiceLatency";
export { type PushToTalkGate, usePushToTalkGate } from "./hooks/usePushToTalkGate";
export {
  estimateBitrate,
  EXPERIMENTAL_FPS_OPTIONS,
  type ScreenShareFps,
  type ScreenShareQuality,
  STANDARD_FPS_OPTIONS,
  useScreenShare,
} from "./hooks/useScreenShare";
export { CENTRED, detectFraming, type Framing } from "./lib/faceFraming";
export { getIsBrowserSupported } from "./utils/mediaDevices";
export {
  getCurrentVolume,
  getVolumeDb,
  isSpeaking,
  volumeToLevel,
} from "./utils/speaking";
