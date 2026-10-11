import type { NotificationLevel } from "@/common";
import { i18n as socketI18n } from "@/i18n";

/**
 * The four things a channel can be, and the fields they map to. Out of the picker
 * so both dialogs and the sidebar editor can import the mapping.
 */
export type ChannelKind = "chat" | "voice" | "forum" | "automated";

/** What a kind starts at: an automated channel is quiet until somebody says otherwise. */
export function defaultLevelForKind(kind: ChannelKind): NotificationLevel {
  return kind === "automated" ? "none" : "all";
}

/** The same three words as the member's own menu, so the two read alike. */
export const NOTIFICATION_LEVEL_OPTIONS: { label: string; value: NotificationLevel }[] = [
  { get label() { return socketI18n.t("shellFull.NotificationLevelMenu_tsx_4a66d14807"); }, value: "all" },
  { get label() { return socketI18n.t("shellFull.NotificationLevelMenu_tsx_e7be45b885"); }, value: "mentions" },
  { get label() { return socketI18n.t("shellFull.NotificationLevelMenu_tsx_4481948392"); }, value: "none" },
];

export function kindToFields(kind: ChannelKind): {
  type: "text" | "voice";
  layout: "chat" | "forum";
  automated: boolean;
} {
  switch (kind) {
    case "voice": return { type: "voice", layout: "chat", automated: false };
    case "forum": return { type: "text", layout: "forum", automated: false };
    case "automated": return { type: "text", layout: "chat", automated: true };
    default: return { type: "text", layout: "chat", automated: false };
  }
}

export function fieldsToKind(fields: {
  type?: "text" | "voice";
  layout?: "chat" | "forum";
  automated?: boolean;
}): ChannelKind {
  if (fields.type === "voice") return "voice";
  if (fields.automated) return "automated";
  if (fields.layout === "forum") return "forum";
  return "chat";
}
