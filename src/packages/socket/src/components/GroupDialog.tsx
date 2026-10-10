import { Avatar, Button, Checkbox, Dialog, TextField } from "@gryt/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import {
  getServerAccessToken,
  getServerHttpBase,
  getUploadsFileUrl,
  resolveAvatarSrc,
} from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { conversationTitle, type DirectConversation } from "../hooks/useDirectMessages";
import { socketDisplayText, socketHookToast } from "../utils/socketHookMessages";
import { uploadGroupPicture } from "../utils/uploadGroupPicture";
import { EmojiText } from "./EmojiText";
import type { MemberInfo } from "./MemberSidebar";

/**
 * A group's picture and name. Group settings shows them, and so does the step after
 * starting one in the new-message dialog; each decides when a change is sent.
 */
export function GroupFaceFields({
  serverHost,
  seed,
  icon,
  onIcon,
  name,
  onName,
  onNameDone,
  placeholder,
  autoFocus = false,
}: {
  serverHost: string;
  /** What the egg is drawn from, live, so it changes as the name is typed. */
  seed: string;
  /** The picture shown: an upload's file id, or null for the egg. */
  icon: string | null;
  onIcon: (fileId: string | null) => void;
  name: string;
  onName: (name: string) => void;
  /** Focus left the field, or Enter was pressed. */
  onNameDone?: () => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  useSocketTranslation();
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const token = getServerAccessToken(serverHost);
      if (!token) throw new Error(socketI18n.t("socketFull.groupDialog_ba6c2246db"));
      onIcon(await uploadGroupPicture(getServerHttpBase(serverHost), token, file, file.name || "group.png"));
    } catch (error) {
      toast.error(socketHookToast(() => error instanceof Error ? socketDisplayText(error.message) : socketI18n.t("socketFull.groupDialog_323d7a57ed")));
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div className="flex flex-col items-center gap-1">
        <Avatar
          size="large"
          className="h-20 w-20 rounded-(--gryt-radius-md) text-2xl"
          eggSeed={seed}
          src={icon ? getUploadsFileUrl(serverHost, icon, { thumb: true }) : undefined}
        />

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="small"
            tone="ghost"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? socketI18n.t("socketFull.groupDialog_1c9f0a06e8") : socketI18n.t("socketFull.groupDialog_d9383d8951")}
          </Button>
          {icon && (
            <Button size="small" tone="ghost" onClick={() => onIcon(null)}>{socketI18n.t("socketFull.groupDialog_46c319112f")}</Button>
          )}
        </div>

        <span className="text-xs text-gryt-muted">
          {icon ? socketI18n.t("socketFull.groupDialog_6daf67fa79") : socketI18n.t("socketFull.groupDialog_53eb26147d")}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold">{socketI18n.t("settingsFull.m709a23220f")}</span>
        <TextField
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={name}
          onChange={(e) => onName(e.target.value)}
          onBlur={onNameDone}
          onKeyDown={(e) => {
            if (e.key === "Enter") onNameDone?.();
          }}
          maxLength={80}
        />
        <span className="text-xs text-gryt-muted">{socketI18n.t("socketFull.groupDialog_4de3b028e7")}</span>
      </div>
    </>
  );
}

/**
 * A group's settings. There is no owner: anybody in it can rename it, add somebody
 * or leave, and nobody can remove anybody else. Starting one is `NewMessageDialog`.
 */
export const GroupDialog = ({
  open,
  onOpenChange,
  members,
  serverHost,
  currentServerUserId,
  existing,
  canAdd,
  onUpdate,
  onAdd,
  onLeave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Everybody on the server, to add from. */
  members: MemberInfo[];
  serverHost: string;
  currentServerUserId?: string;
  /** The group these are the settings of. Nothing opens without one. */
  existing?: DirectConversation;
  /** `create_groups`, which adding somebody asks for as well. */
  canAdd: boolean;
  onUpdate: (
    conversationId: string,
    changes: { name?: string | null; iconFileId?: string | null },
  ) => void;
  onAdd: (conversationId: string, targetServerUserId: string) => void;
  onLeave: (conversationId: string) => void;
}) => {
  useSocketTranslation();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [iconFileId, setIconFileId] = useState<string | null>(null);

  /* Reset every time it opens rather than on mount. The dialog outlives one
     use of it, so a previous group's fields would still be there next time. */
  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? "");
    setPicked(existing ? existing.members.map((m) => m.server_user_id) : []);
    setIconFileId(existing?.icon_file_id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.conversation_id]);

  /** Everybody who could be added: not you, and not a bot, which the server refuses. */
  const candidates = useMemo(
    () =>
      members
        .filter((m) => m.serverUserId !== currentServerUserId && !m.isBot)
        .sort((a, b) => a.nickname.localeCompare(b.nickname)),
    [members, currentServerUserId],
  );

  const alreadyIn = useMemo(
    () => new Set(existing?.members.map((m) => m.server_user_id) ?? []),
    [existing],
  );

  if (!existing) return null;

  // Adding is one-way once picked: there is no Save to cancel out of, so a
  // click here goes straight to the server (GRYT-1350).
  const toggle = (serverUserId: string) => {
    if (alreadyIn.has(serverUserId) || picked.includes(serverUserId)) return;
    setPicked((prev) => [...prev, serverUserId]);
    onAdd(existing.conversation_id, serverUserId);
  };

  const commitIcon = (fileId: string | null) => {
    setIconFileId(fileId);
    if (fileId !== (existing.icon_file_id ?? null)) {
      onUpdate(existing.conversation_id, { iconFileId: fileId });
    }
  };

  const commitName = () => {
    const trimmed = name.trim();
    if ((existing.name ?? "") !== trimmed) {
      onUpdate(existing.conversation_id, { name: trimmed || null });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <Dialog.Title>{socketI18n.t("socketFull.groupDialog_d81e53b508")}</Dialog.Title>
          <Dialog.Description>
            {canAdd
              ? socketI18n.t("socketFull.groupDialog_a299d03d2b")
              : socketI18n.t("socketFull.groupDialog_c18bfed4ea")}
          </Dialog.Description>

          <div className="flex flex-col gap-4">
            <GroupFaceFields
              serverHost={serverHost}
              seed={name.trim() || conversationTitle(existing)}
              icon={iconFileId}
              onIcon={commitIcon}
              name={name}
              onName={setName}
              onNameDone={commitName}
              placeholder={conversationTitle(existing)}
              autoFocus
            />

            {canAdd && (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-bold">{socketI18n.t("socketFull.groupDialog_0f9fa15c85")}</span>
                <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
                  {candidates.map((member) => {
                    const inAlready = alreadyIn.has(member.serverUserId);
                    return (
                      <label
                        key={member.serverUserId}
                        className="flex cursor-pointer items-center gap-2 rounded-(--gryt-radius-md) px-2 py-1 hover:bg-gryt-surface-raised"
                      >
                        <Checkbox
                          checked={inAlready || picked.includes(member.serverUserId)}
                          disabled={inAlready || picked.includes(member.serverUserId)}
                          onCheckedChange={() => toggle(member.serverUserId)}
                        />
                        <Avatar
                          size="small"
                          fallback={member.nickname[0]}
                          src={resolveAvatarSrc(
                            member.avatarFileId
                              ? getUploadsFileUrl(serverHost, member.avatarFileId, { thumb: true })
                              : undefined,
                            member.nickname,
                            member.avatarWorn,
                          )}
                        />
                        <span className="truncate text-sm">
                          <EmojiText text={member.nickname} />
                        </span>
                        {inAlready && (
                          <span className="ml-auto text-xs text-gryt-muted">{socketI18n.t("socketFull.groupDialog_84480f5938")}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <Dialog.Footer className="flex-wrap justify-between">
            <Button
              tone="danger"
              onClick={() => {
                onLeave(existing.conversation_id);
                onOpenChange(false);
              }}
            >{socketI18n.t("socketFull.groupDialog_5b9a630052")}</Button>
            <Button onClick={() => onOpenChange(false)}>{socketI18n.t("shellFull.approveDevice_tsx_e9b450d14b")}</Button>
          </Dialog.Footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
