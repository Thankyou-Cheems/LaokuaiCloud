import { Divider } from "@gryt/ui";
import { useRef, useState } from "react";

import connectMp3 from "@/audio/src/assets/connect.mp3";
import disconnectMp3 from "@/audio/src/assets/disconnect.mp3";
import { useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { NoticeDialog } from "../../../socket/src/components/NoticeDialog";
import { voiceSoundDefaultVolume, voiceSoundUrl } from "../../../webRTC/src/adapters/voiceSoundPacks";
import { PeerVoiceCueSettings } from "./PeerVoiceCueSettings";
import { SettingsContainer, SliderSetting, ToggleSetting } from "./settingsComponents";
import { SoundSettings } from "./SoundSettings";
import { SquadSettings } from "./squadSettings";
import { VoiceAnnouncementSettings } from "./VoiceAnnouncementSettings";
import { VoiceTransportSettings } from "./VoiceTransportSettings";

export function VoiceSettings() {
  const { t: tr } = useTranslation();
  const settings = useSettings();
  const latest = useRef(settings); latest.current = settings;
  const previewAllowed = (leaving: boolean) => {
    const s = latest.current;
    return !s.peerVoiceCues.dnd && !s.isDeafened && !s.isServerDeafened && s.outputVolume > 0 &&
      (leaving ? s.disconnectSoundEnabled : s.connectSoundEnabled);
  };
  const {
    eSportsModeEnabled,
    setESportsModeEnabled,
    connectSoundEnabled,
    setConnectSoundEnabled,
    disconnectSoundEnabled,
    setDisconnectSoundEnabled,
    connectSoundVolume,
    setConnectSoundVolume,
    disconnectSoundVolume,
    setDisconnectSoundVolume,
    customConnectSoundFile,
    setCustomConnectSoundFile,
    customDisconnectSoundFile,
    setCustomDisconnectSoundFile,
    afkTimeoutMinutes,
    setAfkTimeoutMinutes,
    voiceAnnouncements,
  } = settings;

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
      <h2>
        {tr("ui.voice")}
      </h2>

      <SquadSettings />
      <VoiceAnnouncementSettings showAlert={showAlert} />
      <PeerVoiceCueSettings />
      <VoiceTransportSettings />

      <Divider />

      <ToggleSetting anchorId="esports-mode"
        title={tr("ui.esportsMode")}
        description={tr("ui.lowestPossibleLatencyDisablesAllAudioProcessingEnables")}
        checked={eSportsModeEnabled}
        onCheckedChange={setESportsModeEnabled}
        statusText={eSportsModeEnabled
          ? tr("audio.esportsActive")
          : undefined
        }
      />

      <Divider />

      <SliderSetting anchorId="afk-timeout"
        title={tr("audio.afkTimeout", { count: afkTimeoutMinutes })}
        description={tr("ui.youAreMarkedAfkAfterThisManyMinutes")}
        value={afkTimeoutMinutes}
        onChange={setAfkTimeoutMinutes}
        min={1}
        max={30}
      />

      <Divider />

      <div className="flex flex-col gap-4">
        <SoundSettings
          label={tr("ui.connectSound")}
          description={tr("ui.playSoundWhenConnectingToVoice")}
          enabled={connectSoundEnabled}
          onEnabledChange={setConnectSoundEnabled}
          volume={connectSoundVolume}
          onVolumeChange={setConnectSoundVolume}
          defaultVolume={voiceSoundDefaultVolume("connected", voiceAnnouncements, { customConnectSoundFile })}
          customSoundFile={customConnectSoundFile}
          onCustomSoundFileChange={setCustomConnectSoundFile}
          defaultSoundSrc={voiceSoundUrl("connected", voiceAnnouncements) ?? connectMp3}
          shouldPlay={() => previewAllowed(false)}
          showAlert={showAlert}
        />
        <SoundSettings
          label={tr("ui.disconnectSound")}
          description={tr("ui.playSoundWhenDisconnectingFromVoice")}
          enabled={disconnectSoundEnabled}
          onEnabledChange={setDisconnectSoundEnabled}
          volume={disconnectSoundVolume}
          onVolumeChange={setDisconnectSoundVolume}
          defaultVolume={voiceSoundDefaultVolume("disconnected", voiceAnnouncements, { customDisconnectSoundFile })}
          customSoundFile={customDisconnectSoundFile}
          onCustomSoundFileChange={setCustomDisconnectSoundFile}
          defaultSoundSrc={voiceSoundUrl("disconnected", voiceAnnouncements) ?? disconnectMp3}
          shouldPlay={() => previewAllowed(true)}
          showAlert={showAlert}
        />
      </div>


      <NoticeDialog
        open={alertDialog.open}
        onClose={() => setAlertDialog({ ...alertDialog, open: false })}
        title={alertDialog.title}
        message={alertDialog.message}
      />
    </SettingsContainer>
  );
}
