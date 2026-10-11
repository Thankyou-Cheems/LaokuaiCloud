import { Tooltip } from "@gryt/ui";
import { useMicrophone } from "@gryt/voice";

import { useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { PiBroadcastFill, PiGameControllerFill, PiKeyboardFill, PiMicrophoneFill, PiMicrophoneSlashFill, PiWarningFill } from "../../../../lib/icons";
import { useSquadSnapshot } from "../../../../lib/squadRuntime";
import { deriveVoiceMode, type VoiceModeState } from "../../../../lib/voiceMode";
import { useLocalVoiceMode, useRemoteVoiceMode } from "../../../../lib/voiceModeStore";

export function VoiceModeGlyph({ state, keyLabel, compact = false }: { state: VoiceModeState | null; keyLabel?: string; compact?: boolean }) {
  const { t } = useTranslation();
  const label = state ? `${t(`voiceMode.${state.inputMode}`)} · ${t(`voiceMode.squad.${state.squad}`)} · ${t(`voiceMode.transmit.${state.transmit}`)}${keyLabel ? ` · ${keyLabel}` : ""}`
    : t("voiceMode.unknown");
  const closed = state && (state.squad === "suppressed" || ["manual-muted", "server-muted"].includes(state.transmit));
  const warning = state && (state.squad === "unavailable" || ["error", "suspended"].includes(state.transmit));
  // A permitted transmission is not a speech detector. Keep PTT idle/active
  // and manual mute distinct without deriving activity from local input level.
  const MicrophoneIcon = state && ["manual-muted", "server-muted"].includes(state.transmit) ? PiMicrophoneSlashFill
    : state?.transmit === "ptt-idle" ? PiKeyboardFill
      : state?.inputMode === "push_to_talk" && state.transmit === "normal" ? PiBroadcastFill : PiMicrophoneFill;
  return <Tooltip title={label}><span role="img" tabIndex={0} aria-label={label} data-testid="voice-mode-icon"
    data-squad-confirmed={state?.squad === "suppressed"} data-mic-closed={Boolean(closed)} data-voice-transmit={state?.transmit ?? "unknown"}
    className={`inline-flex items-center text-[10px] leading-tight ${compact ? "shrink-0 flex-nowrap gap-0.5" : "min-w-0 max-w-full flex-wrap gap-x-1 gap-y-0.5"}`} style={{ maxWidth: compact ? undefined : 155, color: warning ? "var(--gryt-warning-11)" : closed ? "var(--gryt-danger-11)" : undefined }}>
    {state ? <>
      <span aria-hidden="true" className="inline-flex items-center gap-0.5">
        {!compact && state.inputMode === "push_to_talk" && <kbd className="rounded border border-gryt-border px-0.5 text-[9px]">PTT</kbd>}
        <MicrophoneIcon size={13} />{!compact && t(`voiceMode.${state.inputMode}`)}
      </span>
      {state.squad !== "off" && <span aria-hidden="true" className="relative inline-flex items-center gap-0.5">
        <PiGameControllerFill size={13} />
        {state.squad === "suppressed" && <svg data-testid="squad-pause-glyph" className={compact ? "absolute -right-0.5 -top-0.5" : undefined} width={compact ? 8 : 10} height={compact ? 8 : 10} viewBox="0 0 10 10" fill="currentColor"><path d="M2 1h2v8H2zm4 0h2v8H6z" /></svg>}
        {!compact && t(`voiceMode.compact.squad.${state.squad}`)}
      </span>}
      {(!compact || warning) && <span aria-hidden="true" className="inline-flex items-center gap-0.5 text-gryt-muted">
        {warning && <PiWarningFill size={12} />}{!compact && t(`voiceMode.compact.transmit.${state.transmit}`)}
      </span>}
    </> : <span aria-hidden="true">? {!compact && t("voiceMode.compact.unknown")}</span>}
  </span></Tooltip>;
}
export function VoiceModeIcon({ host, member, isSelf }: { host?: string; member?: string; isSelf?: boolean }) {
  const s = useSettings();
  const squad = useSquadSnapshot();
  const { isPttActive, transmissionState } = useMicrophone(false);
  const remote = useRemoteVoiceMode(host, member);
  const observedLocal = useLocalVoiceMode();
  const local = deriveVoiceMode({ inputMode: s.inputMode, pttActive: isPttActive.current,
    manualMuted: s.isMuted || s.isDeafened, serverMuted: s.isServerMuted || s.isServerDeafened,
    squadEnabled: s.squadConfig.enabled, squadStatus: squad.status, gateStatus: transmissionState.status,
    requestedSuppression: squad.suppressed });
  return <VoiceModeGlyph compact state={isSelf ? observedLocal ?? { ...local, seq: 0 } : remote}
    keyLabel={isSelf && s.inputMode === "push_to_talk" ? s.pushToTalkKey : undefined} />;
}
