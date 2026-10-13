/** Fixed event phrases; only confirmed events produce announcements. */
export const VOICE_PHRASES = {
  connected: "已连接到语音频道",
  disconnected: "已断开语音连接",
  peerJoined: "有成员加入了你的频道",
  peerLeft: "有成员离开了你的频道",
  moved: "你已被移动到另一个频道",
  microphoneMuted: "麦克风已静音",
  microphoneUnmuted: "麦克风已开启",
  outputMuted: "语音声音已关闭",
  outputUnmuted: "语音声音已开启",
} as const;
export type VoiceAnnouncementEvent = keyof typeof VOICE_PHRASES;
export type VoiceSoundPack = "classic" | "manbo" | "custom";
export interface VoiceAnnouncementSettings {
  pack: VoiceSoundPack;
  custom: Partial<Record<VoiceAnnouncementEvent, string>>;
}
export const VOICE_ANNOUNCEMENT_DEFAULTS: VoiceAnnouncementSettings = { pack: "classic", custom: {} };
export function resolveVoiceAnnouncements(value: unknown): VoiceAnnouncementSettings {
  const input = value && typeof value === "object" ? value as Partial<VoiceAnnouncementSettings> : {};
  const custom: VoiceAnnouncementSettings["custom"] = {};
  for (const event of Object.keys(VOICE_PHRASES) as VoiceAnnouncementEvent[]) {
    const url = input.custom?.[event];
    if (typeof url === "string" && url.length <= 1500000 && /^data:audio\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+$/i.test(url)) custom[event] = url;
  }
  return { pack: input.pack === "manbo" || input.pack === "custom" ? input.pack : "classic", custom };
}
export interface AnnouncementPlayback { stop(): void; finished: Promise<boolean> }
interface QueueItem { key: string; arrived: number; allowed(): boolean; play(): AnnouncementPlayback }
/** One bounded queue for self and peer events. Changing rooms cancels active decoding/playback. */
export class VoiceAnnouncementQueue {
  private pending: QueueItem[] = [];
  private active?: AnnouncementPlayback;
  private revision = 0;
  private seen = new Map<string, number>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly now: () => number = Date.now) {}
  enqueue(item: Omit<QueueItem, "arrived">): boolean {
    const arrived = this.now();
    for (const [key, time] of this.seen) if (arrived - time >= 5000) this.seen.delete(key);
    if (!item.allowed() || this.seen.has(item.key) || this.pending.length >= 3) return false;
    this.seen.set(item.key, arrived);
    while (this.seen.size > 256) this.seen.delete(this.seen.keys().next().value!);
    this.pending.push({ ...item, arrived });
    this.drain();
    return true;
  }
  cancel(): void {
    this.revision++; this.pending = [];
    const active = this.active; this.active = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined; active?.stop();
  }
  private drain(): void {
    if (this.active) return;
    let item: QueueItem | undefined;
    while ((item = this.pending.shift())) {
      if (this.now() - item.arrived > 5000 || !item.allowed()) continue;
      const playback = item.play(); const revision = this.revision;
      this.active = playback;
      this.timer = setTimeout(() => playback.stop(), 8000);
      void playback.finished.then(() => {
        if (revision !== this.revision || this.active !== playback) return;
        clearTimeout(this.timer); this.timer = undefined;
        this.active = undefined; this.drain();
      });
      return;
    }
  }
}
/** Recovering transport states are silent; only a terminal exit ends a call. */
export class VoiceConnectionCuePolicy {
  private room = "";
  update(room: string, state: "connected" | "disconnected" | "recovering"): "connected" | "disconnected" | undefined {
    if (state === "connected" && room) {
      if (this.room === room) return;
      this.room = room; return "connected";
    }
    if (state === "disconnected" && this.room) { this.room = ""; return "disconnected"; }
  }
  reset(): void { this.room = ""; }
}
