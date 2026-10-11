import { Tooltip } from "@gryt/ui/tooltip";

import {
  correctionArcPercent,
  describeReceiveCorrection,
  finiteCorrectionDb,
  formatCorrectionDb,
  RECEIVE_CORRECTION_LABELS_EN,
  type ReceiveCorrectionLabels,
  type ReceiveCorrectionState,
} from "../../../../lib/receiveCorrection";

export interface ReceiveCorrectionRingProps {
  /** Actual receiver telemetry; never derive from RMS, targets or manual volume. */
  learnedAutoGainDb?: number | null;
  /** Automatic gain currently applied by the DSP, separate from learned gain. */
  appliedAutoGainDb?: number | null;
  state?: ReceiveCorrectionState;
  labels?: Partial<ReceiveCorrectionLabels>;
  className?: string;
  diagnostic?: string;
  compact?: boolean;
}

/** Read-only display. Rendering this ring does not enable or adjust the DSP. */
export function ReceiveCorrectionRing({
  learnedAutoGainDb,
  appliedAutoGainDb,
  state = "unknown",
  labels: labelOverrides,
  className = "",
  diagnostic,
  compact = false,
}: ReceiveCorrectionRingProps) {
  const labels = { ...RECEIVE_CORRECTION_LABELS_EN, ...labelOverrides };
  const learned = finiteCorrectionDb(learnedAutoGainDb);
  const applied = finiteCorrectionDb(appliedAutoGainDb);
  const snapshot = { learnedAutoGainDb: learned, appliedAutoGainDb: applied, state };
  const description = [describeReceiveCorrection(snapshot, labels), diagnostic].filter(Boolean).join("; ");
  const direction = learned === null ? "unknown" : learned > 0 ? "boost" : learned < 0 ? "attenuation" : "neutral";
  const arc = correctionArcPercent(learned);
  const learnedText = formatCorrectionDb(learned, labels.notMeasured);
  const appliedText = formatCorrectionDb(applied, labels.notMeasured);
  const color = direction === "attenuation" ? "var(--gryt-neutral-11)" : "var(--gryt-accent-11)";

  const details = (
    <span className="block max-w-64">
      <span className="block tabular-nums">{labels.learned}: {learnedText}</span>
      <span className="block tabular-nums">{labels.applied}: {appliedText}</span>
      <span className="block">{labels.state}: {labels[state]}</span>
      {diagnostic && <span className="block whitespace-normal">{diagnostic}</span>}
      <span className="block text-gryt-muted">{direction === "unknown" ? labels.notMeasured : labels[direction]}</span>
      <span className="mt-1 block text-gryt-muted">{labels.localOnly}</span>
      <span className="block whitespace-normal text-gryt-muted">{labels.automaticOnly}</span>
    </span>
  );

  return (
    <Tooltip title={details}>
    <span
      role="img"
      tabIndex={0}
      aria-label={description}
      title={description}
      data-receive-correction={direction}
      data-correction-state={state}
      className={`relative inline-flex items-center gap-1.5 rounded outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--gryt-accent-9)] ${className}`}
    >
      <svg width={compact ? 20 : 32} height={compact ? 20 : 32} viewBox="-1 -5 32 36" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path d="M15 3 A12 12 0 0 0 15 27" fill="none" stroke="var(--gryt-neutral-6)" strokeWidth="2.5" />
        <path d="M15 3 A12 12 0 0 1 15 27" fill="none" stroke="var(--gryt-neutral-6)" strokeWidth="2.5" />
        <path
          data-correction-arc="attenuation"
          d="M15 3 A12 12 0 0 0 15 27"
          pathLength="100"
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="100 100"
          strokeDashoffset={direction === "attenuation" ? 100 - arc : 100}
          className="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
          opacity={direction === "attenuation" ? 0.8 : 0}
        />
        <path
          data-correction-arc="boost"
          d="M15 3 A12 12 0 0 1 15 27"
          pathLength="100"
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="100 100"
          strokeDashoffset={direction === "boost" ? 100 - arc : 100}
          className="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
          opacity={direction === "boost" ? 0.8 : 0}
        />
        <text x="15" y="0" textAnchor="middle" fill="var(--gryt-neutral-11)" fontSize="6">0</text>
        <path d="M15 2 V5" stroke="var(--gryt-neutral-11)" strokeWidth="1.5" />
        <text x="15" y="19" textAnchor="middle" fill="var(--gryt-neutral-12)" fontSize="14" fontWeight="500">
          {direction === "unknown" ? "?" : direction === "boost" ? "+" : direction === "attenuation" ? "−" : "0"}
        </text>
      </svg>
      {!compact && <span aria-hidden="true" className="inline-flex flex-col leading-tight">
        {!compact && <span className="text-[10px] text-[var(--gryt-neutral-11)]">{labels.learned}</span>}
        <span className="text-[11px] font-medium tabular-nums text-[var(--gryt-neutral-12)]">{learnedText}</span>
      </span>}
    </span>
    </Tooltip>
  );
}
