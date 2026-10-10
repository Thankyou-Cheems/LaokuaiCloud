import { Button } from "@gryt/ui";
import { useEffect, useRef } from "react";

import { useTranslation } from "@/i18n";
import { type NotificationPlayback, playNotificationSound } from "@/lib/notificationSound";
import { useSettings } from "@/settings";

import { peerCueUrl } from "../../../../lib/peerVoiceCues";
import { SettingGroup, SliderSetting, ToggleSetting } from "./settingsComponents";

export function PeerVoiceCueSettings() {
  const {t}=useTranslation();const s=useSettings();const config=s.peerVoiceCues;
  const playback=useRef<NotificationPlayback|null>(null);
  useEffect(()=>()=>{playback.current?.stop();},[]);
  const silent=!config.enabled || config.dnd || s.isDeafened || s.isServerDeafened || s.outputVolume<=0;
  const current=useRef({silent,join:s.connectSoundEnabled,leave:s.disconnectSoundEnabled});
  current.current={silent,join:s.connectSoundEnabled,leave:s.disconnectSoundEnabled};
  useEffect(()=>{playback.current?.stop();},[silent,s.connectSoundEnabled,s.disconnectSoundEnabled,config.joinVolume,config.leaveVolume]);
  const preview=(kind:"join"|"leave")=>{
    playback.current?.stop();
    playback.current=playNotificationSound(peerCueUrl(kind),kind==="join" ? config.joinVolume : config.leaveVolume,
      {shouldPlay:()=>!current.current.silent && current.current[kind]});
  };
  return <SettingGroup anchorId="peer-voice-cues" title={t("pureVoice.peerCues")} description={t("pureVoice.peerCuesDescription")}>
    <ToggleSetting anchorId="peer-voice-cues-enabled" title={t("pureVoice.peerCuesEnabled")} description={t("pureVoice.peerCuesScope")}
      checked={config.enabled} onCheckedChange={enabled=>s.setPeerVoiceCues({...config,enabled})}/>
    <ToggleSetting anchorId="peer-voice-cues-dnd" title={t("pureVoice.peerCuesDnd")} description={t("pureVoice.peerCuesDndDescription")}
      checked={config.dnd} onCheckedChange={dnd=>s.setPeerVoiceCues({...config,dnd})}/>
    {(["join","leave"] as const).map(kind=><div key={kind}>
      <SliderSetting anchorId={kind==="join" ? "peer-voice-cues-join-volume" : "peer-voice-cues-leave-volume"} title={t(`pureVoice.peerCue${kind}`)} description={t("pureVoice.peerCueVolume")}
        value={kind==="join" ? config.joinVolume : config.leaveVolume} min={0} max={100}
        onChange={value=>s.setPeerVoiceCues({...config,[kind==="join" ? "joinVolume" : "leaveVolume"]:value})}/>
      <Button size="small" disabled={silent || !(kind==="join" ? s.connectSoundEnabled : s.disconnectSoundEnabled)} onClick={()=>preview(kind)}>{t("pureVoice.previewCue")}</Button>
    </div>)}
  </SettingGroup>;
}
