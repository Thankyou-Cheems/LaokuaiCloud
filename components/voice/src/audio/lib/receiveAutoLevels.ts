export type ReceiveAutoLevelStatus = "learning" | "settled" | "limited" | "unavailable";
export type ReceiveAutoLevelLimitReason = "noise_budget" | "gain_range" | "noise_evidence_missing" |
  "analyzer_unavailable" | "unsupported_sample_rate" | "association_ambiguous" | "track_changed" | "disabled";
export interface ReceiveAutoLevelIdentity {
  participantId: string;
  receiverId: string;
  trackId: string;
  generation: number;
}
export interface ReceiveAutoLevelSnapshot extends ReceiveAutoLevelIdentity {
  sequence: number;
  audioTimeSeconds: number;
  status: ReceiveAutoLevelStatus;
  limitReasons: ReceiveAutoLevelLimitReason[];
  appliedAutoGainDb: number | null;
  learnedAutoGainDb: number | null;
  targetAutoGainDb: number | null;
  acceptedSpeechSeconds: number;
  speechWindowSeconds: number;
  estimatorReliability: "provisional" | "established" | "invalid";
  compressionGainReductionDb: number | null;
  speechLevelDbfs: number | null;
  priorRestoring: boolean;
  priorRejected: boolean;
  lastAcceptedSpeechAudioTimeSeconds: number | null;
}
export interface ReceiveAutoLevelBatch {
  kind: "receive-auto-levels";
  schemaVersion: 1;
  snapshots: ReceiveAutoLevelSnapshot[];
}
export const RECEIVE_AUTO_LEVEL_TELEMETRY_HZ = 5;
