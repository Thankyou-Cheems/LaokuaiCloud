import { useTranslation } from "@/i18n";
import { useReceiveCorrection } from "@/webRTC/src/components/ReceiveCorrectionAdapter";

import { readReceiveCorrection, RECEIVE_CORRECTION_LABELS_EN, RECEIVE_CORRECTION_LABELS_ZH } from "../../../../lib/receiveCorrection";
import { ReceiveCorrectionRing } from "./ReceiveCorrectionRing";

/** Receiver-local measurements, keyed by server identity and primary mic route. */
export function RemoteReceiveCorrection({ host, member, streamId }: { host?: string; member?: string; streamId?: string }) {
  const { i18n, t } = useTranslation();
  const measurement = useReceiveCorrection(host, member, streamId);
  const snapshot = measurement ? {
    learnedAutoGainDb: measurement.learnedAutoGainDb,
    appliedAutoGainDb: measurement.appliedAutoGainDb,
    state: measurement.status === "settled" ? "stable" as const : measurement.status === "unavailable" ? "unknown" as const : measurement.status,
  } : readReceiveCorrection();
  const reasonKeys = {
    noise_budget: "receiveCorrection.noiseBudget", gain_range: "receiveCorrection.gainRange",
    noise_evidence_missing: "receiveCorrection.noiseMissing", analyzer_unavailable: "receiveCorrection.analyzerUnavailable",
    unsupported_sample_rate: "receiveCorrection.unsupportedRate", association_ambiguous: "receiveCorrection.ambiguous",
    track_changed: "receiveCorrection.trackChanged", disabled: "receiveCorrection.disabled",
  } as const;
  const diagnostic = measurement?.limitReasons.map(reason => {
    const key = reasonKeys[reason];
    return key ? `${t(key)} (${reason})` : reason;
  }).join("; ");
  return <ReceiveCorrectionRing {...snapshot}
    diagnostic={diagnostic}
    labels={i18n.resolvedLanguage === "zh-CN" ? RECEIVE_CORRECTION_LABELS_ZH : RECEIVE_CORRECTION_LABELS_EN} />;
}
