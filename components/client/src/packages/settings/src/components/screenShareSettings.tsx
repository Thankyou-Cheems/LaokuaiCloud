import { i18n, useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { SettingsContainer, ToggleSetting } from "./settingsComponents";

/**
 * Screen sharing, which is video. It was filed under Advanced, next to the debug
 * overlays, where nothing about the name said it changed how capture works.
 */
export function ScreenShareSettings() {
  useTranslation();
  const { experimentalScreenShare, setExperimentalScreenShare } = useSettings();

  return (
    <SettingsContainer>
      <h2 className="text-lg">{i18n.t("ui.screenShare")}</h2>

      <ToggleSetting
        anchorId="experimental-screen-share"
        title={i18n.t("settingsFull.m2995be43bd")}
        description={i18n.t("settingsFull.m36322f0c53")}
        checked={experimentalScreenShare}
        onCheckedChange={setExperimentalScreenShare}
        statusText={experimentalScreenShare
          ? i18n.t("settingsFull.m3e857d8b13")
          : undefined
        }
      />
    </SettingsContainer>
  );
}
