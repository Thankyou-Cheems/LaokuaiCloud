import { Button, Chip, Divider } from "@gryt/ui";

import { i18n, useTranslation } from "@/i18n";
import { useSettings } from "@/settings";
import {
  setFakeChatRunning,
  useFakeChatRunning,
} from "@/socket/src/dev/fakeChatController";

import { PiPlayFill, PiStopFill } from "../../../../lib/icons";
import {
  SettingGroup,
  SettingsContainer,
  SliderSetting,
  ToggleSetting,
} from "./settingsComponents";

/**
 * Names are assigned in order and the two groups do not share any, so these
 * bound the sliders. They mirror the constants in fakeParticipants.ts.
 */
const MAX_FAKE_PARTICIPANTS = 12;
const MAX_FAKE_MEMBERS = 12;

/**
 * Developer tools. Rendered only under `import.meta.env.DEV`, which Vite folds to
 * false, so the whole panel and its tab disappear from a release.
 */
export function DeveloperSettings() {
  useTranslation();
  const {
    devFakeParticipants,
    setDevFakeParticipants,
    devFakeMembers,
    setDevFakeMembers,
    devFakeChatSeconds,
    setDevFakeChatSeconds,
    devFakeMuted,
    setDevFakeMuted,
    devFakeDeafened,
    setDevFakeDeafened,
    devFakeSpeaking,
    setDevFakeSpeaking,
  } = useSettings();
  const chatRunning = useFakeChatRunning();

  return (
    <SettingsContainer>
      <div className="flex items-center gap-2">
        <h2>{i18n.t("ui.developer")}</h2>
        <Chip tone="warning" label={i18n.t("settingsFull.m23e4eb327c")} />
      </div>

      <span className="text-gryt-muted">{i18n.t("settingsFull.me5c0f54e98")}</span>

      <Divider />

      <SettingGroup
        anchorId="fake-participants"
        title={i18n.t("settingsFull.m35feb4fa87")}
        description={i18n.t("settingsFull.m5adf7275be")}
      >
        <SliderSetting
          anchorId="in-the-voice-channel-with-you"
          title={i18n.t("settingsFull.m49e5462548")}
          description={
            devFakeParticipants === 0
              ? i18n.t("settingsFull.m7ca1cc4cd6")
              : i18n.t("settingsFull.mf73aa18790", { value0: devFakeParticipants })
          }
          value={devFakeParticipants}
          onChange={setDevFakeParticipants}
          min={0}
          max={MAX_FAKE_PARTICIPANTS}
          step={1}
        />

        <SliderSetting
          anchorId="in-the-server-not-in-voice"
          title={i18n.t("settingsFull.mc59e168ea2")}
          description={
            devFakeMembers === 0
              ? i18n.t("settingsFull.m3638de89a3")
              : i18n.t("settingsFull.m0fe8202631", { value0: devFakeMembers })
          }
          value={devFakeMembers}
          onChange={setDevFakeMembers}
          min={0}
          max={MAX_FAKE_MEMBERS}
          step={1}
        />

        <SliderSetting
          anchorId="how-many-are-muted"
          title={i18n.t("settingsFull.m7acd250f39")}
          description={i18n.t("settingsFull.mfba205976e")}
          value={Math.min(devFakeMuted, devFakeParticipants)}
          onChange={setDevFakeMuted}
          min={0}
          max={Math.max(devFakeParticipants, 1)}
          step={1}
        />

        <ToggleSetting
          anchorId="one-is-deafened"
          title={i18n.t("settingsFull.mbae20a5acb")}
          description={i18n.t("settingsFull.m2a491432c1")}
          checked={devFakeDeafened}
          onCheckedChange={setDevFakeDeafened}
        />

        <ToggleSetting
          anchorId="they-talk"
          title={i18n.t("settingsFull.m7b4baeee7f")}
          description={i18n.t("settingsFull.m0ce9484099")}
          checked={devFakeSpeaking}
          onCheckedChange={setDevFakeSpeaking}
        />

      </SettingGroup>

      <Divider />

      <SettingGroup
        anchorId="fake-chat"
        title={i18n.t("settingsFull.mb0a5991e3c")}
        description={i18n.t("settingsFull.mb8a2f44563")}
      >
        <SliderSetting
          anchorId="a-message-every"
          title={i18n.t("settingsFull.ma85fd942ff")}
          description={i18n.t("settingsFull.m29ed08341b", { seconds: devFakeChatSeconds, count: devFakeChatSeconds })}
          value={devFakeChatSeconds}
          onChange={setDevFakeChatSeconds}
          min={1}
          max={30}
          step={1}
        />

        <div className="flex flex-col gap-2">
          <Button size="small"
            onClick={() => setFakeChatRunning(!chatRunning)}
          >
            {chatRunning ? <PiStopFill size={16} /> : <PiPlayFill size={16} />}
            {chatRunning ? i18n.t("settingsFull.m9e253470c8") : i18n.t("settingsFull.m952f375412")}
          </Button>
          <span className="text-gryt-muted">
            {chatRunning
              ? i18n.t("settingsFull.m0735022813")
              : i18n.t("settingsFull.m8041058edf")}
          </span>
        </div>
      </SettingGroup>

      <Divider />

      <span className="text-gryt-muted">{i18n.t("settingsFull.md91766b4d5")}<br />
        <code>
          ?fake=6&amp;fakemembers=8&amp;fakemuted=2&amp;fakedeaf=1&amp;fakespeak=0
        </code>
      </span>
    </SettingsContainer>
  );
}
