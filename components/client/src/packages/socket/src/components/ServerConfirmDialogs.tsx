import { Checkbox, Select, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";
import { Trans } from "react-i18next";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";
import type { Channel, SidebarItem } from "@/settings/src/types/server";

import type { MemberInviteInfo } from "../hooks/useAdminActions";
import { BAN_DURATIONS } from "../lib/memberFacts";
import { ConfirmDialog } from "./ConfirmDialog";

interface PendingUser {
  id: string;
  nickname: string;
}

interface ServerConfirmDialogsProps {
  pendingDeleteItem: SidebarItem | null;
  channelById: Map<string, Channel>;
  cancelDelete: () => void;
  confirmDelete: () => void;
  pendingDisconnectUser: PendingUser | null;
  setPendingDisconnectUser: (v: PendingUser | null) => void;
  onDisconnectUser: (id: string) => void;
  pendingKickUser: PendingUser | null;
  setPendingKickUser: (v: PendingUser | null) => void;
  onKickUser: (id: string, reason?: string) => void;
  pendingBanUser: PendingUser | null;
  setPendingBanUser: (v: PendingUser | null) => void;
  onBanUser: (id: string, reason?: string, expiresInMinutes?: number | null, deleteContent?: boolean, revokeInvite?: boolean) => void;
  /** How the member got in, so the ban dialog can offer to close that door too. */
  fetchMemberInvite?: (targetServerUserId: string) => Promise<MemberInviteInfo | null>;
  /** A channel with its own permissions dragged into a folder. */
  pendingFolderMove?: { channelName: string; folderName: string | null } | null;
  answerFolderMove?: (answer: "follow" | "keep" | "cancel") => void;
}

export const ServerConfirmDialogs = ({
  pendingDeleteItem, channelById, cancelDelete, confirmDelete,
  pendingDisconnectUser, setPendingDisconnectUser, onDisconnectUser,
  pendingKickUser, setPendingKickUser, onKickUser,
  pendingBanUser, setPendingBanUser, onBanUser, fetchMemberInvite,
  pendingFolderMove, answerFolderMove,
}: ServerConfirmDialogsProps) => {
  useSocketTranslation();
  // Optional on both: a moderator acting quickly should not have to justify
  // themselves first. Given, the target sees it verbatim; it is logged either way.
  const [kickReason, setKickReason] = useState("");
  const [banReason, setBanReason] = useState("");
  const [banDuration, setBanDuration] = useState<string>("permanent");
  const [banDeleteContent, setBanDeleteContent] = useState(true);
  const [banInvite, setBanInvite] = useState<MemberInviteInfo | null>(null);
  // Defaults to off. Revoking takes the link away from everybody who has it, so
  // it is a decision rather than a consequence.
  const [banRevokeInvite, setBanRevokeInvite] = useState(false);

  // Asked when the dialog opens, so the answer is there by the time somebody
  // has finished typing a reason.
  useEffect(() => {
    if (!pendingBanUser || !fetchMemberInvite) {
      setBanInvite(null);
      setBanRevokeInvite(false);
      return;
    }
    let cancelled = false;
    setBanInvite(null);
    setBanRevokeInvite(false);
    fetchMemberInvite(pendingBanUser.id)
      .then((info) => {
        if (!cancelled) setBanInvite(info);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pendingBanUser, fetchMemberInvite]);

  // Clear when the dialog opens rather than when it closes, so a reason typed
  // for one person can never be carried onto the next.
  useEffect(() => { if (pendingKickUser) setKickReason(""); }, [pendingKickUser]);
  useEffect(() => {
    if (pendingBanUser) { setBanReason(""); setBanDuration("permanent"); setBanDeleteContent(true); }
  }, [pendingBanUser]);

  const deletedChannelName =
    pendingDeleteItem?.kind === "channel"
      ? channelById.get(pendingDeleteItem.channelId ?? pendingDeleteItem.id)?.name || socketI18n.t("socketFull.serverConfirmDialogs_86f33797dc")
      : null;

  return (
  <>
    <ConfirmDialog
      open={!!pendingFolderMove}
      title={socketI18n.t("socketFull.serverConfirmDialogs_10b425fca7")}
      description={socketI18n.t("socketFull.followFolderPermissionDescription", { channel: pendingFolderMove?.channelName, folder: pendingFolderMove?.folderName ? socketI18n.t("socketFull.serverConfirmDialogs_b5150c71e8", { p0: pendingFolderMove.folderName }) : socketI18n.t("socketFull.defaultFolderPermissions") })}
      confirmLabel={socketI18n.t("socketFull.serverConfirmDialogs_68ecd2b3c3")}
      confirmTone="primary"
      secondaryLabel={socketI18n.t("socketFull.serverConfirmDialogs_78bb18ca61")}
      onSecondary={() => answerFolderMove?.("keep")}
      onConfirm={() => answerFolderMove?.("follow")}
      onCancel={() => answerFolderMove?.("cancel")}
    />

    <ConfirmDialog
      open={!!pendingDeleteItem}
      onOpenChange={(open) => { if (!open) cancelDelete(); }}
      title={socketI18n.t("socketFull.serverConfirmDialogs_baa41d112a", { p0: (pendingDeleteItem?.kind === "channel" ? socketI18n.t("socketFull.serverConfirmDialogs_fefe53f1b6") : socketI18n.t("socketFull.serverConfirmDialogs_80104ae852")) })}
      description={
        deletedChannelName
          ? socketI18n.t("socketFull.serverConfirmDialogs_e508c3ebf1", { p0: (deletedChannelName) })
          : socketI18n.t("socketFull.serverConfirmDialogs_2c76fe475f")
      }
      confirmLabel={socketI18n.t("ui.delete")}
      onConfirm={confirmDelete}
    />

    <ConfirmDialog
      open={!!pendingDisconnectUser}
      onOpenChange={(open) => { if (!open) setPendingDisconnectUser(null); }}
      title={socketI18n.t("socketFull.serverConfirmDialogs_9407b15ea0", { p0: (pendingDisconnectUser?.nickname) })}
      description={socketI18n.t("socketFull.serverConfirmDialogs_4408616443", { p0: (pendingDisconnectUser?.nickname) })}
      confirmLabel={socketI18n.t("ui.disconnect")}
      onConfirm={() => {
        if (pendingDisconnectUser) onDisconnectUser(pendingDisconnectUser.id);
        setPendingDisconnectUser(null);
      }}
    />

    <ConfirmDialog
      open={!!pendingKickUser}
      onOpenChange={(open) => { if (!open) setPendingKickUser(null); }}
      title={socketI18n.t("socketFull.serverConfirmDialogs_66d1d932e0", { p0: (pendingKickUser?.nickname) })}
      description={socketI18n.t("socketFull.serverConfirmDialogs_4548841859")}
      confirmLabel={socketI18n.t("socketFull.serverConfirmDialogs_cf95f06020")}
      onConfirm={() => {
        if (pendingKickUser) onKickUser(pendingKickUser.id, kickReason);
        setPendingKickUser(null);
      }}
    >
      <div className="flex flex-col gap-1">
        <span className="text-xs">{socketI18n.t("socketFull.serverConfirmDialogs_f0e4f1991f")}</span>
        <TextField
          value={kickReason}
          onChange={(e) => setKickReason(e.target.value)}
          placeholder={socketI18n.t("socketFull.serverConfirmDialogs_76b40f48f8")}
          maxLength={200}
        />
      </div>
    </ConfirmDialog>

    <ConfirmDialog
      open={!!pendingBanUser}
      onOpenChange={(open) => { if (!open) setPendingBanUser(null); }}
      title={socketI18n.t("socketFull.serverConfirmDialogs_2351ec68d9", { p0: (pendingBanUser?.nickname) })}
      description={socketI18n.t("socketFull.serverConfirmDialogs_3becbde5ab")}
      confirmLabel={socketI18n.t("socketFull.serverConfirmDialogs_19b2282d14")}
      confirmPhrase={pendingBanUser?.nickname}
      confirmPhraseLabel={<><Trans i18n={socketI18n} i18nKey="socketFull.typeBanNameToConfirm" values={{ name: pendingBanUser?.nickname ?? "" }} components={{ name: <strong /> }} /></>}
      onConfirm={() => {
        if (!pendingBanUser) return;
        const minutes = BAN_DURATIONS.find((d) => d.value === banDuration)?.minutes ?? null;
        onBanUser(pendingBanUser.id, banReason, minutes, banDeleteContent, banRevokeInvite);
        setPendingBanUser(null);
      }}
    >
      <div className="flex flex-col gap-1">
        <span className="text-xs">{socketI18n.t("socketFull.serverConfirmDialogs_f0e4f1991f")}</span>
        <TextField
          value={banReason}
          onChange={(e) => setBanReason(e.target.value)}
          placeholder={socketI18n.t("socketFull.serverConfirmDialogs_7d741eb2d5")}
          maxLength={200}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs">{socketI18n.t("socketFull.serverConfirmDialogs_3ccbc2fee3")}</span>
        <Select
          value={banDuration}
          onValueChange={(v) => setBanDuration(String(v))}
          options={BAN_DURATIONS.map((d) => ({ label: d.label, value: d.value }))}
        />
      </div>
      <label className="text-sm" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Checkbox
          checked={banDeleteContent}
          onCheckedChange={(v) => setBanDeleteContent(v === true)}
        />{socketI18n.t("socketFull.serverConfirmDialogs_bef0b9847d")}</label>

      {/*
        Only when there is a live invite to close. A ban on somebody who
        arrived on one achieves less than it looks — an identity with no
        account behind it costs nothing to replace, so they can return on a
        new key with the same code. Offering it here is the moment it can be
        acted on.
      */}
      {banInvite?.code && banInvite.active && (
        <div className="flex flex-col gap-1">
          <label className="text-sm" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Checkbox
              checked={banRevokeInvite}
              onCheckedChange={(v) => setBanRevokeInvite(v === true)}
            />{socketI18n.t("socketFull.serverConfirmDialogs_4588efea4b")}</label>
          <span className="text-xs text-gryt-muted"><Trans i18n={socketI18n} i18nKey="socketFull.revokeJoinedInviteWarning" values={{ code: banInvite.code, count: banInvite.usesConsumed }} components={{ code: <code className="font-mono text-xs text-gryt-text" /> }} count={banInvite.usesConsumed ?? 0} /></span>
        </div>
      )}
      {!banDeleteContent && (
        <span className="text-xs text-gryt-muted">{socketI18n.t("socketFull.serverConfirmDialogs_ada4dfed4f")}</span>
      )}
    </ConfirmDialog>
  </>
  );
};
