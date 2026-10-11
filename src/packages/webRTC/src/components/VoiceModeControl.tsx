import { useRef } from "react";

import { useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { formatCombo } from "../../../../lib/hotkeys";
import {useEffectiveVoicePolicy} from "./EffectiveVoicePolicy";

/** Input mode changes only the mode, preserving user and administrator mute. */
export function VoiceModeControl() {
  const { t } = useTranslation();
  const { inputMode:preference, setInputMode, pushToTalkKey, openSettings } = useSettings();
  const policy=useEffectiveVoicePolicy();const inputMode=policy?.inputMode??preference;
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const modes = ["voice_activity", "push_to_talk"] as const;
  const keyLabel = pushToTalkKey ? formatCombo(pushToTalkKey, (key, values) => t(key, values)) : t("pureVoice.choosePtt");
  return <div className="flex flex-wrap items-center gap-2" data-gryt="voice-mode-control">
    <div role="radiogroup" aria-label={t("ui.inputMode")} className="flex rounded-lg bg-gryt-neutral-4 p-1">
      {modes.map((mode, index) => <button key={mode} ref={node => { buttons.current[index] = node; }}
        type="button" role="radio" aria-checked={inputMode === mode} tabIndex={inputMode === mode ? 0 : -1}
        disabled={policy?.requiredPushToTalk===true && mode==="voice_activity"}
        className={`rounded-md px-3 py-1 text-sm transition-colors motion-reduce:transition-none ${inputMode === mode ? "bg-gryt-accent text-gryt-on-accent" : "text-gryt-muted"}`}
        onClick={() => setInputMode(mode)} onKeyDown={event => {
          const next = event.key === "ArrowLeft" || event.key === "Home" ? 0 : event.key === "ArrowRight" || event.key === "End" ? 1 : undefined;
          if (next === undefined) return;
          event.preventDefault();
          if(policy?.requiredPushToTalk && modes[next]==="voice_activity")return;
          setInputMode(modes[next]); buttons.current[next]?.focus();
        }}>{t(mode === "voice_activity" ? "pureVoice.voiceActivity" : "ui.pushToTalk")}</button>)}
    </div>
    {inputMode === "push_to_talk" && <button type="button" className="max-w-40 truncate text-xs underline" onClick={() => openSettings("hotkeys")}
      aria-label={`${t("pureVoice.choosePtt")}: ${keyLabel}`} title={keyLabel}>
      {pushToTalkKey ? <kbd>{keyLabel}</kbd> : keyLabel}
    </button>}
  </div>;
}
