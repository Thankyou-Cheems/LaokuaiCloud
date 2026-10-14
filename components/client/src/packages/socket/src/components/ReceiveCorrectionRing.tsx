import { Tooltip } from "@gryt/ui/tooltip";

import {
  correctionArcPercent,
  correctionDirection,
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
  waitingForSpeech?: boolean;
  disabled?: boolean;
  labels?: Partial<ReceiveCorrectionLabels>;
  className?: string;
  diagnostic?: string;
  compact?: boolean;
}

/** Read-only compensation bar. The legacy name preserves existing call sites. */
export function ReceiveCorrectionRing({
  learnedAutoGainDb,
  appliedAutoGainDb,
  state = "unknown",
  waitingForSpeech = false,
  disabled = false,
  labels: labelOverrides,
  className = "",
  diagnostic,
  compact = false,
}: ReceiveCorrectionRingProps) {
  const labels = { ...RECEIVE_CORRECTION_LABELS_EN, ...labelOverrides };
  const learned = state === "unknown" ? null : finiteCorrectionDb(learnedAutoGainDb);
  const applied = state === "unknown" ? null : finiteCorrectionDb(appliedAutoGainDb);
  const snapshot = { learnedAutoGainDb: learned, appliedAutoGainDb: applied, state, waitingForSpeech, disabled };
  const direction = correctionDirection(learned);
  // A provisional zero means learning, never a claim that no compensation is needed.
  const learningZero = state === "learning" && direction === "neutral";
  const description = [labels.title, describeReceiveCorrection(snapshot, labels), diagnostic].filter(Boolean).join("; ");
  const status = disabled ? labels.disabled : waitingForSpeech ? labels.waitingForSpeech : labels[state];
  const heading = disabled ? labels.disabled : direction === "unknown" ? (state === "learning" ? labels.learning : labels.notMeasured)
    : learningZero || (state === "limited" && direction === "neutral") ? labels[state]
    : compact && direction === "neutral" ? labels.neutralCompact : labels[direction];
  const valueText = direction === "unknown" || learningZero ? "—" : formatCorrectionDb(learned, labels.notMeasured);
  const learnedText = formatCorrectionDb(learned, labels.notMeasured);
  const appliedText = formatCorrectionDb(applied, labels.notMeasured);
  const magnitude = correctionArcPercent(learned) * 0.5;
  const color = direction === "attenuation" ? "var(--gryt-neutral-11)" : "var(--gryt-accent-11)";

  const details = (
    <span className="block max-w-64">
      <span className="block font-medium">{labels.title}</span>
      <span className="block tabular-nums">{labels.learned}: {learnedText}</span>
      <span className="block tabular-nums">{labels.applied}: {appliedText}</span>
      <span className="block">{labels.state}: {labels[state]}</span>
      {waitingForSpeech && <span className="block whitespace-normal">{labels.waitingExplanation}</span>}
      {disabled && <span className="block whitespace-normal">{labels.disabledExplanation}</span>}
      {diagnostic && <span className="block whitespace-normal">{diagnostic}</span>}
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
        data-correction-waiting={waitingForSpeech || undefined}
        className={`inline-flex shrink-0 flex-col rounded outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--gryt-accent-9)] ${className}`}
        style={{ width: compact ? 88 : 144, gap: 1, color: "var(--gryt-neutral-12)" }}
      >
        <span aria-hidden="true" className="flex items-center justify-between gap-1 whitespace-nowrap" style={{ fontSize: compact ? 10 : 11, lineHeight: 1.1 }}>
          <span>{heading}</span>
          <span className="font-medium tabular-nums">{valueText}</span>
        </span>
        <svg width="100%" height={compact ? 6 : 8} viewBox="0 0 144 12" preserveAspectRatio="none" aria-hidden="true" data-correction-bar="learned">
          <path d="M2 6 H142" stroke="var(--gryt-neutral-6)" strokeWidth="4" strokeLinecap="round" />
          <path
            data-correction-fill={direction}
            d={`M72 6 H${72 + (direction === "attenuation" ? -1 : 1) * magnitude * 1.4}`}
            stroke={color}
            strokeWidth="4"
            strokeLinecap="round"
            opacity={direction === "unknown" || direction === "neutral" ? 0 : 1}
          />
          <path d="M72 1 V11" stroke="var(--gryt-neutral-11)" strokeWidth="1.5" />
          <path d="M2 3 V9 M142 3 V9" stroke="var(--gryt-neutral-9)" strokeWidth="1" />
        </svg>
        <span aria-hidden="true" className="flex justify-between gap-1 whitespace-nowrap text-[var(--gryt-neutral-11)]" style={{ fontSize: compact ? 9 : 10, lineHeight: 1.1 }}>
          {!compact && <span>−12</span>}
          <span data-correction-status="true">{status}</span>
          {!compact && <span>+18</span>}
        </span>
      </span>
    </Tooltip>
  );
}
