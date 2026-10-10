import { useTranslation } from "@/i18n";

import { readReceiveCorrection, RECEIVE_CORRECTION_LABELS_EN, RECEIVE_CORRECTION_LABELS_ZH } from "../../../../lib/receiveCorrection";
import { ReceiveCorrectionRing } from "./ReceiveCorrectionRing";

/** No frozen engine telemetry is available for any participant. */
export function RemoteReceiveCorrection() {
  const { i18n } = useTranslation();
  return <ReceiveCorrectionRing {...readReceiveCorrection()}
    labels={i18n.resolvedLanguage === "zh-CN" ? RECEIVE_CORRECTION_LABELS_ZH : RECEIVE_CORRECTION_LABELS_EN} />;
}
