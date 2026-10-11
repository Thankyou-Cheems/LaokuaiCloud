import { Avatar, Button } from "@gryt/ui";

import { resolveAvatarSrc } from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { PiPhoneFill, PiPhoneXFill } from "../../../../lib/icons";
import type { IncomingCall } from "../hooks/useCalls";

interface IncomingCallCardProps {
  call: IncomingCall;
  /** What the conversation is called, so a group says its name rather than one member's. */
  title: string;
  /** The caller's picture, already resolved to a URL, or nothing. */
  avatarUrl?: string;
  avatarWorn?: string | null;
  onAccept: () => void;
  onDecline: () => void;
}

/**
 * Somebody is ringing. A card rather than a dialog, and it has no dismiss: the
 * server withdraws every ring it starts, and a closed ring still rings.
 */
export function IncomingCallCard({
  call,
  title,
  avatarUrl,
  avatarWorn,
  onAccept,
  onDecline,
}: IncomingCallCardProps) {
  useSocketTranslation();
  return (
    <div
      role="alertdialog"
      aria-label={socketI18n.t("socketFull.incomingCallCard_a661ad673b", { p0: (call.from.nickname) })}
      className="fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-3 rounded-(--gryt-radius-lg) border border-gryt-border bg-gryt-surface-raised p-4 shadow-lg"
    >
      <div className="flex items-center gap-3">
        <Avatar
          size="medium"
          fallback={call.from.nickname[0]}
          src={resolveAvatarSrc(avatarUrl, call.from.nickname, avatarWorn)}
        />
        <div className="min-w-0">
          <div className="truncate font-medium text-gryt-text">{title}</div>
          {/* Says who, because in a group the title is the group's name and
              "somebody is calling" is not enough to decide whether to pick up. */}
          <div className="truncate text-xs text-gryt-muted">
            {call.from.nickname}{" "}{socketI18n.t("socketFull.incomingCallCard_7cd954e466")}</div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="small" tone="primary" style={{ flex: 1 }} onClick={onAccept}>
          <span className="flex items-center justify-center gap-2">
            <PiPhoneFill size={14} />{" "}{socketI18n.t("socketFull.incomingCallCard_a950617fb6")}</span>
        </Button>
        <Button size="small" tone="ghost" style={{ flex: 1 }} onClick={onDecline}>
          <span className="flex items-center justify-center gap-2">
            <PiPhoneXFill size={14} />{" "}{socketI18n.t("socketFull.incomingCallCard_dd75a6be62")}</span>
        </Button>
      </div>
    </div>
  );
}
