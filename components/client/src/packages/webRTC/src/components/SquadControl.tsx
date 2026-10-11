import { useMicrophone } from "@gryt/voice";

import { useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { PiGameControllerFill } from "../../../../lib/icons";
import { useSquadSnapshot } from "../../../../lib/squadRuntime";
import { SquadStatusText } from "../../../settings/src/components/squadSettings";
import { CallControlButton } from "./CallControlButton";
import { HoverAudioControl } from "./HoverAudioControl";

/** Opt-in remains independent of VA/PTT and the actual transient suppression state. */
export function SquadControl() {
  const { t } = useTranslation();
  const { squadConfig, setSquadConfig } = useSettings();
  const snapshot = useSquadSnapshot();
  const { transmissionState } = useMicrophone();
  return <HoverAudioControl label={t("squad.title")} side="top" settingsTab="voice" action={
    <CallControlButton state={squadConfig.enabled ? "live" : "idle"} className="!w-auto !px-2 gap-1"
      aria-label={t("squad.title")} aria-pressed={squadConfig.enabled}
      onClick={() => setSquadConfig({ ...squadConfig, enabled: !squadConfig.enabled })}>
      <PiGameControllerFill size={16} /><span>Squad</span>
    </CallControlButton>
  }>
    <p className="text-sm">{t("squad.description")}</p>
    <SquadStatusText state={snapshot} transmission={transmissionState} />
  </HoverAudioControl>;
}
