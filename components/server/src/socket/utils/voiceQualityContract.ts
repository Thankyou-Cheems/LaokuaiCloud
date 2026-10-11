/** Minimal client-reported local-to-SFU metrics; never a peer-to-peer latency. */
export interface VoiceQualityPacketSample {
  /** Interval covered by counter deltas, not the age of the peer connection. */
  windowMs: number;
  packetsReceived: number;
  packetsLost: number;
}

export interface VoiceQualityReport {
  schemaVersion: 1;
  /** Increment on each media PeerConnection replacement, within this socket. */
  connectionGeneration: number;
  /** Strictly increasing within a generation. Restart at 1 for a newer one. */
  seq: number;
  /** Selected ICE candidate pair RTT, milliseconds, local client to SFU. */
  iceRttMs: number | null;
  /** Only remote-inbound audio associated with this client's audio sender. */
  uplink: {
    rttMs: number | null;
    sample: VoiceQualityPacketSample | null;
  } | null;
  /** Aggregate local inbound audio from the SFU, not a particular remote peer. */
  receive: {
    /** Maximum jitter among included inbound audio streams, milliseconds. */
    jitterMaxMs: number | null;
    sample: VoiceQualityPacketSample | null;
  } | null;
}

export interface VoiceQualityUpdate {
  schemaVersion: 1;
  /** Ephemeral socket identity assigned by the server; no secret user ID. */
  clientId: string;
  /** Null denotes unknown (expired, left, disconnected or connection replaced). */
  report: VoiceQualityReport | null;
  receivedAt: number;
  expiresAt: number;
}

/** The authenticated event envelope; token never enters the report/update. */
export interface VoiceQualityRequest {
  accessToken: string;
  report: VoiceQualityReport;
}

export const VOICE_QUALITY_REPORT_INTERVAL_MS = 2_000;
export const VOICE_QUALITY_TTL_MS = 8_000;
export const VOICE_QUALITY_MAX_RTT_MS = 60_000;
export const VOICE_QUALITY_MAX_JITTER_MS = 60_000;
export const VOICE_QUALITY_MIN_SAMPLE_WINDOW_MS = 500;
export const VOICE_QUALITY_MAX_SAMPLE_WINDOW_MS = 10_000;
/** Validation safety ceiling for aggregate samples, not a quality threshold. */
export const VOICE_QUALITY_MAX_PACKETS_PER_SECOND = 20_000;
