import { i18n } from "@/i18n";
/* The hover card's "In voice" line on the server rail (GRYT-1657). */

/** Up to four names and how many more, for a one-line hover. */
export function inVoiceLine(names: string[]): string {
  if (names.length <= 4) return names.join(", ");
  return i18n.t("shellFull.serverVoiceLine_ts_de13b0f51a", { value0: names.slice(0, 3).join(", "), value1: names.length - 3 });
}

/** Nicknames in a server's voice channels, once each. Mirrors the channel list's own test. */
export function voiceNicknames(clients: Record<string, { serverUserId?: string; nickname: string; voiceChannelId?: string }>): string[] {
  const seen = new Map<string, string>();
  for (const [id, c] of Object.entries(clients)) {
    if (!c.voiceChannelId || c.voiceChannelId.startsWith("dm_")) continue;
    seen.set(c.serverUserId ?? id, c.nickname);
  }
  return [...seen.values()];
}
