import { Divider, Switch } from "@gryt/ui";

import { i18n, useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { LatencyPanel } from "./latencyPanel";
import { SettingsContainer } from "./settingsComponents";

export function AdvancedSettings() {
  useTranslation();
  const {
    showAdvanced,
    setShowAdvanced,
    showDebugOverlay,
    setShowDebugOverlay,
    showVideoDebugOverlay,
    setShowVideoDebugOverlay,
    showPeerLatency,
    setShowPeerLatency,
  } = useSettings();

  return (
    <SettingsContainer>
      <h2 color="cyan">{i18n.t("ui.advanced")}</h2>

      {/*
        The toggle stays visible; what it reveals does not. Everything below is
        diagnostics and internals — useful when something is wrong, noise the
        rest of the time, and previously sitting between settings people
        actually needed.

        Advanced settings are titled in cyan wherever they appear, so once this
        is on it is obvious which of the things now on screen arrived with it.
      */}
      <div>
        <div className="flex items-center gap-3">
          <span className="font-medium">{i18n.t("settingsFull.m065144e113")}</span>
          <Switch
            checked={showAdvanced}
            onCheckedChange={setShowAdvanced}
          />
        </div>
        <span className="text-gryt-muted mt-1">{i18n.t("settingsFull.m4ba8ca871f")}</span>
      </div>

      {!showAdvanced ? null : (
      <>
      <LatencyPanel />

      <Divider />

      <span className="font-bold text-gryt-muted">{i18n.t("settingsFull.m3af2279f9e")}</span>

      <div>
        <div className="flex items-center gap-3">
          <span className="font-medium">{i18n.t("settingsFull.m2c7e9bff2c")}</span>
          <Switch
            checked={showPeerLatency}
            onCheckedChange={setShowPeerLatency}
          />
        </div>
        <span className="text-gryt-muted mt-1">{i18n.t("settingsFull.m3759181dbd")}</span>
      </div>

      <div>
        <div className="flex items-center gap-3">
          <span className="font-medium">{i18n.t("settingsFull.m601d79214f")}</span>
          <Switch
            checked={showDebugOverlay}
            onCheckedChange={setShowDebugOverlay}
          />
        </div>
        <span className="text-gryt-muted mt-1">{i18n.t("settingsFull.m03a958705a")}</span>
      </div>

      <div>
        <div className="flex items-center gap-3">
          <span className="font-medium">{i18n.t("settingsFull.m79af3fb741")}</span>
          <Switch
            checked={showVideoDebugOverlay}
            onCheckedChange={setShowVideoDebugOverlay}
          />
        </div>
        <span className="text-gryt-muted mt-1">{i18n.t("settingsFull.mba124550f9")}</span>
      </div>
      </>
      )}
    </SettingsContainer>
  );
}
