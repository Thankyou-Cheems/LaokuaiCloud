import { Button, Select } from "@gryt/ui";
import { useEffect, useRef } from "react";

import { type NotificationPlayback,playNotificationSound } from "@/lib/notificationSound";
import { useSettings } from "@/settings";

import { VOICE_PHRASES, type VoiceAnnouncementEvent, type VoiceSoundPack } from "../../../../lib/voiceAnnouncements";
import { MANBO_PACK_AVAILABLE, voiceSoundDefaultVolume, voiceSoundUrl } from "../../../webRTC/src/adapters/voiceSoundPacks";
import { SettingGroup } from "./settingsComponents";
import { SoundSettings } from "./SoundSettings";

export function VoiceAnnouncementSettings({ showAlert }: { showAlert: (type: "success" | "error", title: string, message: string) => void }) {
  const s = useSettings(); const config = s.voiceAnnouncements;
  const latest = useRef(s); latest.current = s;
  const playback = useRef<NotificationPlayback | undefined>(undefined);
  const silent = s.peerVoiceCues.dnd || s.isDeafened || s.isServerDeafened || s.outputVolume <= 0;
  useEffect(() => {
    playback.current?.stop();
    return () => playback.current?.stop();
  }, [config, silent, s.connectSoundEnabled, s.disconnectSoundEnabled, s.outputDeviceID,
    s.connectSoundVolume, s.disconnectSoundVolume, s.peerVoiceCues]);
  const previewAllowed = (event: VoiceAnnouncementEvent) => {
    const current = latest.current;
    const peer = event === "peerJoined" || event === "peerLeft";
    const leaving = event === "disconnected" || event === "peerLeft";
    return !current.peerVoiceCues.dnd && !current.isDeafened && !current.isServerDeafened && current.outputVolume > 0 &&
      (!peer || current.peerVoiceCues.enabled) && (leaving ? current.disconnectSoundEnabled : current.connectSoundEnabled);
  };
  const preview = (event: VoiceAnnouncementEvent) => {
    playback.current?.stop();
    const url = voiceSoundUrl(event, config, s); if (!url || !previewAllowed(event)) return;
    const leaving = event === "disconnected" || event === "peerLeft";
    const peer = event === "peerJoined" || event === "peerLeft";
    playback.current = playNotificationSound(url, peer ? (leaving ? s.peerVoiceCues.leaveVolume : s.peerVoiceCues.joinVolume) :
      (leaving ? s.disconnectSoundVolume : s.connectSoundVolume), { shouldPlay: () => previewAllowed(event) });
  };
  return <SettingGroup anchorId="voice-announcements" title="中文事件播报" description="连接、断开、成员进出与移动使用真实语音事件。播报按顺序播放；切换频道或离开时取消旧播报。">
    <Select label="事件播报声音包" value={config.pack}
      onValueChange={value => s.setVoiceAnnouncements({ ...config, pack: value as VoiceSoundPack })}
      options={[
        { value: "classic", label: "经典提示音" },
        ...(MANBO_PACK_AVAILABLE ? [{ value: "manbo", label: "曼波中文人声" }] : []),
        { value: "custom", label: "自定义事件音频" },
      ]} />
    {config.pack === "manbo" && !MANBO_PACK_AVAILABLE && <p className="text-xs text-gryt-muted">此版本没有完整曼波声音包，当前使用经典提示音。</p>}
    <p className="text-xs text-gryt-muted">沿用连接／断开开关、音量和输出设备；已有自定义连接／断开音频优先。免打扰或关闭语音声音时保持安静；主动关闭时仅确认一次“语音声音已关闭”。</p>
    {config.pack === "manbo" && MANBO_PACK_AVAILABLE && <p className="text-xs text-gryt-muted">曼波默认播报音量为 75%。已保存的音量保持不变；可在下方连接／断开音量和成员进出音量中调整。试听与实际播报使用相同音量。</p>}
    <div className="grid gap-2 text-sm">
      {(Object.entries(VOICE_PHRASES) as [VoiceAnnouncementEvent, string][]).map(([event, phrase]) => <div className="flex items-center justify-between gap-2" key={event}>
        <span>{phrase}</span><Button size="small" onClick={() => preview(event)}
          disabled={!previewAllowed(event) || !voiceSoundUrl(event, config, s)}
          aria-label={`试听：${phrase}`}>试听</Button>
      </div>)}
    </div>
    {config.pack === "custom" && (Object.entries(VOICE_PHRASES) as [VoiceAnnouncementEvent, string][]).map(([event, phrase]) => {
      const leaving = event === "disconnected" || event === "peerLeft"; const peer = event === "peerJoined" || event === "peerLeft";
      return <SoundSettings key={event} label={phrase} description="导入此事件的音频；未导入的事件保持静音。单个文件最多 1 MB。"
        enabled={leaving ? s.disconnectSoundEnabled : s.connectSoundEnabled}
        onEnabledChange={leaving ? s.setDisconnectSoundEnabled : s.setConnectSoundEnabled}
        volume={peer ? (leaving ? s.peerVoiceCues.leaveVolume : s.peerVoiceCues.joinVolume) : (leaving ? s.disconnectSoundVolume : s.connectSoundVolume)}
        onVolumeChange={volume => peer ? s.setPeerVoiceCues({ ...s.peerVoiceCues, [leaving ? "leaveVolume" : "joinVolume"]: volume }) :
          (leaving ? s.setDisconnectSoundVolume(volume) : s.setConnectSoundVolume(volume))}
        defaultVolume={voiceSoundDefaultVolume(event, config, s)} customSoundFile={config.custom[event] ?? null}
        shouldPlay={() => previewAllowed(event)}
        onCustomSoundFileChange={file => s.setVoiceAnnouncements({ ...config, custom: { ...config.custom, [event]: file ?? undefined } })}
        defaultSoundSrc={voiceSoundUrl(event, config, s) ?? ""} showAlert={showAlert} />;
    })}
  </SettingGroup>;
}
