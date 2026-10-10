import { Button, Dialog, IconButton, Select, TextField } from "@gryt/ui";
import { useEffect, useMemo, useState } from "react";

import type { NotificationLevel } from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";
import type { SidebarItem } from "@/settings/src/types/server";

import { PiX } from "../../../../lib/icons";
import { type ChannelKind, defaultLevelForKind, kindToFields, NOTIFICATION_LEVEL_OPTIONS } from "./channelKind";
import { ChannelKindPicker } from "./ChannelKindPicker";
import { EmojiText } from "./EmojiText";
import { type ForumTagDraft, ForumTagsField } from "./ForumTagsField";
import { type ChannelPlacement, flattenSidebar } from "./sidebarTree";

/* Prefixed, so no folder id can be mistaken for the top level. An empty value is
   Base UI's placeholder, which would show a picked "No folder" as unpicked. */
const TOP_LEVEL = "top";
const FOLDER_VALUE = "folder:";

/** What the create form collects, mapped onto the channel's stored fields. */
export interface NewChannelOptions {
  name: string;
  type: "text" | "voice";
  layout?: "chat" | "forum";
  automated?: boolean;
  description?: string | null;
  forumTags?: ForumTagDraft[];
  defaultNotificationLevel?: NotificationLevel;
  placement?: ChannelPlacement;
}

interface CreateChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType?: ChannelKind;
  /** Where it goes: a folder picked in advance, and the row it goes under. */
  placement?: ChannelPlacement;
  editor: {
    createChannel: (opts: NewChannelOptions) => void | Promise<void>;
    effectiveSidebarItems: SidebarItem[];
  };
}

export function CreateChannelDialog({ open, onOpenChange, initialType = "chat", placement, editor }: CreateChannelDialogProps) {
  useSocketTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<ChannelKind>(initialType);
  const [tags, setTags] = useState<ForumTagDraft[]>([]);
  // Null until picked by hand, so changing the kind can keep moving it.
  const [level, setLevel] = useState<NotificationLevel | null>(null);
  const effectiveLevel = level ?? defaultLevelForKind(kind);
  const startFolder = placement?.folderId ?? null;
  const [folderId, setFolderId] = useState<string | null>(startFolder);

  const folders = useMemo(
    () => flattenSidebar(editor.effectiveSidebarItems).map((r) => r.item).filter((i) => i.kind === "folder"),
    [editor.effectiveSidebarItems],
  );
  const pickedFolder = folders.some((f) => f.id === folderId) ? folderId : null;

  // Start fresh each time the dialog opens, honouring the type it was opened for.
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setKind(initialType);
      setTags([]);
      setLevel(null);
      setFolderId(startFolder);
    }
  }, [open, initialType, startFolder]);

  const canCreate = name.trim().length > 0;

  const create = () => {
    if (!canCreate) return;
    const fields = kindToFields(kind);
    editor.createChannel({
      name: name.trim(),
      type: fields.type,
      layout: fields.layout,
      automated: fields.automated,
      description: description.trim() || null,
      forumTags: kind === "forum" ? tags : [],
      defaultNotificationLevel: effectiveLevel,
      placement: { folderId: pickedFolder, afterItemId: placement?.afterItemId ?? null },
    });
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <Dialog.Title style={{ margin: 0 }}>{socketI18n.t("socketFull.createChannelDialog_774cade753")}</Dialog.Title>
              <Dialog.Close>
                <IconButton size="xsmall"><PiX size={16} /></IconButton>
              </Dialog.Close>
            </div>

            <span className="text-sm" style={{ color: "var(--gryt-neutral-11)", marginTop: -8 }}>{socketI18n.t("socketFull.createChannelDialog_7f60db2832")}</span>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{socketI18n.t("socketFull.createChannelDialog_005961b03d")}</span>
              <TextField
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); create(); } }}
                placeholder={kind === "voice" ? socketI18n.t("socketFull.createChannelDialog_d7f00ee7fb") : socketI18n.t("socketFull.createChannelDialog_9002450111")}
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{socketI18n.t("socketFull.createChannelDialog_7e4fb732d2")}</span>
              <ChannelKindPicker value={kind} onChange={setKind} />
            </div>

            {kind === "forum" && (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">{socketI18n.t("socketFull.createChannelDialog_1855069ef6")}{" "}<span style={{ color: "var(--gryt-neutral-10)", fontWeight: 400 }}>{socketI18n.t("socketFull.createChannelDialog_855691da5b")}</span>
                </span>
                <ForumTagsField tags={tags} onChange={setTags} />
              </div>
            )}

            {folders.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">{socketI18n.t("ui.folder")}</span>
                <Select
                  value={pickedFolder ? FOLDER_VALUE + pickedFolder : TOP_LEVEL}
                  onValueChange={(v) => {
                    if (typeof v !== "string") return;
                    setFolderId(v.startsWith(FOLDER_VALUE) ? v.slice(FOLDER_VALUE.length) : null);
                  }}
                  options={[
                    { label: socketI18n.t("socketFull.createChannelDialog_271ae6ccc1"), value: TOP_LEVEL },
                    ...folders.map((f) => ({
                      label: <EmojiText text={f.label || socketI18n.t("ui.folder")} disableTooltip />,
                      value: FOLDER_VALUE + f.id,
                    })),
                  ]}
                />
              </div>
            )}

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{socketI18n.t("socketFull.createChannelDialog_bf1ac989af")}</span>
              <Select
                value={effectiveLevel}
                onValueChange={(v) => {
                  if (v === "all" || v === "mentions" || v === "none") setLevel(v);
                }}
                options={NOTIFICATION_LEVEL_OPTIONS}
              />
              <span className="text-xs" style={{ color: "var(--gryt-neutral-11)" }}>{socketI18n.t("socketFull.createChannelDialog_44e37891c9")}</span>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{socketI18n.t("socketFull.createChannelDialog_644c263467")}{" "}<span style={{ color: "var(--gryt-neutral-10)", fontWeight: 400 }}>{socketI18n.t("socketFull.createChannelDialog_855691da5b")}</span>
              </span>
              <TextField
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); create(); } }}
                placeholder={socketI18n.t("socketFull.createChannelDialog_23a625980f")}
              />
            </div>

            <div className="flex flex-wrap justify-end gap-3" style={{ marginTop: 4 }}>
              <Button tone="neutral" size="small" onClick={() => onOpenChange(false)}>{socketI18n.t("ui.cancel")}</Button>
              <Button size="small" onClick={create} disabled={!canCreate}>{socketI18n.t("socketFull.createChannelDialog_774cade753")}</Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
