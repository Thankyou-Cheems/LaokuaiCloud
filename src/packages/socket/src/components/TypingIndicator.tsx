import { Avatar } from "@gryt/ui";
import { AnimatePresence, motion } from "motion/react";

import { getUploadsFileUrl, resolveAvatarSrc } from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import type { TypingUser } from "../hooks/useTypingIndicator";

interface TypingIndicatorProps {
  typingUsers: TypingUser[];
  serverHost?: string;
}

function buildLabel(users: TypingUser[]): string {
  if (users.length === 1) return socketI18n.t("socketFull.typingIndicator_d4b7558c35", { p0: (users[0].nickname) });
  if (users.length === 2) return socketI18n.t("socketFull.typingIndicator_beb295fcf4", { p0: (users[0].nickname), p1: (users[1].nickname) });
  return socketI18n.t("socketFull.typingIndicator_28890f4aab");
}

export function TypingIndicator({ typingUsers, serverHost }: TypingIndicatorProps) {
  useSocketTranslation();
  const first = typingUsers[0] as TypingUser | undefined;

  return (
    <AnimatePresence>
      {typingUsers.length > 0 && (
        <motion.div
          key="typing-indicator"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          style={{ overflow: "hidden" }}
        >
          <div className="flex items-center gap-1" style={{ padding: "2px 12px 4px" }}>
            {/* 16px — this sits inline with 13px text, so it is closer to a
                glyph than to an avatar. */}
            {first && (
              <Avatar
                size="small"
                className="h-4 w-4 shrink-0 text-[9px]"
                fallback={first.nickname[0]}
                src={resolveAvatarSrc(first.avatarFileId && serverHost ? getUploadsFileUrl(serverHost, first.avatarFileId, { thumb: true }) : undefined, first.nickname, first.avatarWorn)}
              />
            )}
            <span className="text-xs" style={{ color: "var(--gryt-neutral-11)", fontSize: 13 }}>
              {buildLabel(typingUsers)}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
