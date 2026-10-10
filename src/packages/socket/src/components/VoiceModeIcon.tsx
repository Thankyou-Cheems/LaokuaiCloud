import { Tooltip } from "@gryt/ui";
import { useMicrophone } from "@gryt/voice";

import { useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { useSquadSnapshot } from "../../../../lib/squadRuntime";
import { deriveVoiceMode, type VoiceModeState } from "../../../../lib/voiceMode";
import { useLocalVoiceMode, useRemoteVoiceMode } from "../../../../lib/voiceModeStore";

const SYMBOLS: Record<VoiceModeState["transmit"], string> = {
  normal: "●", "manual-muted": "⊘", "server-muted": "⊗", "ptt-idle": "⌨", "squad-suppressed": "S⊘",
  resuming: "↻", pending: "…", suspended: "Ⅱ", error: "!",
};
export function VoiceModeGlyph({ state }: { state: VoiceModeState | null }) {
  const { t } = useTranslation();
  const label = state ? `${t(`voiceMode.${state.inputMode}`)} · ${t(`voiceMode.squad.${state.squad}`)} · ${t(`voiceMode.transmit.${state.transmit}`)}`
    : t("voiceMode.unknown");
  return <Tooltip title={label}><span role="img" aria-label={label} data-testid="voice-mode-icon"
    className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-mono" style={{ minWidth: 22 }}>
    {state ? <><span aria-hidden="true">{state.inputMode === "push_to_talk" ? "⌨" : "V"}</span>
      <span aria-hidden="true">{SYMBOLS[state.transmit]}</span></> : <span aria-hidden="true">?</span>}
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
  return <VoiceModeGlyph state={isSelf ? observedLocal ?? { ...local, seq: 0 } : remote} />;
}
