export type ReceiveCorrectionState = "unknown" | "learning" | "stable" | "limited";

/** Receiver-local automatic gain only, excluding manual volume and compression. */
export interface ReceiveCorrectionSnapshot {
  readonly learnedAutoGainDb: number | null;
  readonly appliedAutoGainDb: number | null;
  readonly state: ReceiveCorrectionState;
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
}

export const RECEIVE_CORRECTION_LABELS_EN: Readonly<ReceiveCorrectionLabels> = Object.freeze({
  learned: "Long-term correction",
  applied: "Currently applied",
  notMeasured: "Not measured",
  state: "State",
  unknown: "Unknown",
  learning: "Learning",
  stable: "Stable",
  limited: "Limited",
  localOnly: "Local playback only",
  automaticOnly: "Automatic gain only; excludes manual volume and compression",
  boost: "Boost",
  attenuation: "Attenuation",
  neutral: "No correction",
});

export const RECEIVE_CORRECTION_LABELS_ZH: Readonly<ReceiveCorrectionLabels> = Object.freeze({
  learned: "长期校正",
  applied: "当前应用",
  notMeasured: "尚未测量",
  state: "状态",
  unknown: "未知",
  learning: "学习中",
  stable: "稳定",
  limited: "受限",
  localOnly: "仅影响本机播放",
  automaticOnly: "仅自动增益，不含手动音量和压缩器减益",
  boost: "提升",
  attenuation: "衰减",
  neutral: "无需校正",
});

const UNMEASURED: ReceiveCorrectionSnapshot = Object.freeze({
  learnedAutoGainDb: null,
  appliedAutoGainDb: null,
  state: "unknown",
});

/** Frozen Voice has no per-route gain telemetry. See RECEIVE-CORRECTION.md. */
export function readReceiveCorrection(): ReceiveCorrectionSnapshot {
  return UNMEASURED;
}

export function finiteCorrectionDb(value?: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Round only the displayed text; preserve the original telemetry elsewhere. */
export function formatCorrectionDb(value?: number | null, notMeasured = "Not measured"): string {
  const finite = finiteCorrectionDb(value);
  if (finite === null) return notMeasured;
  const rounded = finite.toFixed(1);
  if (Number(rounded) === 0) return "0.0 dB";
  return `${finite > 0 ? "+" : ""}${rounded} dB`;
}

/** The arc uses the frozen DSP's documented ±9 dB range, never clips the text. */
export function correctionArcPercent(value?: number | null): number {
  const finite = finiteCorrectionDb(value);
  return finite === null ? 0 : Math.min(100, Math.abs(finite) / 9 * 100);
}

export function describeReceiveCorrection(
  snapshot: ReceiveCorrectionSnapshot,
  labels: ReceiveCorrectionLabels = RECEIVE_CORRECTION_LABELS_EN,
): string {
  return [
    `${labels.learned}: ${formatCorrectionDb(snapshot.learnedAutoGainDb, labels.notMeasured)}`,
    `${labels.applied}: ${formatCorrectionDb(snapshot.appliedAutoGainDb, labels.notMeasured)}`,
    `${labels.state}: ${labels[snapshot.state]}`,
    labels.localOnly,
    labels.automaticOnly,
  ].join("; ");
}
