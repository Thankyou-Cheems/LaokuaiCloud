/** Frame-aligned model decision carried with final publication PCM; unavailable must never light an indicator. */
export type TransmitSpeechActivityState = { status: "available";
  source?: "rnnoise" | "webrtc_rnn";
  noiseSuppression?: {status:"applied" | "disabled" | "unavailable";
    reason?: "unsupported_sample_rate" | "processor_loading" | "processor_failed" | "platform_unsupported"};
} | {
  status: "unavailable";
  reason: "disabled" | "platform_unsupported" | "awaiting_audio_context" | "unsupported_sample_rate"
    | "processor_loading" | "processor_failed" | "processor_stale";
};
export type TransmitSpeechActivity = boolean | Exclude<TransmitSpeechActivityState, { status: "available" }>;

export const TRANSMIT_SPEECH_THRESHOLD = 0.95;
export const TRANSMIT_SPEECH_FRAME_MS = 10;
