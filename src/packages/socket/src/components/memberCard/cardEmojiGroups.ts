import type { EmojiPickerGroup } from "@gryt/ui";
import { useMemo, useSyncExternalStore } from "react";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { getCustomEmojis, onCustomEmojisChange } from "../../utils/emojiData";

/** Custom emoji from the server currently open in the client. */
export function useCardEmojiGroups(serverHost?: string): readonly EmojiPickerGroup[] {
  const socketLanguage = useSocketTranslation().i18n.resolvedLanguage;
  const custom = useSyncExternalStore(
    onCustomEmojisChange,
    () => getCustomEmojis(serverHost),
  );
  return useMemo(() => {
    if (custom.length === 0) return [];
    return [{
      id: "server",
      label: socketI18n.t("ui.thisServer", { lng: socketLanguage }),
      items: custom.flatMap((emoji) => emoji.url ? [{
        id: `server:${emoji.name}`,
        name: emoji.name,
        keywords: [...emoji.tags, ...emoji.aliases],
        imageUrl: emoji.url,
      }] : []),
    }];
  }, [custom, socketLanguage]);
}
