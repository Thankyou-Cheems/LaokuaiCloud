import { Button, Radio, RadioGroup, Switch } from "@gryt/ui";
import { grytDraft } from "@gryt/ui";
import { PencilSimple } from "@phosphor-icons/react";
import { useMemo } from "react";

import { useCustomThemes, useTheme, useThemeEditor } from "@/common";
import { i18n, useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { SettingGroup, SettingsContainer } from "../settingsComponents";
import { ThemeLibrary } from "./themeLibrary";
import { ThemeStylePicker } from "./themeStylePicker";

/**
 * The mode and the palette. A control that names a colour without showing it
 * makes you apply it and look, so the theme list draws each one.
 */
export function ThemeSettings() {
  const { t } = useTranslation();
  const { appearancePreference, setAppearancePreference, themeStyle, setThemeStyle } = useTheme();

  const appearanceOptions = useMemo(() => [
    { value: "system", label: t("settingsFull.mbc0792d8dc") },
    { value: "light", label: t("settingsFull.ma36ef8aba2") },
    { value: "dark", label: t("settingsFull.mae1ef01432") },
  ], [t]);

  const { googleFontsEnabled, setGoogleFontsEnabled } = useSettings();

  const { activeTheme } = useCustomThemes();
  const { openEditor } = useThemeEditor();

  return (
    <SettingsContainer>
      <h2 className="text-lg">{i18n.t("ui.theme")}</h2>

      <ThemeStylePicker value={themeStyle} onChange={setThemeStyle} />
      {themeStyle === "kirilie" && <p className="m-0 text-sm text-gryt-muted">奇丽叶使用浅色纸页。原主题的设置已保留，切回原主题即可继续使用。</p>}

      {themeStyle === "original" && <div className="flex flex-col gap-2">
        <span className="font-medium text-sm">{i18n.t("settingsFull.ma7b93d2128")}</span>
        <RadioGroup
          value={appearancePreference}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onValueChange={(v) => setAppearancePreference(v as any)}
        >
          {appearanceOptions.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <Radio value={o.value} />
              {o.label}
            </label>
          ))}
        </RadioGroup>
      </div>}

      {/* Where the accent, gray and radius dropdowns used to be. Those set
          Radix Themes' props, and one of them could change one thing. A theme
          is the whole palette — every anchor, both appearances, the corner
          radius. */}
      {themeStyle === "original" && <SettingGroup
        anchorId="theme"
        title={i18n.t("ui.theme")}
        description={i18n.t("settingsFull.m3358a44f27")}
      >
        <ThemeLibrary />
        {/* Opens on whatever is being worn, so the first thing the editor
            shows is the app as it is rather than a palette nobody chose. With
            nothing custom applied that is the library's own, which is what
            grytDraft is. */}
        <div className="pt-2">
          <Button
            onClick={() => openEditor(activeTheme ?? grytDraft)}
            size="small"
            tone="neutral"
          >
            <PencilSimple aria-hidden="true" size={15} />{i18n.t("settingsFull.ma3b05f435a")}</Button>
          <p className="m-0 pt-2 text-xs text-gryt-muted">{i18n.t("settingsFull.m0bb478671b")}</p>
        </div>
      </SettingGroup>}

      {/* Under Theme, because it is a thing about themes rather than about
          privacy in general — somebody arrives here having picked a font in
          the editor and been told it will not load. */}
      <SettingGroup
        anchorId="typefaces-from-google"
        title={i18n.t("settingsFull.mb4ffdc1212")}
        description={i18n.t("settingsFull.me5556ad653")}
      >
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <Switch
            checked={googleFontsEnabled}
            onCheckedChange={setGoogleFontsEnabled}
          />{i18n.t("settingsFull.m2f6b1d3add")}</label>
      </SettingGroup>

    </SettingsContainer>
  );
}


