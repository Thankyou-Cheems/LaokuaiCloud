import { useCallback, useRef } from "react";

import { playNotificationSound } from "@/lib/notificationSound";
import { useSettings } from "@/settings";

import { type VoiceAnnouncementEvent,VoiceAnnouncementQueue } from "../../../../lib/voiceAnnouncements";
import { voiceSoundUrl } from "./voiceSoundPacks";

const queue = new VoiceAnnouncementQueue();
export function cancelVoiceAnnouncements(): void { queue.cancel(); }
/** Shared serial playback, with current settings checked again after decoding. */
export function useVoiceSounds() {
  const settings = useSettings();
  const latest = useRef(settings); latest.current = settings;
  const announce = useCallback((event: VoiceAnnouncementEvent, key: string, eligible: () => boolean = () => true) => {
    const disconnect = event === "disconnected" || event === "peerLeft";
    const peer = event === "peerJoined" || event === "peerLeft";
    const allowed = () => {
      const s = latest.current;
      // One local confirmation may acknowledge enabling deafen. Other events
      // and previews remain silent; server deafen and DND always take precedence.
      const localOutputOff = event === "outputMuted" && s.isDeafened;
      const matches = event === "microphoneMuted" ? s.isMuted : event === "microphoneUnmuted" ? !s.isMuted :
        event === "outputMuted" ? s.isDeafened : event === "outputUnmuted" ? !s.isDeafened : true;
      return eligible() && matches && !s.peerVoiceCues.dnd && (!s.isDeafened || localOutputOff) && !s.isServerDeafened && s.outputVolume > 0 &&
        (!peer || s.peerVoiceCues.enabled) && (disconnect ? s.disconnectSoundEnabled : s.connectSoundEnabled) &&
        !!voiceSoundUrl(event, s.voiceAnnouncements, s);
    };
    return queue.enqueue({ key: `${event}:${key}`, allowed, play: () => {
      const s = latest.current;
      const volume = peer ? (disconnect ? s.peerVoiceCues.leaveVolume : s.peerVoiceCues.joinVolume) :
        (disconnect ? s.disconnectSoundVolume : s.connectSoundVolume);
      return playNotificationSound(voiceSoundUrl(event, s.voiceAnnouncements, s)!, volume, { shouldPlay: allowed });
    } });
  }, []);
  return { announce };
}
