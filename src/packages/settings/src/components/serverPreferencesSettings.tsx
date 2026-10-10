import { Switch } from "@gryt/ui";

import { i18n, useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { SettingGroup, SettingsContainer } from "./settingsComponents";

/** Preferences that affect how Gryt offers servers before you join them. */
export function ServerPreferencesSettings() {
  useTranslation();
  const { officialServerHidden, setOfficialServerHidden } = useSettings();

  return (
    <SettingsContainer>
      <h2 className="text-lg">{i18n.t("ui.addingServers")}</h2>

      <SettingGroup
        anchorId="the-server-we-run"
        title={i18n.t("settingsFull.mcd69c38fa2")}
        description={i18n.t("settingsFull.ma34e1363b1")}
      >
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <Switch
            checked={!officialServerHidden}
            onCheckedChange={(on) => setOfficialServerHidden(!on)}
          />{i18n.t("settingsFull.mbe66180c18")}</label>
      </SettingGroup>
    </SettingsContainer>
  );
}
