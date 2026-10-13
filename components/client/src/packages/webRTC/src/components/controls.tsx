import { IconButton } from "@gryt/ui";
import { getIsBrowserSupported, useSFU } from "@gryt/voice";
import { useEffect, useRef } from "react";
import toast from "react-hot-toast";

import { useTranslation } from "@/i18n";
import { useSettings } from "@/settings";
import { useServerPermissions } from "@/socket/src/hooks/usePermissions";

import { PiPhoneDisconnectFill } from "../../../../lib/icons";
import { LEAVE_CLASS } from "./CallControlButton";
import { SquadControl } from "./SquadControl";
import { VoiceAudioControls } from "./VoiceAudioControls";
import { VoiceModeControl } from "./VoiceModeControl";

export function Controls({ onDisconnect }: { onDisconnect?: () => void }) {
  const { t } = useTranslation();
  const { disconnect, isConnected, currentServerConnected, currentChannelConnected } = useSFU();
  const { isMuted, setIsMuted } = useSettings();
  const { canIn } = useServerPermissions(currentServerConnected || "");
  const maySpeak = canIn(currentChannelConnected, "speak");
  const previous = useRef<{ channel: string; allowed: boolean } | null>(null);
  useEffect(() => {
    const old = previous.current;
    previous.current = isConnected ? { channel: currentChannelConnected, allowed: maySpeak } : null;
    if (old?.channel === currentChannelConnected && old.allowed && !maySpeak && !isMuted) {
      setIsMuted(true); toast.error(t("ui.youCanTSpeakInThisChannelAny"), { id: "speak-taken" });
    }
  }, [isConnected, currentChannelConnected, maySpeak, isMuted, setIsMuted, t]);
  if (!getIsBrowserSupported()) return null;
  return <div className="flex max-w-full flex-wrap items-center justify-center gap-2 min-[600px]:gap-4" data-gryt="pure-voice-controls">
    <VoiceModeControl />
    <VoiceAudioControls />
    <SquadControl />
    <IconButton tone="danger" size="xsmall" className={`${LEAVE_CLASS} !w-auto !px-3 gap-1`}
      aria-label={t("ui.leaveVoiceChannel")} onClick={() => { disconnect(onDisconnect); }}>
      <PiPhoneDisconnectFill size={16} /><span>{t("pureVoice.leave")}</span>
    </IconButton>
  </div>;
}
