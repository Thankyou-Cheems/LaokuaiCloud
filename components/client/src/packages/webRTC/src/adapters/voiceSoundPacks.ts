import connectMp3 from "@/audio/src/assets/connect.mp3";
import disconnectMp3 from "@/audio/src/assets/disconnect.mp3";

import { peerCueUrl } from "../../../../lib/peerVoiceCues";
import { VOICE_PHRASES, type VoiceAnnouncementEvent, type VoiceAnnouncementSettings } from "../../../../lib/voiceAnnouncements";

/** Optional private build input. No unreviewed recordings belong in source control. */
const localRecordings = import.meta.glob("/src/private-voice/manbo/*.wav", { eager: true, query: "?url", import: "default" });
export const MANBO_RECORDINGS: Partial<Record<VoiceAnnouncementEvent, string>> = Object.fromEntries(
  Object.entries(localRecordings).map(([path, url]) => [path.split("/").at(-1)!.replace(/\.wav$/, ""), url]),
);
export const MANBO_PACK_AVAILABLE = Object.keys(VOICE_PHRASES).every(event => typeof MANBO_RECORDINGS[event as VoiceAnnouncementEvent] === "string");
export interface GeneratedVoicePackManifest {
  pack: "manbo";
  generatedAt: string;
  provider: string;
  voice: string;
  distribution: "private-test" | "reviewed-public";
  recordings: Partial<Record<VoiceAnnouncementEvent, { file: string; text: string; sha256: string }>>;
}
export const GENERATED_VOICE_MANIFESTS = import.meta.glob<GeneratedVoicePackManifest>("/src/private-voice/manbo/manifest.json", { eager: true, import: "default" });
export function voiceSoundUrl(event: VoiceAnnouncementEvent, config: VoiceAnnouncementSettings,
  legacy: { customConnectSoundFile?: string | null; customDisconnectSoundFile?: string | null } = {}): string | undefined {
  if (event === "connected" && legacy.customConnectSoundFile) return legacy.customConnectSoundFile;
  if (event === "disconnected" && legacy.customDisconnectSoundFile) return legacy.customDisconnectSoundFile;
  if (config.pack === "custom") return config.custom[event];
  if (config.pack === "manbo" && MANBO_PACK_AVAILABLE) return MANBO_RECORDINGS[event];
  if (event === "connected" || event === "moved") return connectMp3;
  if (event === "disconnected") return disconnectMp3;
  if (event === "peerJoined") return peerCueUrl("join");
  if (event === "peerLeft") return peerCueUrl("leave");
}
