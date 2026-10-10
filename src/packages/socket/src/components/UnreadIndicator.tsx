import { Badge } from "@gryt/ui";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

/**
 * The count on a conversation with something waiting. Unread is counted from the
 * connection; mentions come from the server, so one can know without the other.
 */
export function UnreadIndicator({
  unread,
  mentions = 0,
}: {
  /** Messages here that arrived on this connection and nobody has read. */
  unread: number;
  /** Mentions the server is still holding, which a reload keeps and `unread` loses. */
  mentions?: number;
}) {
  useSocketTranslation();
  /* The larger of the two, not `unread || mentions`: neither contains the other,
     so three mentions kept over a reload plus one new reply read as 1. */
  const count = Math.max(unread, mentions);
  if (count <= 0) return null;

  const title =
    mentions > 0
      ? socketI18n.t("socketFull.unreadIndicator_a0f7511c26", { p0: (count), p1: (mentions) })
      : socketI18n.t("socketFull.unreadIndicator_20e9165e41", { p0: (count) });

  return (
    <Badge
      badgeContent={count}
      /* Unread for anything waiting, accent for a message that named you.
         Its own token, so a theme can move it and danger stays destructive. */
      tone={mentions > 0 ? "primary" : "unread"}
      title={title}
      className="shrink-0"
    />
  );
}
