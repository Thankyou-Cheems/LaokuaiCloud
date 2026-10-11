import { Tooltip } from "@gryt/ui";

import { useTranslation } from "@/i18n";

import { ConnectionTopologyIcon, type ConnectionTopologyKind } from "../../../../components/ConnectionTopologyIcon";
import { type LanCommunitySnapshot, readMemberLanStatus } from "../../../../lib/memberLanStatus";

/** No SDK, sockets, clock, profile or network side effects. The caller supplies evidence. */
export function MemberLanStatus({ serverScope, authenticatedUserId, observerAuthenticatedUserId, snapshot, nowMs }: {
  serverScope: string;
  authenticatedUserId: string;
  observerAuthenticatedUserId?: string;
  snapshot?: LanCommunitySnapshot;
  nowMs?: number;
}) {
  const { t } = useTranslation();
  const reading = readMemberLanStatus({ serverScope, authenticatedUserId, observerAuthenticatedUserId, snapshot, nowMs });
  const state = t(`memberLan.enrollment.${reading.enrollment}`);
  const path = t(reading.pathReason === "stale" ? "memberLan.pathExpired" : `memberLan.path.${reading.path}`);
  const rtt = reading.rttMs === null ? t(reading.rttReason === "stale" ? "memberLan.stale" : "memberLan.unknown") : `${Math.round(reading.rttMs)} ms`;
  const details = [t("memberLan.boundary"), `${t("memberLan.enrollmentTitle")}: ${state}`,
    reading.enrollmentReason && t(`memberLan.reason.${reading.enrollmentReason}`),
    `${t("memberLan.pathTitle")}: ${path}`, reading.pathReason && t(`memberLan.reason.${reading.pathReason}`),
    `${t("memberLan.rttTitle")}: ${rtt}`, reading.rttReason && t(`memberLan.reason.${reading.rttReason}`),
    reading.source && `${t("memberLan.sourceTitle")}: ${t(`memberLan.source.${reading.source}`)}`,
    reading.observedAtMs !== undefined && `${t("memberLan.ageTitle")}: ${Math.floor(((nowMs ?? reading.observedAtMs) - reading.observedAtMs) / 1000)} s`,
    t("memberLan.voiceBoundary")].filter(Boolean).join("; ");
  const joined = reading.enrollment === "joined";
  const icon: ConnectionTopologyKind = reading.enrollment === "joining" ? "connecting"
    : ["off", "not-joined", "error"].includes(reading.enrollment) ? "disconnected"
    : joined && reading.path !== "unknown" ? reading.path : "unknown";
  const label = `${state}${joined ? ` · ${path} · ${rtt}` : ""}`;
  return <Tooltip title={details}><span role="img" tabIndex={0} aria-label={details} title={details}
    data-gryt="member-lan-status" data-enrollment={reading.enrollment} data-lan-path={reading.path}
    onKeyDown={event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
    className="flex w-full min-w-0 max-w-full items-center gap-1 text-[10px] leading-tight cursor-help focus-visible:outline focus-visible:outline-2 focus-visible:outline-gryt-accent"
    style={{ color: joined ? "var(--gryt-success-11)" : reading.enrollment === "error" ? "var(--gryt-warning-11)" : "var(--gryt-muted)" }}>
    <ConnectionTopologyIcon kind={icon} />
    <span aria-hidden="true" className="min-w-0 truncate">{label}</span>
  </span></Tooltip>;
}
