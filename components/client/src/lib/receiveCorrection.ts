export type ReceiveCorrectionState = "unknown" | "learning" | "stable" | "limited";

/** Receiver-local automatic gain only, excluding manual volume and compression. */
export interface ReceiveCorrectionSnapshot {
  readonly learnedAutoGainDb: number | null;
  readonly appliedAutoGainDb: number | null;
  readonly state: ReceiveCorrectionState;
  readonly waitingForSpeech?: boolean;
  readonly disabled?: boolean;
}

export interface ReceiveCorrectionLabels {
  learned: string;
  applied: string;
  notMeasured: string;
  state: string;
  unknown: string;
  learning: string;
  stable: string;
  limited: string;
  localOnly: string;
  automaticOnly: string;
  boost: string;
  attenuation: string;
  neutral: string;
  neutralCompact: string;
  title: string;
  waitingForSpeech: string;
  waitingExplanation: string;
  disabled: string;
  disabledExplanation: string;
}

export const RECEIVE_CORRECTION_LABELS_EN: Readonly<ReceiveCorrectionLabels> = Object.freeze({
  learned: "Learned compensation",
  applied: "Currently applied",
  notMeasured: "Not measured",
  state: "State",
  unknown: "Unknown",
  learning: "Learning",
  stable: "Stable",
  limited: "Limited",
  localOnly: "Local playback only",
  automaticOnly: "Automatic gain only; excludes manual volume and compression",
  boost: "Increase",
  attenuation: "Decrease",
  neutral: "No compensation",
  neutralCompact: "No change",
  title: "Loudness balance",
  waitingForSpeech: "Waiting for speech",
  waitingExplanation: "Positive compensation pauses between speech; the learned value is retained",
  disabled: "Disabled",
  disabledExplanation: "Automatic compensation is off; manual volume still applies independently",
});

export const RECEIVE_CORRECTION_LABELS_ZH: Readonly<ReceiveCorrectionLabels> = Object.freeze({
  learned: "已学习补偿",
  applied: "当前应用",
  notMeasured: "尚未测量",
  state: "状态",
  unknown: "未知",
  learning: "学习中",
  stable: "稳定",
  limited: "受限",
  localOnly: "仅影响本机播放",
  automaticOnly: "仅自动增益，不含手动音量和压缩器减益",
  boost: "增大",
  attenuation: "减小",
  neutral: "无需补偿",
  neutralCompact: "无需补偿",
  title: "响度均衡",
  waitingForSpeech: "等待讲话",
  waitingExplanation: "停说时暂停增大补偿，保留已学习的数值",
  disabled: "已停用",
  disabledExplanation: "自动补偿已关闭，手动音量仍独立生效",
});

const UNMEASURED: ReceiveCorrectionSnapshot = Object.freeze({
  learnedAutoGainDb: null,
  appliedAutoGainDb: null,
  state: "unknown",
});

/** Missing or unbound receiver telemetry must remain unknown. */
export function readReceiveCorrection(): ReceiveCorrectionSnapshot {
  return UNMEASURED;
}

export function finiteCorrectionDb(value?: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Initial controller zeros are not measurements. No DSP/manual-volume changes. */
export function receiveCorrectionFromMeasurement(measurement?: {
  learnedAutoGainDb: number | null;
  appliedAutoGainDb: number | null;
  status: "learning" | "settled" | "limited" | "unavailable";
  speechLevelDbfs: number | null;
  priorRestoring: boolean;
  audioTimeSeconds: number;
  lastAcceptedSpeechAudioTimeSeconds: number | null;
  limitReasons?: readonly string[];
}): ReceiveCorrectionSnapshot {
  if (!measurement) return readReceiveCorrection();
  const measured = measurement.status !== "unavailable" &&
    (finiteCorrectionDb(measurement.speechLevelDbfs) !== null || measurement.priorRestoring);
  const learned = measured ? finiteCorrectionDb(measurement.learnedAutoGainDb) : null;
  const lastSpeech = finiteCorrectionDb(measurement.lastAcceptedSpeechAudioTimeSeconds);
  const audioTime = finiteCorrectionDb(measurement.audioTimeSeconds);
  return {
    learnedAutoGainDb: learned,
    appliedAutoGainDb: measured ? finiteCorrectionDb(measurement.appliedAutoGainDb) : null,
    state: measurement.status === "settled" ? "stable" : measurement.status === "unavailable" ? "unknown" : measurement.status,
    waitingForSpeech: learned !== null && learned >= 0.05 && lastSpeech !== null &&
      audioTime !== null && audioTime - lastSpeech > 0.25,
    disabled: measurement.status === "unavailable" && Boolean(measurement.limitReasons?.includes("disabled")),
  };
}

export function correctionDirection(value?: number | null): "unknown" | "boost" | "attenuation" | "neutral" {
  const finite = finiteCorrectionDb(value);
  if (finite === null) return "unknown";
  const rounded = Number(finite.toFixed(1));
  return rounded > 0 ? "boost" : rounded < 0 ? "attenuation" : "neutral";
}

/** Round only the displayed text; preserve the original telemetry elsewhere. */
export function formatCorrectionDb(value?: number | null, notMeasured = "Not measured"): string {
  const finite = finiteCorrectionDb(value);
  if (finite === null) return notMeasured;
  const rounded = finite.toFixed(1);
  if (Number(rounded) === 0) return "0.0 dB";
  return `${finite > 0 ? "+" : ""}${rounded} dB`;
}

/** Controller bounds are -12/+18 dB; visual saturation never clips the text. */
export function correctionArcPercent(value?: number | null): number {
  const finite = finiteCorrectionDb(value);
  return finite === null ? 0 : Math.min(100, Math.abs(finite) / (finite < 0 ? 12 : 18) * 100);
}

export function describeReceiveCorrection(
  snapshot: ReceiveCorrectionSnapshot,
  labels: ReceiveCorrectionLabels = RECEIVE_CORRECTION_LABELS_EN,
): string {
  return [
    `${labels.learned}: ${formatCorrectionDb(snapshot.learnedAutoGainDb, labels.notMeasured)}`,
    `${labels.applied}: ${formatCorrectionDb(snapshot.appliedAutoGainDb, labels.notMeasured)}`,
    `${labels.state}: ${labels[snapshot.state]}`,
    ...(snapshot.waitingForSpeech ? [labels.waitingForSpeech, labels.waitingExplanation] : []),
    ...(snapshot.disabled ? [labels.disabled, labels.disabledExplanation] : []),
    labels.localOnly,
    labels.automaticOnly,
  ].join("; ");
}
