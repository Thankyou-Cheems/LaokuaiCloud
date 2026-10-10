import { Alert, Button, Chip, Dialog, IconButton, TextField, Toggle, ToggleGroup } from "@gryt/ui";
import { useEffect, useMemo, useState } from "react";

import { useThreadMentions, useThreadUnread } from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";
import type { ForumTag } from "@/settings/src/types/server";

import { PiChatsFill, PiCheck, PiLockSimpleFill, PiPlus, PiX } from "../../../../lib/icons";
import { type ForumFilter, type ForumTopic,useForum } from "../hooks/useForum";
import type { ThreadSummary } from "../hooks/useThreads";
import { EmojiText } from "./EmojiText";
import { ForumTagChip } from "./ForumTagChip";
import { UnreadIndicator } from "./UnreadIndicator";

interface ForumViewProps {
  socketConnection: unknown;
  conversationId: string;
  serverHost?: string;
  currentUserId?: string;
  forumTags: ForumTag[];
  onOpenTopic: (summary: ThreadSummary) => void;
  /** Said in place of New topic, for somebody who may not post here. */
  readOnlyLine?: string;
}

const FILTERS: { key: ForumFilter; label: string }[] = [
  { key: "all", get label() { return socketI18n.t("settingsFull.m6a72085653"); } },
  { key: "unanswered", get label() { return socketI18n.t("socketFull.forumView_d8543e847b"); } },
  { key: "solved", get label() { return socketI18n.t("socketFull.forumView_ede4b534e0"); } },
  // All leaves closed topics out, so without this one there is no way back to
  // them (GRYT-1389).
  { key: "closed", get label() { return socketI18n.t("socketFull.forumView_b878cc5a64"); } },
  { key: "mine", get label() { return socketI18n.t("socketFull.forumView_91e08e2fca"); } },
];

function relativeTime(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return socketI18n.t("socketFull.forumView_4ac5067f5d");
  const mins = Math.floor(secs / 60);
  if (mins < 60) return socketI18n.t("socketFull.forumView_b589b68d0d", { p0: (mins) });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return socketI18n.t("socketFull.forumView_df92c47e0a", { p0: (hours) });
  const days = Math.floor(hours / 24);
  if (days === 1) return socketI18n.t("socketFull.forumView_14b56a929e");
  if (days < 7) return socketI18n.t("socketFull.forumView_e695ad81d3", { p0: (days) });
  return new Date(value).toLocaleDateString(socketI18n.resolvedLanguage, { month: "short", day: "numeric" });
}

function toSummary(t: ForumTopic): ThreadSummary {
  return {
    thread_id: t.thread_id,
    conversation_id: t.conversation_id,
    root_message_id: t.root_message_id,
    title: t.title,
    status: t.status,
    reply_count: t.reply_count,
    last_message_at: t.last_message_at,
    // The panel gates its controls on this, so it is right from the first
    // frame rather than only once thread:history lands.
    created_by: t.created_by,
    tags: t.tags,
  };
}

function matchesFilter(t: ForumTopic, filter: ForumFilter, currentUserId?: string): boolean {
  switch (filter) {
    // A solved topic is answered even with no replies — the author settled it.
    case "unanswered": return t.reply_count === 0 && t.status === "open";
    case "solved": return t.status === "solved";
    case "closed": return t.status === "closed";
    case "mine": return !!currentUserId && t.created_by === currentUserId;
    default: return t.status !== "closed";
  }
}

export function ForumView({ socketConnection, conversationId, serverHost, currentUserId, forumTags, onOpenTopic, readOnlyLine }: ForumViewProps) {
  useSocketTranslation();
  const { topics, loading, creating, createError, createdToken, clearCreateError, createTopic } = useForum(socketConnection, conversationId, serverHost);
  const [filter, setFilter] = useState<ForumFilter>("all");
  const { threadUnreadCount } = useThreadUnread();
  const { threadMentionCount } = useThreadMentions();
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [newTags, setNewTags] = useState<Set<string>>(new Set());
  const tagById = useMemo(() => new Map(forumTags.map((t) => [t.id, t])), [forumTags]);
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

  const shown = useMemo(
    () => topics.filter((t) =>
      matchesFilter(t, filter, currentUserId) &&
      (selectedTags.size === 0 || t.tags.some((id) => selectedTags.has(id)))),
    [topics, filter, currentUserId, selectedTags],
  );

  const counts = useMemo(() => ({
    all: topics.filter((t) => t.status !== "closed").length,
    unanswered: topics.filter((t) => t.reply_count === 0 && t.status === "open").length,
    solved: topics.filter((t) => t.status === "solved").length,
    closed: topics.filter((t) => t.status === "closed").length,
    mine: topics.filter((t) => !!currentUserId && t.created_by === currentUserId).length,
  }), [topics, currentUserId]);

  // Mirrors the server's cap so an over-long post is caught before a round trip.
  const BODY_MAX = 4000;
  const tooLong = body.length > BODY_MAX;
  const canSubmit = !!title.trim() && !!body.trim() && !tooLong && !creating;

  const submit = () => {
    if (!canSubmit) return;
    // Nothing is cleared or closed here. The composer closes when the server
    // accepts the topic (createdToken), so a refusal keeps what was typed.
    createTopic(title, body, [...newTags]);
  };

  useEffect(() => {
    if (createdToken === 0) return;
    setTitle("");
    setBody("");
    setNewTags(new Set());
    setComposing(false);
  }, [createdToken]);

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2.5 border-b border-gryt-border pb-3">
        {/* Base UI hands back an array and clears it when the pressed one is
            pressed again. There is always a filter, so an empty answer means
            "no change" rather than "none". */}
        <ToggleGroup
          value={[filter]}
          onValueChange={(next) => {
            const picked = next[0];
            if (picked) setFilter(picked as ForumFilter);
          }}
          multiple={false}
        >
          {FILTERS.map((f) => (
            <Toggle key={f.key} value={f.key} tone="neutral" size="xsmall">
              {f.label}
              <span className="ml-1 tabular-nums opacity-70">{counts[f.key]}</span>
            </Toggle>
          ))}
        </ToggleGroup>
        <span className="flex-1" />
        {readOnlyLine ? (
          <span className="text-sm text-gryt-muted">{readOnlyLine}</span>
        ) : (
          <Button
            size="small"
            startIcon={<PiPlus size={14} />}
            onClick={() => { setNewTags(new Set()); setComposing(true); }}
          >{socketI18n.t("socketFull.forumView_a542a71098")}</Button>
        )}
      </div>

      {forumTags.length > 0 && (
        <div className="flex flex-wrap gap-[7px] border-b border-gryt-neutral-3 pt-2.5 pb-3">
          {forumTags.map((tag) => (
            <ForumTagChip
              key={tag.id}
              tag={tag}
              active={selectedTags.has(tag.id)}
              onToggle={() => setSelectedTags((s) => toggle(s, tag.id))}
            />
          ))}
        </div>
      )}

      {/* Topic list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: 24, color: "var(--gryt-neutral-10)", fontSize: 13 }}>{socketI18n.t("socketFull.forumView_30edf210c9")}</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--gryt-neutral-10)" }}>
            <PiChatsFill size={28} style={{ opacity: 0.5 }} />
            <p style={{ marginTop: 8, fontSize: 14 }}>
              {topics.length === 0 ? socketI18n.t("socketFull.forumView_0260906519") : socketI18n.t("socketFull.forumView_45ddfe132b")}
            </p>
          </div>
        ) : (
          shown.map((t) => (
            <button
              key={t.thread_id}
              onClick={() => onOpenTopic(toSummary(t))}
              style={{
                display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 16px", alignItems: "center", width: "100%",
                textAlign: "left", background: "transparent", border: "none",
                borderBottom: "1px solid var(--gryt-neutral-3)", padding: "11px 4px", cursor: "pointer",
              }}
              /* Hover through CSS rather than writing to style on every pointer
                 event, which left the row stuck on a re-render. */
              className="hover:bg-gryt-neutral-3"
            >
              <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--gryt-neutral-12)", gridColumn: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <EmojiText text={t.title || t.preview || socketI18n.t("socketFull.forumView_8dd7c503c5")} />
              </div>
              {t.tags.length > 0 && (
                <div style={{ gridColumn: 1 }} className="flex flex-wrap items-center gap-1.5">
                  {t.tags.map((id) => {
                    const tag = tagById.get(id);
                    return tag ? <ForumTagChip key={id} tag={tag} /> : null;
                  })}
                </div>
              )}
              <div style={{ gridColumn: 1, color: "var(--gryt-neutral-10)", fontSize: 12, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span>{t.creator_nickname || socketI18n.t("socketFull.forumView_e7e4044b27")}</span>
                <span>·</span>
                <span>{t.reply_count} {t.reply_count === 1 ? socketI18n.t("socketFull.forumView_1af3b3bc0d") : socketI18n.t("socketFull.forumView_5dd1d7fbb1")}</span>
                <span>·</span>
                <span>{t.participant_count} {t.participant_count === 1 ? socketI18n.t("socketFull.forumView_d6f66d007a") : socketI18n.t("socketFull.forumView_e0bd1642af")}</span>
                <span>·</span>
                <span>{relativeTime(t.last_message_at)}</span>
              </div>
              {/* Replies since this window connected. Sits with the solved
                  chip on the right, so the row reads title, tags, who and when
                  on the left and its state on the right. */}
              <div style={{ gridRow: "1 / 3", gridColumn: 2 }} className="flex items-center gap-2 self-center">
              <UnreadIndicator
                unread={threadUnreadCount(serverHost ?? "", t.thread_id)}
                mentions={threadMentionCount(serverHost ?? "", t.thread_id)}
              />
              {t.status === "solved" && (
                /* The success tone, rather than the #5cc79a it hardcoded — that
                   green was picked against the dark theme. */
                <Chip
                  tone="success"
                  icon={<PiCheck size={11} />}
                  label={socketI18n.t("socketFull.forumView_ede4b534e0")}
                  className="px-2.5 py-0.5 text-[11px] whitespace-nowrap"
                />
              )}
              {t.status === "closed" && (
                <Chip
                  tone="neutral"
                  icon={<PiLockSimpleFill size={11} />}
                  label={socketI18n.t("socketFull.forumView_b878cc5a64")}
                  className="px-2.5 py-0.5 text-[11px] whitespace-nowrap"
                />
              )}
              </div>
            </button>
          ))
        )}
      </div>

      {/* New topic dialog. A real one: it was a scrim div with a
          click-outside check on e.target, so it had no focus trap, nothing on
          escape, and it rendered inside the forum's own stacking context. */}
      <Dialog.Root
        open={composing}
        onOpenChange={(open) => {
          if (!open) clearCreateError();
          setComposing(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Dialog.Title style={{ margin: 0 }}>{socketI18n.t("socketFull.forumView_a542a71098")}</Dialog.Title>
                <Dialog.Close>
                  <IconButton size="xsmall"><PiX size={16} /></IconButton>
                </Dialog.Close>
              </div>

              <TextField
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={socketI18n.t("socketFull.forumView_5bdb7dcf4a")}
                autoFocus
                maxLength={200}
              />
              <TextField
                multiline
                minRows={5}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={socketI18n.t("socketFull.forumView_30e9b03347")}
              />

              {forumTags.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">{socketI18n.t("socketFull.forumView_1855069ef6")}</span>
                  <div className="flex flex-wrap gap-[7px]">
                    {forumTags.map((tag) => (
                      <ForumTagChip
                        key={tag.id}
                        tag={tag}
                        active={newTags.has(tag.id)}
                        onToggle={() => setNewTags((s) => toggle(s, tag.id))}
                      />
                    ))}
                  </div>
                </div>
              )}

              {(createError || tooLong) && (
                <Alert severity="error" className="text-xs">
                  {tooLong
                    ? socketI18n.t("socketFull.forumView_1e0e3857cd", { p0: (body.length - BODY_MAX), p1: (BODY_MAX) })
                    : createError}
                </Alert>
              )}

              <div className="flex flex-wrap justify-end gap-3">
                <Dialog.Close>
                  <Button tone="neutral" size="small">{socketI18n.t("ui.cancel")}</Button>
                </Dialog.Close>
                <Button size="small" onClick={submit} disabled={!canSubmit}>
                  {creating ? socketI18n.t("settingsFull.m94d7d8ee47") : socketI18n.t("socketFull.forumView_9769939040")}
                </Button>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
