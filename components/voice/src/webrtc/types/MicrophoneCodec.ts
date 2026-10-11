/** Explicit microphone encoding policy. Omission preserves the legacy library policy. */
export interface MicrophoneCodecProfile {
  codec: "opus";
  maxBitrateBps: number;
  packetTimeMs: 10 | 20 | 40 | 60;
  channels: 1;
  vbr: boolean;
  dtx: boolean;
  fec: boolean;
}

export interface MicrophoneCodecState {
  status: "idle" | "applying" | "configured" | "degraded";
  reason: "invalid_profile" | "set_parameters_failed" | "bitrate_readback_mismatch" |
    "remote_offer_profile_mismatch" | "opus_not_negotiated" | "profile_changed_reconnect_required" |
    "bitrate_below_opus_minimum" | null;
  requested: MicrophoneCodecProfile | null;
  effectiveMaxBitrateBps: number | null;
  remoteMaxAverageBitrateBps: number | null;
  limitedBy: ("channel_bitrate" | "remote_bitrate")[];
  senderMaxBitrateBps: number | null;
  remoteOfferMatches: boolean | null;
  /** Configuration evidence cannot verify emitted RTP, DTX savings or FEC recovery. */
  rtpVerified: false;
  errorName: string | null;
}

export const idleMicrophoneCodecState = (): MicrophoneCodecState => ({
  status: "idle", reason: null, requested: null, senderMaxBitrateBps: null,
  effectiveMaxBitrateBps: null, remoteMaxAverageBitrateBps: null, limitedBy: [],
  remoteOfferMatches: null, rtpVerified: false, errorName: null,
});
