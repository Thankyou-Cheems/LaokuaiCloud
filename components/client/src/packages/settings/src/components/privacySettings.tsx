import { Divider, Toggle, ToggleGroup } from "@gryt/ui";
import { useSyncExternalStore } from "react";

import {
  type ContactRule,
  getContactPrefsSnapshot,
  setGlobalContactRule,
  subscribeToContactPrefs,
} from "@/common";
import { i18n, useTranslation } from "@/i18n";

import { SettingGroup, SettingsContainer } from "./settingsComponents";

const MESSAGE_CHOICES: { label: string; value: ContactRule }[] = [
  { get label() { return i18n.t("settingsFull.m22e4c60058"); }, value: "everyone" },
  { get label() { return i18n.t("settingsFull.mc11d5e1d35"); }, value: "friends" },
  { get label() { return i18n.t("settingsFull.m148ba2d236"); }, value: "nobody" },
];

const CALL_CHOICES: { label: string; value: ContactRule }[] = [
  { get label() { return i18n.t("settingsFull.m94ea1ddb7c"); }, value: "everyone" },
  { get label() { return i18n.t("settingsFull.mc11d5e1d35"); }, value: "friends" },
  { get label() { return i18n.t("settingsFull.m148ba2d236"); }, value: "nobody" },
];

/** GRYT-1470. Saved as it's picked, like every setting. */
export function PrivacySettings() {
  useTranslation();
  const { global } = useSyncExternalStore(subscribeToContactPrefs, getContactPrefsSnapshot, getContactPrefsSnapshot);

  return (
    <SettingsContainer>
      <h2>{i18n.t("ui.privacy")}</h2>

      <SettingGroup
        anchorId="who-can-send-me-messages"
        title={i18n.t("settingsFull.m0424662b37")}
        description={i18n.t("settingsFull.medc8c5ebff")}
      >
        <ToggleGroup
          className="max-[439px]:flex-wrap"
          value={[global.messages]}
          onValueChange={(next) => {
            const picked = next[0];
            if (picked) setGlobalContactRule("messages", picked as ContactRule);
          }}
          multiple={false}
        >
          {MESSAGE_CHOICES.map((choice) => (
            <Toggle key={choice.value} value={choice.value} size="small">
              {choice.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </SettingGroup>

      <Divider />

      <SettingGroup
        anchorId="who-can-call-me"
        title={i18n.t("settingsFull.m4e6838764c")}
        description={i18n.t("settingsFull.m807c4e9447")}
      >
        <ToggleGroup
          className="max-[439px]:flex-wrap"
          value={[global.messages === "nobody" ? "nobody" : global.calls]}
          onValueChange={(next) => {
            const picked = next[0];
            if (picked) setGlobalContactRule("calls", picked as ContactRule);
          }}
          multiple={false}
        >
          {CALL_CHOICES.map((choice) => (
            <Toggle
              key={choice.value}
              value={choice.value}
              size="small"
              // Nobody can message you, so nobody can be ringing you from a conversation.
              disabled={global.messages === "nobody" && choice.value !== "nobody"}
            >
              {choice.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </SettingGroup>
    </SettingsContainer>
  );
}
