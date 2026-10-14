import { Alert } from "@gryt/ui";
import { type ReceiveLevelingState } from "@gryt/voice";

import { useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { useSpeakers } from "../../../../lib/voiceFacade";
import { ToggleSetting } from "./settingsComponents";

export function ReceiveLevelingControl({ enabled, onChange, state }: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  state: ReceiveLevelingState;
}) {
  const { t } = useTranslation();
  const status = enabled ? state.status : "disabled";
  return <>
    <ToggleSetting anchorId="receive-leveling" title={t("receiveLeveling.title")}
      description={t("receiveLeveling.description")} checked={enabled} onCheckedChange={onChange} />
    <div role="status" data-testid="receive-leveling-status">
      {status === "degraded"
        ? <Alert severity="warning">{t("receiveLeveling.degraded")}</Alert>
        : <p className="text-gryt-muted">{t(`receiveLeveling.${status}`, { latencyMs: state.latencyMs })}</p>}
      {status !== "active" && state.latencyMs > 0 && <p className="text-gryt-muted text-sm">
        {t("receiveLeveling.delay", { latencyMs: state.latencyMs })}
      </p>}
      {enabled && state.reason && <p className="text-gryt-muted text-sm">
        {t("receiveLeveling.reason", { reason: state.reason })}
      </p>}
    </div>
  </>;
}

export function ReceiveLevelingSettings() {
  const { receiveLevelingEnabled, setReceiveLevelingEnabled } = useSettings();
  const { receiveLevelingState } = useSpeakers();
  return <ReceiveLevelingControl enabled={receiveLevelingEnabled}
    onChange={setReceiveLevelingEnabled} state={receiveLevelingState} />;
}
