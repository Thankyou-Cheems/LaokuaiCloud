import { Divider, Toggle, ToggleGroup } from "@gryt/ui";
import { useState, useSyncExternalStore } from "react";

import messageSoundMp3 from "@/audio/src/assets/universfield-computer-mouse-click-02-383961.mp3";
import {
  getStoredSnapshot,
  type NotificationLevel,
  setGlobalLevel,
  subscribeToPrefs,
} from "@/common";
import { i18n, useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { NoticeDialog } from "../../../socket/src/components/NoticeDialog";
import { ServerNotificationList } from "./serverNotificationList";
import { SettingGroup, SettingsContainer, ToggleSetting } from "./settingsComponents";
import { SoundSettings } from "./SoundSettings";

const GLOBAL_LEVELS: { label: string; value: NotificationLevel }[] = [
  { get label() { return i18n.t("settingsFull.m4a66d14807"); }, value: "all" },
  { get label() { return i18n.t("settingsFull.me7be45b885"); }, value: "mentions" },
  { get label() { return i18n.t("settingsFull.m4481948392"); }, value: "none" },
];

export function NotificationSettings() {
  useTranslation();
  const {
    notificationBadgeEnabled,
    desktopNotificationsEnabled,
    setDesktopNotificationsEnabled,
    setNotificationBadgeEnabled,
    messageSoundEnabled,
    setMessageSoundEnabled,
    messageSoundVolume,
    setMessageSoundVolume,
    customMessageSoundFile,
    setCustomMessageSoundFile,
  } = useSettings();

  /* The global level and the per-server rules share a store, and this reads
     the whole thing so the toggles move when either changes. */
  const globalLevel = useSyncExternalStore(
    subscribeToPrefs,
    getStoredSnapshot,
    getStoredSnapshot,
  ).global;

  const [alertDialog, setAlertDialog] = useState<{
    open: boolean;
    type: "success" | "error";
    title: string;
    message: string;
  }>({
    open: false,
    type: "success",
    title: "",
    message: "",
  });

  const showAlert = (
    type: "success" | "error",
    title: string,
    message: string,
  ) => {
    setAlertDialog({ open: true, type, title, message });
  };

  return (
    <SettingsContainer>
      <h2>{i18n.t("ui.notifications")}</h2>

      {/* First, because it is the one that decides what the rest can do. */}
      <SettingGroup
        anchorId="notification-level"
        title={i18n.t("settingsFull.m1621a1b7d1")}
        description={i18n.t("settingsFull.m8e770ce31f")}
      >
        {/* max-[369px]: the three toggles are 71px wider than the 300px
            Electron minimum leaves it. Each one stands alone, with no shared
            sliding indicator to strand, so wrapping is the simple fix. */}
        <ToggleGroup
          className="max-[369px]:flex-wrap"
          value={[globalLevel]}
          onValueChange={(next) => {
            // Base UI hands back an array and clears it when the pressed one is
            // pressed again. There is always a level, so empty means no change.
            const picked = next[0];
            if (picked) setGlobalLevel(picked as NotificationLevel);
          }}
          multiple={false}
        >
          {GLOBAL_LEVELS.map((level) => (
            <Toggle key={level.value} value={level.value} size="small">
              {level.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </SettingGroup>

      <Divider />

      <SettingGroup
        anchorId="per-server"
        title={i18n.t("settingsFull.m4867f61838")}
        description={i18n.t("settingsFull.me6ee5c0068")}
      >
        <ServerNotificationList />
      </SettingGroup>

      <Divider />

      <ToggleSetting
        anchorId="desktop-notifications"
        title={i18n.t("settingsFull.m53a3505aad")}
        description={i18n.t("settingsFull.m4c72c9dc4e")}
        checked={desktopNotificationsEnabled}
        onCheckedChange={setDesktopNotificationsEnabled}
      />

      <Divider />

      <ToggleSetting
        anchorId="unread-message-badge"
        title={i18n.t("settingsFull.m370744ea83")}
        description={i18n.t("settingsFull.m54e929ea8b")}
        checked={notificationBadgeEnabled}
        onCheckedChange={setNotificationBadgeEnabled}
      />

      <Divider />

      <SoundSettings
        label={i18n.t("settingsFull.m79c85dc39e")}
        description={i18n.t("settingsFull.mc8d40ba74d")}
        enabled={messageSoundEnabled}
        onEnabledChange={setMessageSoundEnabled}
        volume={messageSoundVolume}
        onVolumeChange={setMessageSoundVolume}
        defaultVolume={30}
        customSoundFile={customMessageSoundFile}
        onCustomSoundFileChange={setCustomMessageSoundFile}
        defaultSoundSrc={messageSoundMp3}
        showAlert={showAlert}
      />

      <NoticeDialog
        open={alertDialog.open}
        onClose={() => setAlertDialog({ ...alertDialog, open: false })}
        title={alertDialog.title}
        message={alertDialog.message}
      />
    </SettingsContainer>
  );
}
