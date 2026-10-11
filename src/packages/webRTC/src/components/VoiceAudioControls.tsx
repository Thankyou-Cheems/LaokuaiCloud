import { Button, Slider } from "@gryt/ui";
import { useId } from "react";
import toast from "react-hot-toast";

import { useTranslation } from "@/i18n";
import { MAX_VOLUME_PERCENT } from "@/lib/audioVolume";
import { useSettings } from "@/settings";

import { PiMicrophoneFill, PiMicrophoneSlashFill, PiSpeakerHighFill, PiSpeakerSlashFill } from "../../../../lib/icons";
import { CallControlButton } from "./CallControlButton";
import {useEffectiveVoicePolicy} from "./EffectiveVoicePolicy";
import { HoverAudioControl } from "./HoverAudioControl";
import { useReceiveLeveling } from "./ReceiveLevelingAdapter";

function LevelingIcon({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M3 15V9M7 15V3M11 15V6M15 15V8M18 15V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M12 3h6m-2-2 2 2-2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** Both locations subscribe to the same settings and the same injected DSP adapter. */
export function VoiceAudioControls({ direction = "row", iconSize = 16 }: {
  direction?: "row" | "column";
  iconSize?: number;
}) {
  const { t: tr } = useTranslation();
  const {
    micVolume, setMicVolume, outputVolume, setOutputVolume,
    isMuted, setIsMuted, isDeafened, setIsDeafened, isServerMuted:storedServerMuted, isServerDeafened:storedServerDeafened,
  } = useSettings();
  const policy=useEffectiveVoicePolicy();
  const isServerMuted=policy?.serverMuted??storedServerMuted;
  const isServerDeafened=policy?.serverDeafened??storedServerDeafened;
  const speakDenied=policy?.canSpeak===false;
  const leveling = useReceiveLeveling();
  const side = direction === "column" ? "right" : "top";
  const parameter = leveling.available ? leveling.parameter : undefined;
  const receiveDescriptionId = useId();

  return <div className={`flex max-w-full ${direction === "column" ? "flex-col" : "flex-row flex-wrap"} items-center gap-1`} data-gryt="voice-audio-controls">
    <HoverAudioControl label={tr("voiceAudio.microphone")} side={side} action={
      <CallControlButton className="!w-auto !px-2 gap-1" state={isServerMuted || speakDenied ? "blocked" : isMuted ? "off" : "idle"}
        aria-label={(isMuted || isServerMuted) ? tr("ui.unmuteMicrophone") : tr("ui.muteMicrophone")}
        onClick={() => {
          if (isServerMuted || speakDenied) {
            toast(tr(speakDenied ? "pureVoice.speakDenied" : "ui.youAreServerMutedByAnAdmin"), { icon: <PiMicrophoneSlashFill size={18} />, id: "server-muted" });
            return;
          }
          setIsMuted(!isMuted);
        }}>
        {(isMuted || isServerMuted || speakDenied) ? <PiMicrophoneSlashFill size={iconSize} /> : <PiMicrophoneFill size={iconSize} />}<span>{tr("pureVoice.microphone")}</span>
      </CallControlButton>
    }>
      <span className="tabular-nums">{micVolume}%</span>
      <Slider aria-label={tr("voiceAudio.microphone")} value={micVolume} min={0} max={MAX_VOLUME_PERCENT} step={1}
        onValueChange={(next) => setMicVolume(Number(next))} />
      {(isMuted || isServerMuted || speakDenied) && <p role="status" className="text-sm text-gryt-muted">{tr(speakDenied ? "pureVoice.speakDenied" : "voiceAudio.muted")}</p>}
      <Button tone="neutral" onClick={() => setMicVolume(100)}>{tr("receiveVolume.reset")}</Button>
    </HoverAudioControl>

    <HoverAudioControl label={tr("receiveVolume.title")} side={side} action={
      <CallControlButton className="!w-auto !px-2 gap-1" state={isServerDeafened ? "blocked" : isDeafened ? "off" : "idle"}
        aria-label={(isDeafened || isServerDeafened) ? tr("ui.undeafen") : tr("ui.deafen")}
        onClick={() => {
          if (isServerDeafened) {
            toast(tr("ui.youAreServerDeafenedByAnAdmin"), { icon: <PiSpeakerSlashFill size={18} />, id: "server-deafened" });
            return;
          }
          setIsDeafened(!isDeafened);
        }}>
        {(isDeafened || isServerDeafened) ? <PiSpeakerSlashFill size={iconSize} /> : <PiSpeakerHighFill size={iconSize} />}<span>{tr("pureVoice.speaker")}</span>
      </CallControlButton>
    }>
      <span className="tabular-nums">{outputVolume}%</span>
      <Slider aria-label={tr("receiveVolume.title")} aria-describedby={receiveDescriptionId} value={outputVolume} min={0} max={MAX_VOLUME_PERCENT} step={1}
        onValueChange={(next) => setOutputVolume(Number(next))} />
      <p id={receiveDescriptionId} className="text-sm text-gryt-muted">{tr("receiveVolume.description")}</p>
      {(isDeafened || isServerDeafened) && <p role="status" className="text-sm text-gryt-muted">{tr("receiveVolume.deafened")}</p>}
      <Button tone="neutral" onClick={() => setOutputVolume(100)}>{tr("receiveVolume.reset")}</Button>
    </HoverAudioControl>

    <HoverAudioControl label={tr("voiceAudio.leveling")} side={side} action={
      <CallControlButton className="!w-auto !px-2 gap-1" state={leveling.available && leveling.runtime === "active" ? "live" : "idle"}
        aria-label={tr("voiceAudio.leveling")}
        aria-pressed={leveling.available ? leveling.enabled : undefined}
        data-leveling-runtime={leveling.runtime}
        disabled={!leveling.available}
        title={leveling.available ? `${tr("voiceAudio.leveling")}: ${tr(`voiceAudio.runtime.${leveling.runtime}`)}` : tr("voiceAudio.unavailable")}
        onClick={() => { if (leveling.available) leveling.setEnabled(!leveling.enabled); }}>
        <LevelingIcon size={iconSize} /><span>{tr("pureVoice.leveling")}</span>
      </CallControlButton>
    }>
      <p className="text-sm text-gryt-muted">{tr("voiceAudio.levelingDescription")}</p>
      <p className="text-sm">{tr("voiceAudio.setting")}: {leveling.available ? tr(leveling.enabled ? "voiceAudio.on" : "voiceAudio.off") : tr("voiceAudio.unavailable")}</p>
      <p role="status" className="text-sm">{tr("voiceAudio.actual")}: {tr(`voiceAudio.runtime.${leveling.runtime}`)}</p>
      {leveling.available && leveling.runtime === "degraded" && <p role="alert" className="text-sm">
        {tr("voiceAudio.degradedQuiet")}
      </p>}
      {leveling.available && leveling.reason && <p className="text-sm text-gryt-muted">
        {tr("receiveLeveling.reason", { reason: leveling.reason })}
      </p>}
      {leveling.available && leveling.latencyMs !== undefined && <p className="text-sm text-gryt-muted">
        {tr("receiveLeveling.delay", { latencyMs: leveling.latencyMs })}
      </p>}
      {leveling.available && <Button tone="neutral" onClick={() => leveling.setEnabled(!leveling.enabled)}>
        {tr(leveling.enabled ? "voiceAudio.turnOff" : "voiceAudio.turnOn")}
      </Button>}
      {parameter ? <>
        <label className="text-sm">{parameter.label}: {parameter.value} {parameter.unit}</label>
        <Slider aria-label={parameter.label}
          value={parameter.value} min={parameter.min} max={parameter.max} step={parameter.step}
          onValueChange={(next) => parameter.setValue(Number(next))} />
      </> : <p className="text-sm text-gryt-muted">{tr("voiceAudio.noParameter")}</p>}
    </HoverAudioControl>
  </div>;
}
