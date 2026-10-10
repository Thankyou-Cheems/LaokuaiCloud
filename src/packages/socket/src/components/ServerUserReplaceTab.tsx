import { Avatar, Button, Surface, TextField } from "@gryt/ui";
import { useCallback, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Trans } from "react-i18next";
import type { Socket } from "socket.io-client";

import { getUploadsFileUrl, resolveAvatarSrc } from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { useSocketEvent } from "../hooks/useSocketEvent";
import { useSockets } from "../hooks/useSockets";
import { formatJoined } from "../lib/memberFacts";
import { ConfirmDialog } from "./ConfirmDialog";
import type { MemberInfo } from "./MemberSidebar";

interface ReplaceSuccessPayload {
  targetServerUserId: string;
  oldGrytUserId: string;
  newGrytUserId: string;
  ownerUpdated: boolean;
}

function filterMembers(members: MemberInfo[], query: string): MemberInfo[] {
  if (!query) return members.slice(0, 12);
  const q = query.toLowerCase();
  return members
    .filter(
      (m) =>
        m.nickname.toLowerCase().includes(q) ||
        m.serverUserId.toLowerCase().includes(q),
    )
    .slice(0, 12);
}

function MemberDropdownItem({
  member,
  host,
  onSelect,
}: {
  member: MemberInfo;
  host: string;
  onSelect: (id: string) => void;
}) {
  useSocketTranslation();
  return (
    <div
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect(member.serverUserId);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderRadius: "var(--gryt-radius-sm)",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gryt-neutral-4)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <Avatar
        size="small"
        className="h-6 w-6 text-[10px]"
        fallback={member.nickname[0]}
        src={resolveAvatarSrc(member.avatarFileId ? getUploadsFileUrl(host, member.avatarFileId, { thumb: true }) : undefined, member.nickname, member.avatarWorn)}
        style={{ flexShrink: 0 }}
      />
      <div className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
        <span className="text-sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {member.nickname}
        </span>
        <span className="text-xs">{socketI18n.t("ui.joined")}{" "}{formatJoined(member.createdAt) ?? socketI18n.t("shellFull.microphoneDebugOverlay_tsx_bc7819b34f")}
        </span>
      </div>
    </div>
  );
}

function MemberCombobox({
  value,
  onChange,
  members,
  host,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  members: MemberInfo[];
  host: string;
  placeholder: string;
}) {
  useSocketTranslation();
  const [focused, setFocused] = useState(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filtered = filterMembers(members, value);
  const selectedMember = members.find((m) => m.serverUserId === value);

  const displayValue = selectedMember ? selectedMember.nickname : value;

  const handleSelect = useCallback(
    (id: string) => {
      onChange(id);
      setFocused(false);
    },
    [onChange],
  );

  return (
    <div style={{ position: "relative" }}>
      <div className="flex gap-2 items-center">
        {selectedMember && (
          <Avatar
            size="small"
            className="h-6 w-6 text-[10px]"
            fallback={selectedMember.nickname[0]}
            src={resolveAvatarSrc(selectedMember.avatarFileId ? getUploadsFileUrl(host, selectedMember.avatarFileId, { thumb: true }) : undefined, selectedMember.nickname, selectedMember.avatarWorn)}
            style={{ flexShrink: 0 }}
          />
        )}
        <TextField
          style={{ flex: 1 }}
          placeholder={placeholder}
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
            setFocused(true);
            if (selectedMember) onChange("");
          }}
          onBlur={() => {
            blurTimeoutRef.current = setTimeout(() => setFocused(false), 150);
          }}
        />
      </div>
      {focused && filtered.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            background: "var(--gryt-neutral-2)",
            border: "1px solid var(--gryt-neutral-6)",
            borderRadius: "var(--gryt-radius-md)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
            maxHeight: 220,
            overflowY: "auto",
            zIndex: 50,
            padding: 4,
          }}
        >
          {filtered.map((m) => (
            <MemberDropdownItem
              key={m.serverUserId}
              member={m}
              host={host}
              onSelect={handleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ServerUserReplaceTab({
  host,
  socket,
  accessToken,
}: {
  host: string;
  socket?: Socket;
  accessToken: string | null;
}) {
  useSocketTranslation();
  const { memberLists, requestMemberList } = useSockets();
  const members = host ? memberLists[host] || [] : [];

  const [targetServerUserId, setTargetServerUserId] = useState("");
  const [newGrytUserId, setNewGrytUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const refresh = () => {
    if (!socket?.connected) return;
    requestMemberList(host);
  };

  useSocketEvent<ReplaceSuccessPayload>(socket, "server:user:replace:success", (payload) => {
    setSubmitting(false);
    toast.success(
      socketI18n.t("socketFull.serverUserReplaceTab_65dab8d0ab", { p0: (payload.targetServerUserId) }) +
        (payload.ownerUpdated ? socketI18n.t("socketFull.serverUserReplaceTab_335069b6c7") : ""),
    );
    setTargetServerUserId("");
    setNewGrytUserId("");
    refresh();
  });

  const handleReplace = () => {
    if (!socket?.connected) return toast.error(socketI18n.t("socketFull.serverUserReplaceTab_213e89eca7"));
    if (!accessToken) return toast.error(socketI18n.t("socketFull.serverUserReplaceTab_097a88ed92"));
    if (!targetServerUserId) return toast.error(socketI18n.t("socketFull.serverUserReplaceTab_5c155040de"));
    if (!newGrytUserId.trim()) return toast.error(socketI18n.t("socketFull.serverUserReplaceTab_1afbbdb3aa"));

    setSubmitting(true);
    socket.emit("server:user:replace", {
      accessToken,
      targetServerUserId,
      newGrytUserId: newGrytUserId.trim(),
    });

    const timeout = setTimeout(() => setSubmitting(false), 10_000);
    const cleanup = () => clearTimeout(timeout);
    socket.once("server:user:replace:success", cleanup);
    socket.once("server:error", () => {
      setSubmitting(false);
      cleanup();
    });
  };

  const selectedMember = members.find((m) => m.serverUserId === targetServerUserId);

  return (
    <div className="flex flex-col gap-4">
      <span className="text-sm">{socketI18n.t("socketFull.serverUserReplaceTab_ae333d0ed0")}</span>

      <Surface>
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-bold mb-1">{socketI18n.t("socketFull.serverUserReplaceTab_06e56a98d4")}</p>
            <MemberCombobox
              value={targetServerUserId}
              onChange={setTargetServerUserId}
              members={members}
              host={host}
              placeholder={socketI18n.t("socketFull.serverUserReplaceTab_3a5a011d04")}
            />
          </div>

          <div>
            <p className="text-sm font-bold mb-1">{socketI18n.t("socketFull.serverUserReplaceTab_44fd7692d1")}</p>
            <MemberCombobox
              value={newGrytUserId}
              onChange={setNewGrytUserId}
              members={members}
              host={host}
              placeholder={socketI18n.t("socketFull.serverUserReplaceTab_dc00931b33")}
            />
            <p className="text-xs mt-1">{socketI18n.t("socketFull.serverUserReplaceTab_e5d511744f")}</p>
          </div>

          <div className="flex justify-end mt-2">
            <Button
              size="small"
              disabled={submitting || !targetServerUserId || !newGrytUserId.trim()}
              onClick={() => setConfirmReplace(true)}
            >
              {submitting ? socketI18n.t("socketFull.serverUserReplaceTab_d2f3788bb7") : socketI18n.t("socketFull.serverUserReplaceTab_bc57662aeb")}
            </Button>
            <ConfirmDialog
              open={confirmReplace}
              onOpenChange={setConfirmReplace}
              title={socketI18n.t("socketFull.serverUserReplaceTab_b5d6dd8280")}
              description={
                <><Trans i18n={socketI18n} i18nKey="socketFull.replaceIdentityDescription" values={{ name: selectedMember?.nickname ?? targetServerUserId }} components={{ name: <strong /> }} /></>
              }
              confirmLabel={socketI18n.t("socketFull.serverUserReplaceTab_723bc307f6")}
              confirmDisabled={submitting}
              onConfirm={handleReplace}
            />
          </div>
        </div>
      </Surface>
    </div>
  );
}
