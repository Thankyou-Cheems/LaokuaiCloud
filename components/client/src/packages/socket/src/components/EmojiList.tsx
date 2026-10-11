import { Button, IconButton, TextField } from "@gryt/ui";
import { type ChangeEvent, useState } from "react";
import toast from "react-hot-toast";

import { getServerHttpBase } from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { PiCheck, PiPencilSimpleFill, PiTrashFill, PiX } from "../../../../lib/icons";
import { getCustomEmojiUrl } from "../utils/emojiData";
import type { EmojiItem } from "../utils/emojiFileUtils";
import { EMOJI_NAME_RE } from "../utils/emojiFileUtils";
import { ConfirmDialog } from "./ConfirmDialog";

interface EmojiListProps {
  host: string;
  emojis: EmojiItem[];
  loading: boolean;
  effectiveAccessToken: string | null;
  existingNames: Set<string>;
  refresh: () => Promise<void>;
}

export function EmojiList({
  host,
  emojis,
  loading,
  effectiveAccessToken,
  existingNames,
  refresh,
}: EmojiListProps) {
  useSocketTranslation();
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  // The one emoji the trash button asked about. It deleted on the click before (GRYT-1675).
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editingEmoji, setEditingEmoji] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingError, setEditingError] = useState<string | { key: string; values?: Record<string, string | number> } | null>(null);
  const [renaming, setRenaming] = useState(false);

  const base = getServerHttpBase(host);

  const handleDelete = async (emojiName: string) => {
    if (!effectiveAccessToken) {
      toast.error(socketI18n.t("socketFull.emojiList_de851e36a2"));
      return;
    }

    setDeletingName(emojiName);
    try {
      const resp = await fetch(`${base}/api/emojis/${encodeURIComponent(emojiName)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${effectiveAccessToken}` },
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(
          (typeof data?.message === "string" && data.message) ||
          (typeof data?.error === "string" && data.error) ||
          `HTTP ${resp.status}`,
        );
      }

      toast.success(socketI18n.t("socketFull.emojiList_62dd3a705c", { p0: (emojiName) }));
      await refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : socketI18n.t("socketFull.emojiList_1e578e8292"));
    } finally {
      setDeletingName(null);
    }
  };

  const handleDeleteAll = async () => {
    if (!effectiveAccessToken) {
      toast.error(socketI18n.t("socketFull.emojiList_de851e36a2"));
      return;
    }

    setDeletingAll(true);
    try {
      const resp = await fetch(`${base}/api/emojis/all`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${effectiveAccessToken}` },
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(
          (typeof data?.message === "string" && data.message) ||
          (typeof data?.error === "string" && data.error) ||
          `HTTP ${resp.status}`,
        );
      }

      toast.success(socketI18n.t("socketFull.emojiList_c4f4633e72", { p0: (data.deleted ?? socketI18n.t("socketFull.emojiList_c857d9f055")) }));
      await refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : socketI18n.t("socketFull.emojiList_7d26ff7805"));
    } finally {
      setDeletingAll(false);
    }
  };

  const startEditing = (emojiName: string) => {
    setEditingEmoji(emojiName);
    setEditingName(emojiName);
    setEditingError(null);
  };

  const cancelEditing = () => {
    setEditingEmoji(null);
    setEditingName("");
    setEditingError(null);
  };

  const handleRename = async () => {
    if (!editingEmoji || !effectiveAccessToken) return;
    const newName = editingName.trim();
    if (newName === editingEmoji) { cancelEditing(); return; }
    if (!EMOJI_NAME_RE.test(newName)) {
      setEditingError({ key: "socketFull.emojiList_98951ba26d" });
      return;
    }
    if (existingNames.has(newName)) {
      setEditingError({ key: "socketFull.emojiList_95b49d3758", values: { p0: (newName) } });
      return;
    }

    setRenaming(true);
    try {
      const resp = await fetch(`${base}/api/emojis/${encodeURIComponent(editingEmoji)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${effectiveAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newName }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(
          (typeof data?.message === "string" && data.message) ||
          (typeof data?.error === "string" && data.error) ||
          `HTTP ${resp.status}`,
        );
      }
      toast.success(socketI18n.t("socketFull.emojiList_51203b8572", { p0: (editingEmoji), p1: (newName) }));
      cancelEditing();
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : { key: "socketFull.emojiList_51e3c07153" };
      setEditingError(msg);
    } finally {
      setRenaming(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-center">
        <span className="text-sm font-medium">{socketI18n.t("socketFull.emojiList_69820822f7")}{" "}{!loading && `(${emojis.length})`}
        </span>
        {emojis.length > 0 && (
          <>
            <Button size="xsmall" disabled={deletingAll} onClick={() => setConfirmDeleteAll(true)}>
              <PiTrashFill size={14} />
              {deletingAll ? socketI18n.t("socketFull.emojiList_d7dcad67fa") : socketI18n.t("socketFull.emojiList_4552caf55a")}
            </Button>
            <ConfirmDialog
              open={confirmDeleteAll}
              onOpenChange={setConfirmDeleteAll}
              title={socketI18n.t("socketFull.emojiList_5b4dc81c5b")}
              description={socketI18n.t("socketFull.emojiList_e8e2bc5c89", { p0: (emojis.length), count: (emojis.length) })}
              confirmLabel={socketI18n.t("socketFull.emojiList_4552caf55a")}
              onConfirm={handleDeleteAll}
            />
          </>
        )}
      </div>

      {loading ? (
        <span className="text-sm">{socketI18n.t("shellFull.microphoneDebugOverlay_tsx_b04ba49f84")}</span>
      ) : emojis.length === 0 ? (
        <span className="text-sm">{socketI18n.t("socketFull.emojiList_e077a2ecb9")}</span>
      ) : (
        <div className="flex flex-col gap-1">
          {emojis.map((e) => (
            <div className="flex items-center gap-3 py-1 px-2 emoji-row" key={e.name} style={{
                borderRadius: "var(--gryt-radius-sm)",
                transition: "background 120ms",
              }}>
              <img
                src={getCustomEmojiUrl(host, e.name)}
                alt={`:${e.name}:`}
                style={{
                  width: 32,
                  height: 32,
                  objectFit: "contain",
                }}
              />
              {editingEmoji === e.name ? (
                <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex items-center gap-1">
                    <TextField size="small"
                      value={editingName}
                      onChange={(ev: ChangeEvent<HTMLInputElement>) => {
                        const v = ev.target.value.replace(/[^A-Za-z0-9_]/g, "");
                        setEditingName(v);
                        setEditingError(null);
                      }}
                      onKeyDown={(ev: React.KeyboardEvent) => {
                        if (ev.key === "Enter") handleRename();
                        if (ev.key === "Escape") cancelEditing();
                      }}
                      disabled={renaming}
                      autoFocus
                      style={{ flex: 1 }}
                    />
                    <IconButton tone="ghost" size="xsmall"
                      title={socketI18n.t("settingsFull.mefc007a393")}
                      disabled={renaming}
                      onClick={handleRename}
                      style={{ cursor: "pointer", flexShrink: 0 }}
                    >
                      <PiCheck size={14} />
                    </IconButton>
                    <IconButton tone="ghost" size="xsmall"
                      title={socketI18n.t("ui.cancel")}
                      disabled={renaming}
                      onClick={cancelEditing}
                      style={{ cursor: "pointer", flexShrink: 0 }}
                    >
                      <PiX size={14} />
                    </IconButton>
                  </div>
                  {editingError && (
                    <span className="text-xs" style={{ lineHeight: 1.2 }}>
                      {typeof editingError === "string" ? editingError : socketI18n.t(editingError.key, editingError.values)}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-sm" style={{ flex: 1 }}>
                  <code>:{e.name}:</code>
                </span>
              )}
              {editingEmoji !== e.name && (
                <>
                  <IconButton tone="ghost" size="xsmall"
                    onClick={() => startEditing(e.name)}
                    title={socketI18n.t("socketFull.emojiList_6e76c66df6", { p0: (e.name) })}
                    style={{ cursor: "pointer" }}
                  >
                    <PiPencilSimpleFill size={14} />
                  </IconButton>
                  <IconButton tone="ghost" size="xsmall"
                    onClick={() => setConfirmDelete(e.name)}
                    disabled={deletingName === e.name}
                    title={socketI18n.t("socketFull.emojiList_5fe0aee65b", { p0: (e.name) })}
                    style={{ cursor: "pointer" }}
                  >
                    <PiTrashFill size={14} />
                  </IconButton>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}
        title={socketI18n.t("socketFull.emojiList_a64e387e7d", { p0: (confirmDelete ?? "") })}
        description={socketI18n.t("socketFull.emojiList_dc9b018e91")}
        confirmLabel={socketI18n.t("ui.delete")}
        confirmTone="danger"
        onConfirm={() => {
          if (confirmDelete) void handleDelete(confirmDelete);
          setConfirmDelete(null);
        }}
      />
    </div>
  );
}
