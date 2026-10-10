import { Skeleton } from "@gryt/ui";

import type { SealDecision } from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { PiArrowBendUpLeftFill, PiChatCircleFill, PiChatsFill, PiSmileyFill, PiSpeakerHighFill, PiTrashFill } from "../../../../lib/icons";
import { EmojiText } from "./EmojiText";

export const MessageHoverToolbar = ({
  onReply,
  onThread,
  hasThread,
  onDelete,
  canDelete,
  quickReactions,
  onQuickReaction,
  onOpenEmojiPicker,
}: {
  onReply?: () => void;
  onThread?: () => void;
  hasThread?: boolean;
  onDelete?: () => void;
  canDelete?: boolean;
  /**
   * The reactions this person uses most, already ordered and padded. Empty when
   * they may not react here, which is why this takes a list not a permission.
   */
  quickReactions?: string[];
  onQuickReaction?: (src: string) => void;
  /** Open the full picker. Passed only when this person may react. */
  onOpenEmojiPicker?: () => void;
}) => {
  useSocketTranslation();
  const showQuick = !!onQuickReaction && !!quickReactions && quickReactions.length > 0;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "1px",
        background: "var(--gryt-neutral-2)",
        border: "1px solid var(--gryt-neutral-6)",
        borderRadius: "var(--gryt-radius-md)",
        padding: "2px 3px",
        boxShadow: "0 2px 10px rgba(0, 0, 0, 0.18)",
        pointerEvents: "auto",
        /* Chrome, not content: the bar sits earlier in the DOM than the text
           it floats over, so a drag copied it too. */
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Reactions first, then a rule, then reply and delete.
          Reacting is the thing people do most and the thing this bar exists
          for, and putting it left of the divider keeps Delete at the far end,
          away from the pointer's path to everything else. */}
      {showQuick && quickReactions.map((src) => (
        <button
          key={src}
          onClick={() => onQuickReaction(src)}
          title={socketI18n.t("socketFull.chatMessage_bab971e4d8", { p0: (src) })}
          aria-label={socketI18n.t("socketFull.chatMessage_bab971e4d8", { p0: (src) })}
          style={{
            background: "none",
            border: "none",
            padding: "3px 5px",
            fontSize: "15px",
            lineHeight: 1,
            borderRadius: "var(--gryt-radius-md)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gryt-neutral-4)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
        >
          <EmojiText text={src} emojiSize={16} disableTooltip />
        </button>
      ))}
      {onOpenEmojiPicker && (
        <button
          onClick={onOpenEmojiPicker}
          title={socketI18n.t("socketFull.chatMessage_76159633ef")}
          aria-label={socketI18n.t("socketFull.chatMessage_76159633ef")}
          style={{
            background: "none",
            border: "none",
            padding: "4px 6px",
            fontSize: "14px",
            lineHeight: 1,
            borderRadius: "var(--gryt-radius-md)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--gryt-neutral-11)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gryt-neutral-4)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
        >
          <PiSmileyFill size={15} />
        </button>
      )}
      {(showQuick || onOpenEmojiPicker) && (onReply || (canDelete && onDelete)) && (
        <span
          aria-hidden="true"
          style={{
            width: "1px",
            alignSelf: "stretch",
            margin: "2px 3px",
            background: "var(--gryt-neutral-6)",
          }}
        />
      )}
      {onReply && (
        <button
          onClick={onReply}
          title={socketI18n.t("socketFull.chatMessage_9a52802256")}
          style={{
            background: "none",
            border: "none",
            padding: "4px 6px",
            fontSize: "14px",
            lineHeight: 1,
            borderRadius: "var(--gryt-radius-md)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--gryt-neutral-11)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gryt-neutral-4)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
        >
          <PiArrowBendUpLeftFill size={14} />
        </button>
      )}
      {onThread && (
        <button
          onClick={onThread}
          title={hasThread ? socketI18n.t("socketFull.chatMessage_4d9ab74e75") : socketI18n.t("socketFull.chatMessage_aa41cfb084")}
          aria-label={hasThread ? socketI18n.t("socketFull.chatMessage_4d9ab74e75") : socketI18n.t("socketFull.chatMessage_aa41cfb084")}
          style={{
            background: "none",
            border: "none",
            padding: "4px 6px",
            fontSize: "14px",
            lineHeight: 1,
            borderRadius: "var(--gryt-radius-md)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: hasThread ? "var(--gryt-accent-11)" : "var(--gryt-neutral-11)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gryt-neutral-4)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
        >
          <PiChatsFill size={14} />
        </button>
      )}
      {canDelete && onDelete && (
        <button
          onClick={onDelete}
          title={socketI18n.t("ui.delete")}
          style={{
            background: "none",
            border: "none",
            padding: "4px 6px",
            fontSize: "14px",
            lineHeight: 1,
            borderRadius: "var(--gryt-radius-md)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--gryt-danger-11)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gryt-danger-3)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
        >
          <PiTrashFill size={14} />
        </button>
      )}
    </div>
  );
};

export const MessageSkeleton = () => {
  useSocketTranslation();
  const skeletonGroups = [
    { lines: ["60%", "80%"] },
    { lines: ["45%"] },
    { lines: ["70%", "50%", "65%"] },
  ];

  return (
    <div className="flex flex-col" style={{ gap: 16, paddingBottom: "16px" }}>
      {skeletonGroups.map((group, i) => (
        <div className="flex gap-3 items-start" key={i} style={{ width: "100%" }}>
          <Skeleton width="51px" height="51px" style={{ borderRadius: "50%", flexShrink: 0 }} />
          <div className="flex flex-col gap-1" style={{ flex: 1 }}>
            <div className="flex items-baseline gap-2" style={{ marginBottom: 2 }}>
              <Skeleton height="14px" width="80px" style={{ opacity: 0.7 }} />
              <Skeleton height="10px" width="40px" style={{ opacity: 0.4 }} />
            </div>
            {group.lines.map((w, j) => (
              <Skeleton key={j} height="16px" width={w} style={{ opacity: 0.5 }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

const ChannelIcon = ({ type, size }: { type: "text" | "voice"; size: number }) =>
  { useSocketTranslation(); return type === "voice" ? <PiSpeakerHighFill size={size} /> : <PiChatCircleFill size={size} />; };

/* Hallmark · component: empty-chat-state · genre: playful · theme: Gryt UI
 * interaction: the existing composer remains the single primary action */
export const WelcomeMessage = ({
  channelName,
  channelType = "text",
  conversationKind = "channel",
  serverName,
  automated = false,
  sealing,
}: {
  channelName?: string;
  channelType?: "text" | "voice";
  conversationKind?: "channel" | "dm";
  serverName?: string;
  /** An automated channel has no "say something" — nobody here can. GRYT-982. */
  automated?: boolean;
  /* Unknown reads as unencrypted, the same way the banner above this treats it:
     of the two ways to be wrong while the keys load, understating is free. */
  sealing?: SealDecision;
}) => { useSocketTranslation(); return (
  <div className="flex w-full max-w-xl flex-col px-6 py-12 sm:px-8">
    <div className="flex items-start gap-4 sm:items-center sm:gap-6">
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center border"
        style={{
          color: "var(--gryt-accent-9)",
          background: "var(--gryt-accent-3)",
          borderColor: "var(--gryt-neutral-7)",
          borderRadius: "var(--gryt-radius-md)",
        }}
        aria-hidden="true"
      >
        {conversationKind === "dm" ? <PiChatCircleFill size={22} /> : <ChannelIcon type={channelType} size={22} />}
      </div>

      <div className="min-w-0">
        <h2
          className="text-3xl font-bold leading-none tracking-tight"
          style={{ color: "var(--gryt-neutral-12)", overflowWrap: "anywhere" }}
        >
          {conversationKind === "dm" ? (
            <>{socketI18n.t("socketFull.chatMessage_08d8f3fdeb")}{" "}<EmojiText text={channelName || socketI18n.t("socketFull.chatMessage_ca856f8cdc")} />.
            </>
          ) : (
            <>
              {channelType === "text" && "#"}
              <EmojiText text={channelName || socketI18n.t("socketFull.chatMessage_fefe53f1b6")} />{" "}{socketI18n.t("socketFull.chatMessage_0e6033b58c")}</>
          )}
        </h2>
        <p className="mt-2 text-lg text-gryt-muted" style={{ maxWidth: "45ch", lineHeight: 1.5 }}>
          {conversationKind === "dm"
            ? sealing?.kind === "seal"
              ? socketI18n.t("socketFull.chatMessage_598cd7e29c")
              : socketI18n.t("socketFull.chatMessage_5805550856")
            : automated
              ? socketI18n.t("socketFull.chatMessage_5df9fa1235")
              : socketI18n.t("socketFull.chatMessage_ff1935c03f")}
        </p>
      </div>
    </div>

    <div className="mt-6 h-px w-full bg-gryt-neutral-6" aria-hidden="true" />
    <p
      className="mt-4 text-xs text-gryt-muted sm:ml-16"
      style={{ maxWidth: "45ch", fontFamily: "var(--code-font-family)" }}
    >
      {conversationKind === "dm"
        ? socketI18n.t("socketFull.chatMessage_b2d3628657", { p0: (serverName || socketI18n.t("socketFull.chatMessage_007b4db740")) })
        : automated
          ? socketI18n.t("socketFull.chatMessage_55d48498f8")
          : socketI18n.t("socketFull.chatMessage_ea8906ab66")}
    </p>
  </div>
); };
