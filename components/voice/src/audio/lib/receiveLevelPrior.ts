import type { ReceiveAutoLevelSnapshot } from "./receiveAutoLevels";

/** Persist only speech evidence; never serialize audio or transient protection state. */
export const RECEIVE_LEVEL_PRIOR_SCHEMA = "gryt-receive-level-v2" as const;
export interface ReceiveLevelPrior {
  schemaVersion: 1;
  processorSchema: typeof RECEIVE_LEVEL_PRIOR_SCHEMA;
  learnedGainDb: number;
  speechLevelDbfs: number;
  effectiveSpeechSeconds: number;
  lastVerifiedUnixMs: number;
}

/** Copy validated scalars so later mutations of a cache object cannot affect the graph. */
export function validateReceiveLevelPrior(value: unknown): ReceiveLevelPrior | undefined {
  if (!value || typeof value !== "object") return;
  const p = value as ReceiveLevelPrior;
  if (p.schemaVersion !== 1 || p.processorSchema !== RECEIVE_LEVEL_PRIOR_SCHEMA ||
    !Number.isFinite(p.learnedGainDb) || p.learnedGainDb < -12 || p.learnedGainDb > 18 ||
    !Number.isFinite(p.speechLevelDbfs) || p.speechLevelDbfs < -84 || p.speechLevelDbfs > 24 ||
    !Number.isFinite(p.effectiveSpeechSeconds) || p.effectiveSpeechSeconds < 5 || p.effectiveSpeechSeconds > 1e9 ||
    !Number.isSafeInteger(p.lastVerifiedUnixMs) || p.lastVerifiedUnixMs < 0) return;
  return { schemaVersion: 1, processorSchema: RECEIVE_LEVEL_PRIOR_SCHEMA,
    learnedGainDb: p.learnedGainDb, speechLevelDbfs: p.speechLevelDbfs,
    effectiveSpeechSeconds: p.effectiveSpeechSeconds, lastVerifiedUnixMs: p.lastVerifiedUnixMs };
}

/** Caller must also require new accepted speech for this binding before renewing its TTL. */
export function exportReceiveLevelPrior(snapshot: ReceiveAutoLevelSnapshot, nowUnixMs: number): ReceiveLevelPrior | undefined {
  if (snapshot.status === "unavailable" || snapshot.priorRestoring || snapshot.estimatorReliability !== "established" ||
    snapshot.speechWindowSeconds < 5 || snapshot.learnedAutoGainDb === null || snapshot.targetAutoGainDb === null ||
    snapshot.speechLevelDbfs === null || snapshot.lastAcceptedSpeechAudioTimeSeconds === null ||
    !Number.isFinite(snapshot.audioTimeSeconds) || !Number.isFinite(snapshot.lastAcceptedSpeechAudioTimeSeconds) ||
    snapshot.audioTimeSeconds - snapshot.lastAcceptedSpeechAudioTimeSeconds < 0 ||
    snapshot.audioTimeSeconds - snapshot.lastAcceptedSpeechAudioTimeSeconds > 1 ||
    Math.abs(snapshot.learnedAutoGainDb - snapshot.targetAutoGainDb) > 0.5) return;
  return validateReceiveLevelPrior({ schemaVersion: 1, processorSchema: RECEIVE_LEVEL_PRIOR_SCHEMA,
    learnedGainDb: snapshot.learnedAutoGainDb, speechLevelDbfs: snapshot.speechLevelDbfs,
    effectiveSpeechSeconds: snapshot.acceptedSpeechSeconds, lastVerifiedUnixMs: nowUnixMs });
}
