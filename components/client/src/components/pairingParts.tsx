import type { PairingEmoji } from "@gryt/crypto";
import { Spinner } from "@gryt/ui";
import type { ReactNode } from "react";

import { i18n, useTranslation } from "@/i18n";

/* Shared by both sides of linking a device (GRYT-1484), so the two screens being compared
   draw the emoji the same way. */

export function EmojiRow({ emoji }: { emoji: readonly PairingEmoji[] }) {
  useTranslation();
  return (
    <ul className="m-0 grid list-none grid-cols-4 gap-2 p-0" aria-label={i18n.t("shellFull.pairingParts_tsx_470c3799a7")}>
      {emoji.map((e, i) => (
        <li key={i} className="flex flex-col items-center gap-1 rounded-[var(--gryt-radius-md)] bg-gryt-surface-raised py-3">
          <span className="text-4xl leading-none" aria-hidden="true">{e.emoji}</span>
          <span className="text-xs text-gryt-muted">{e.name}</span>
        </li>
      ))}
    </ul>
  );
}

export function Waiting({ children }: { children: ReactNode }) {
  useTranslation();
  return (
    <p className="m-0 flex items-center gap-2 text-sm text-gryt-muted" role="status">
      <Spinner />
      {children}
    </p>
  );
}
