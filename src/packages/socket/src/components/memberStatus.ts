import { i18n as socketI18n } from "@/i18n";

import type { UserStatus } from "../types/clients";

/**
 * How a member's presence is named and coloured, in one place. Importing it back
 * out of MemberSidebar would have made a cycle.
 */
export const statusConfig: Record<UserStatus, { label: string; color: string }> = {
  in_voice: { get label() { return socketI18n.t("socketFull.memberStatus_b27fb01dae"); }, color: "var(--gryt-accent-9)" },
  online: { get label() { return socketI18n.t("socketFull.memberStatus_b483ba2e80"); }, color: "var(--gryt-success-9)" },
  afk: { get label() { return socketI18n.t("socketFull.memberStatus_47ce15dbdf"); }, color: "var(--gryt-warning-9)" },
  offline: { get label() { return socketI18n.t("socketFull.memberStatus_19def6d329"); }, color: "var(--gryt-neutral-9)" },
};

export const statusPriority: Record<UserStatus, number> = {
  in_voice: 0,
  online: 1,
  afk: 2,
  offline: 3,
};
