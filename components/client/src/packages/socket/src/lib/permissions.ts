import { i18n as socketI18n } from "@/i18n";
import type { Channel } from "@/settings/src/types/server";

/**
 * The permissions a role can carry, and how to talk about them. The server owns
 * the list; what lives here is the grouping, labels and descriptions.
 */

/**
 * What a server knew about before it published a catalogue, used as the one it
 * did not send. Frozen: it describes a release that has already happened.
 */
export const PERMISSIONS_BEFORE_CATALOGUE: readonly string[] = [
  "send_messages",
  "attach_files",
  "add_reactions",
  "join_voice",
  "speak",
  "share_video",
  "share_screen",
  "change_nickname",
  "change_avatar",
  "create_invite",
  "manage_invites",
  "manage_messages",
  "kick_members",
  "ban_members",
  "mute_members",
  "manage_reports",
  "manage_join_requests",
  "manage_channels",
  "manage_emojis",
  "manage_webhooks",
  "manage_roles",
  "manage_server",
  "view_audit_log",
];

/** The fourteen a channel or folder can allow or deny, and so the ones a
    channel's `myPermissions` answers for. Everything else is server-wide. */
export const CHANNEL_PERMISSIONS: readonly string[] = [
  "read_messages",
  "send_messages",
  "edit_own_messages",
  "delete_own_messages",
  "attach_files",
  "add_reactions",
  "report_messages",
  "use_link_previews",
  "mention_everyone",
  "manage_messages",
  "join_voice",
  "speak",
  "share_video",
  "share_screen",
];

/** One channel's answer where the server sent it (GRYT-1416). An older server
    sent only `canSend` and `canJoin`, and those narrow the server-wide `can`. */
export function canInChannel(
  channel: Pick<Channel, "myPermissions" | "canSend" | "canJoin"> | undefined,
  can: (permission: string) => boolean,
  permission: string,
): boolean {
  if (Array.isArray(channel?.myPermissions) && CHANNEL_PERMISSIONS.includes(permission)) {
    return channel.myPermissions.includes(permission);
  }
  if (!can(permission)) return false;
  if (permission === "send_messages") return channel?.canSend !== false;
  if (permission === "join_voice") return channel?.canJoin !== false;
  return true;
}

export type PermissionMeta = {
  id: string;
  label: string;
  description: string;
};

export type PermissionGroup = {
  title: string;
  description: string;
  permissions: PermissionMeta[];
};

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    get title() { return socketI18n.t("socketFull.permissions_6ebbd6b9a0"); },
    get description() { return socketI18n.t("socketFull.permissions_f4ebed9e2a"); },
    permissions: [
      { id: "read_messages", get label() { return socketI18n.t("socketFull.permissions_9bb8b2753d"); }, get description() { return socketI18n.t("socketFull.permissions_aea381e0a1"); } },
      { id: "send_messages", get label() { return socketI18n.t("socketFull.permissions_a23889d91a"); }, get description() { return socketI18n.t("socketFull.permissions_e07a51f765"); } },
      { id: "edit_own_messages", get label() { return socketI18n.t("socketFull.permissions_1c74fa0189"); }, get description() { return socketI18n.t("socketFull.permissions_6e6b705caa"); } },
      { id: "delete_own_messages", get label() { return socketI18n.t("socketFull.permissions_e19c1cd73c"); }, get description() { return socketI18n.t("socketFull.permissions_1973b27592"); } },
      { id: "attach_files", get label() { return socketI18n.t("socketFull.permissions_a9e5c2f46d"); }, get description() { return socketI18n.t("socketFull.permissions_5db2c5795a"); } },
      { id: "add_reactions", get label() { return socketI18n.t("socketFull.permissions_994d23f51f"); }, get description() { return socketI18n.t("socketFull.permissions_58d14287fc"); } },
      { id: "send_direct_messages", get label() { return socketI18n.t("socketFull.permissions_5fd73b6faf"); }, get description() { return socketI18n.t("socketFull.permissions_fe8546a293"); } },
      { id: "create_groups", get label() { return socketI18n.t("socketFull.permissions_2c3f4c9528"); }, get description() { return socketI18n.t("socketFull.permissions_e7d80883a6"); } },
      { id: "report_messages", get label() { return socketI18n.t("socketFull.permissions_5572996f32"); }, get description() { return socketI18n.t("socketFull.permissions_93d4ab541e"); } },
      { id: "use_link_previews", get label() { return socketI18n.t("socketFull.permissions_1975b22445"); }, get description() { return socketI18n.t("socketFull.permissions_fd0d2cb53d"); } },
      { id: "mention_everyone", get label() { return socketI18n.t("socketFull.permissions_278ab50bd1"); }, get description() { return socketI18n.t("socketFull.permissions_95b66d742c"); } },
    ],
  },
  {
    get title() { return socketI18n.t("ui.voice"); },
    get description() { return socketI18n.t("socketFull.permissions_68d421368d"); },
    permissions: [
      { id: "join_voice", get label() { return socketI18n.t("socketFull.permissions_c6dd5463ef"); }, get description() { return socketI18n.t("socketFull.permissions_208bcaf5c3"); } },
      { id: "speak", get label() { return socketI18n.t("socketFull.permissions_628fa2575a"); }, get description() { return socketI18n.t("socketFull.permissions_43b663faaa"); } },
      { id: "share_video", get label() { return socketI18n.t("socketFull.permissions_d643aeb91b"); }, get description() { return socketI18n.t("socketFull.permissions_9733b51993"); } },
      { id: "share_screen", get label() { return socketI18n.t("socketFull.permissions_f597ec809b"); }, get description() { return socketI18n.t("socketFull.permissions_626b75a2ec"); } },
      { id: "start_calls", get label() { return socketI18n.t("socketFull.permissions_b3ccb81d55"); }, get description() { return socketI18n.t("socketFull.permissions_0b2f75e188"); } },
    ],
  },
  {
    get title() { return socketI18n.t("socketFull.permissions_daec66d449"); },
    get description() { return socketI18n.t("socketFull.permissions_ab656e393b"); },
    permissions: [
      { id: "change_nickname", get label() { return socketI18n.t("socketFull.permissions_b218a02bc4"); }, get description() { return socketI18n.t("socketFull.permissions_a1c3b7d10d"); } },
      { id: "set_activity", get label() { return socketI18n.t("socketFull.permissions_ddbcafd996"); }, get description() { return socketI18n.t("socketFull.permissions_32d4ebe836"); } },
      { id: "change_avatar", get label() { return socketI18n.t("ui.changeAvatar"); }, get description() { return socketI18n.t("socketFull.permissions_73ec2a00ad"); } },
      /* Split off `change_avatar` on the server in GRYT-866 and never labelled
         here, so it landed in "Newer than this client" on a current build. */
      { id: "upload_avatar_image", get label() { return socketI18n.t("socketFull.permissions_98eca7a5c4"); }, get description() { return socketI18n.t("socketFull.permissions_30c6cdb3b8"); } },
      { id: "upload_banner_image", get label() { return socketI18n.t("socketFull.permissions_36c3c519a7"); }, get description() { return socketI18n.t("socketFull.permissions_ae03e5e03a"); } },
      { id: "view_members", get label() { return socketI18n.t("socketFull.permissions_7c57055580"); }, get description() { return socketI18n.t("socketFull.permissions_509abc6e1d"); } },
      { id: "create_invite", get label() { return socketI18n.t("socketFull.permissions_69601868b9"); }, get description() { return socketI18n.t("socketFull.permissions_58bb8327bd"); } },
    ],
  },
  {
    get title() { return socketI18n.t("socketFull.permissions_d8c32436c7"); },
    get description() { return socketI18n.t("socketFull.permissions_a688ef0322"); },
    permissions: [
      { id: "manage_messages", get label() { return socketI18n.t("socketFull.permissions_601a04e14b"); }, get description() { return socketI18n.t("socketFull.permissions_dd6512775d"); } },
      { id: "kick_members", get label() { return socketI18n.t("socketFull.permissions_07305bcc78"); }, get description() { return socketI18n.t("socketFull.permissions_c51acdd3bc"); } },
      { id: "ban_members", get label() { return socketI18n.t("socketFull.permissions_6c3b4af41b"); }, get description() { return socketI18n.t("socketFull.permissions_aececbe27f"); } },
      { id: "view_bans", get label() { return socketI18n.t("socketFull.permissions_8c2e7c84a0"); }, get description() { return socketI18n.t("socketFull.permissions_130a431790"); } },
      { id: "mute_members", get label() { return socketI18n.t("socketFull.permissions_2ab5cd3945"); }, get description() { return socketI18n.t("socketFull.permissions_e0d0443dad"); } },
      { id: "deafen_members", get label() { return socketI18n.t("socketFull.permissions_06254e5516"); }, get description() { return socketI18n.t("socketFull.permissions_2892e596c5"); } },
      { id: "disconnect_members", get label() { return socketI18n.t("socketFull.permissions_96ee562d31"); }, get description() { return socketI18n.t("socketFull.permissions_3af900fe6b"); } },
      { id: "view_reports", get label() { return socketI18n.t("socketFull.permissions_4c366a5f2e"); }, get description() { return socketI18n.t("socketFull.permissions_1e3c1325e3"); } },
      { id: "manage_reports", get label() { return socketI18n.t("socketFull.permissions_f7f8820379"); }, get description() { return socketI18n.t("socketFull.permissions_e23db23c0d"); } },
      { id: "manage_join_requests", get label() { return socketI18n.t("socketFull.permissions_8e2fab733c"); }, get description() { return socketI18n.t("socketFull.permissions_0774dab8da"); } },
      { id: "manage_invites", get label() { return socketI18n.t("socketFull.permissions_2d4d3c5841"); }, get description() { return socketI18n.t("socketFull.permissions_8b7850a495"); } },
    ],
  },
  {
    get title() { return socketI18n.t("socketFull.permissions_5e2aecbbbc"); },
    get description() { return socketI18n.t("socketFull.permissions_d6e06ea83c"); },
    permissions: [
      { id: "manage_channels", get label() { return socketI18n.t("socketFull.permissions_9196ff6ede"); }, get description() { return socketI18n.t("socketFull.permissions_fef37cf5d0"); } },
      { id: "manage_sidebar", get label() { return socketI18n.t("socketFull.permissions_ead365155b"); }, get description() { return socketI18n.t("socketFull.permissions_d67f9efb7f"); } },
      { id: "manage_emojis", get label() { return socketI18n.t("socketFull.permissions_3695b2b01f"); }, get description() { return socketI18n.t("socketFull.permissions_519258ecf5"); } },
      { id: "manage_webhooks", get label() { return socketI18n.t("socketFull.permissions_ed4c781fc4"); }, get description() { return socketI18n.t("socketFull.permissions_96753e371f"); } },
      { id: "view_audit_log", get label() { return socketI18n.t("socketFull.permissions_2b40d5351d"); }, get description() { return socketI18n.t("socketFull.permissions_51c4489146"); } },
      { id: "view_server_status", get label() { return socketI18n.t("socketFull.permissions_b69cf4256d"); }, get description() { return socketI18n.t("socketFull.permissions_82b7d55a1e"); } },
      { id: "manage_roles", get label() { return socketI18n.t("socketFull.permissions_90abf95fe4"); }, get description() { return socketI18n.t("socketFull.permissions_133a18b0f2"); } },
      { id: "manage_bots", get label() { return socketI18n.t("socketFull.permissions_c55a0ed768"); }, get description() { return socketI18n.t("socketFull.permissions_eba758e351"); } },
      { id: "manage_server", get label() { return socketI18n.t("ui.manageServer"); }, get description() { return socketI18n.t("socketFull.permissions_e8be559d4b"); } },
      { id: "replace_identity", get label() { return socketI18n.t("socketFull.permissions_6c42566866"); }, get description() { return socketI18n.t("socketFull.permissions_567e2dafc4"); } },
    ],
  },
];

const DESCRIBED = new Map(
  PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => [p.id, p] as const)),
);

export function describePermission(id: string): PermissionMeta {
  return DESCRIBED.get(id) ?? { id, label: id, description: "" };
}

/**
 * The catalogue the server sent, arranged for display. Anything this client does
 * not know ends up in a trailing group rather than being dropped.
 */
export function groupPermissions(available: string[]): PermissionGroup[] {
  const known = new Set(available);
  const groups = PERMISSION_GROUPS.map((g) => ({
    ...g,
    permissions: g.permissions.filter((p) => known.has(p.id)),
  })).filter((g) => g.permissions.length > 0);

  const described = new Set(PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.id)));
  const unknown = available.filter((id) => !described.has(id));
  if (unknown.length > 0) {
    groups.push({
      title: socketI18n.t("socketFull.permissions_3ab9e80303"),
      description: socketI18n.t("socketFull.permissions_357b8a6787"),
      permissions: unknown.map((id) => ({ id, label: id, description: "" })),
    });
  }

  return groups;
}

/** Every role this member holds. An older server sends only the top one. */
export function heldRoleIds(info: { role?: string; role_ids?: string[] } | undefined): string[] {
  if (Array.isArray(info?.role_ids)) return info.role_ids;
  return info?.role ? [info.role] : [];
}
