import { Button } from "@gryt/ui";

import { useTranslation } from "@/i18n";
import { useReceivePriors } from "@/webRTC/src/components/ReceivePriorAdapter";

import { SettingGroup } from "./settingsComponents";

export function ReceivePriorSettings() {
  const {t}=useTranslation();const cache=useReceivePriors();
  return <SettingGroup anchorId="receive-priors" title={t("pureVoice.priorTitle")} description={t("pureVoice.priorDescription")}>
    <p className="text-xs text-gryt-muted">{cache.available ? t("pureVoice.priorCount",{count:cache.count}) : t("pureVoice.priorUnavailable")}</p>
    <Button size="small" disabled={!cache.available || !cache.count} onClick={cache.clearAll}>{t("pureVoice.priorClearAll")}</Button>
  </SettingGroup>;
}
