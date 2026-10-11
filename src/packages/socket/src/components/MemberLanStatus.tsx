import { Tooltip } from "@gryt/ui";

import { useTranslation } from "@/i18n";

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
  const label = `${state}${joined ? ` · ${path} · ${rtt}` : ""}`;
  return <Tooltip title={details}><span role="img" tabIndex={0} aria-label={details} title={details}
    data-gryt="member-lan-status" data-enrollment={reading.enrollment} data-lan-path={reading.path}
    onKeyDown={event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
    className="flex w-full min-w-0 max-w-full items-center gap-1 text-[10px] leading-tight cursor-help focus-visible:outline focus-visible:outline-2 focus-visible:outline-gryt-accent"
    style={{ color: joined ? "var(--gryt-success-11)" : reading.enrollment === "error" ? "var(--gryt-warning-11)" : "var(--gryt-muted)" }}>
    <svg aria-hidden="true" focusable="false" width="11" height="11" viewBox="0 0 12 12" className="shrink-0" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="6" cy="2" r="1.2" /><circle cx="2" cy="10" r="1.2" /><circle cx="10" cy="10" r="1.2" /><path d="M6 3.2v3M2 8.8V6.2h8v2.6" />
    </svg>
    <span aria-hidden="true" className="min-w-0 truncate">{label}</span>
  </span></Tooltip>;
}
