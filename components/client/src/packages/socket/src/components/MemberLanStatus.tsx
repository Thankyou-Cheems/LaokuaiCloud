import { Tooltip } from "@gryt/ui";
import type { MouseEvent } from "react";
import toast from "react-hot-toast";

import { useTranslation } from "@/i18n";

import { ConnectionTopologyIcon, type ConnectionTopologyKind } from "../../../../components/ConnectionTopologyIcon";
import { communityDnsDisplayName } from "../../../../lib/communityDnsNames";
import { type LanCommunitySnapshot, readMemberLanStatus } from "../../../../lib/memberLanStatus";

/** Caller supplies evidence; the address button only copies validated overlay IPs. */
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
  const isSelf = reading.pathReason === "self";
  const path = t(reading.pathReason === "self" ? "memberLan.path.self"
    : reading.pathReason === "stale" ? "memberLan.pathExpired" : `memberLan.path.${reading.path}`);
  const rtt = reading.rttMs === null ? t(reading.rttReason === "stale" ? "memberLan.stale" : "memberLan.unknown") : `${Math.round(reading.rttMs)} ms`;
  const pathTitle = t(reading.pathReason === "self" ? "memberLan.localStateTitle" : "memberLan.pathTitle");
  const details = [t("memberLan.boundary"), `${t("memberLan.enrollmentTitle")}: ${state}`,
    reading.enrollmentReason && t(`memberLan.reason.${reading.enrollmentReason}`),
    `${pathTitle}: ${path}`, !isSelf && reading.pathReason && t(`memberLan.reason.${reading.pathReason}`),
    !isSelf && `${t("memberLan.rttTitle")}: ${rtt}`, !isSelf && reading.rttReason && t(`memberLan.reason.${reading.rttReason}`),
    reading.source && `${t("memberLan.sourceTitle")}: ${t(`memberLan.source.${reading.source}`)}`,
    reading.observedAtMs !== undefined && `${t("memberLan.ageTitle")}: ${Math.floor(((nowMs ?? reading.observedAtMs) - reading.observedAtMs) / 1000)} s`,
    reading.virtualIps?.length && `${t("memberLan.virtualIpTitle")}: ${reading.virtualIps.join(", ")}`,
    reading.dnsAddresses?.length && `${t("memberLan.dnsTitle")}: ${reading.dnsAddresses.map(address => `${communityDnsDisplayName(address.dnsName)} → ${address.virtualIp}`).join(", ")}`,
    reading.enrollment === "assigned" && t("memberLan.addressAssignmentBoundary"),
    (reading.virtualIps?.length ?? 0) > 1 && t("memberLan.multipleDeviceAddresses"),
    t("memberLan.voiceBoundary")].filter(Boolean).join("; ");
  const joined = reading.enrollment === "joined";
  const icon: ConnectionTopologyKind = reading.pathReason === "self" ? "local"
    : reading.enrollment === "joining" ? "connecting"
    : ["off", "not-joined", "error"].includes(reading.enrollment) ? "disconnected"
    : joined && reading.path !== "unknown" ? reading.path : "unknown";
  const label = `${state}${joined ? ` · ${path}${isSelf ? "" : ` · ${rtt}`}` : ""}`;
  const copyVirtualIp = (event: MouseEvent<HTMLButtonElement>, address: string) => {
    event.stopPropagation();
    if (!navigator.clipboard) { toast.error(t("memberLan.copyFailed")); return; }
    void navigator.clipboard.writeText(address).then(() => toast.success(t("memberLan.addressCopied")), () => toast.error(t("memberLan.copyFailed")));
  };
  const copyDnsName = (event: MouseEvent<HTMLButtonElement>, name: string) => {
    event.stopPropagation();
    if (!navigator.clipboard) { toast.error(t("memberLan.copyFailed")); return; }
    void navigator.clipboard.writeText(communityDnsDisplayName(name)).then(() => toast.success(t("memberLan.dnsCopied")), () => toast.error(t("memberLan.copyFailed")));
  };
  return <Tooltip title={details}><span role="group" tabIndex={0} aria-label={details} title={details}
    data-gryt="member-lan-status" data-enrollment={reading.enrollment} data-lan-path={reading.path}
    onKeyDown={event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
    className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-1 text-[10px] leading-tight cursor-help focus-visible:outline focus-visible:outline-2 focus-visible:outline-gryt-accent"
    style={{ color: joined ? "var(--gryt-success-11)" : reading.enrollment === "error" ? "var(--gryt-warning-11)" : "var(--gryt-muted)" }}>
    <ConnectionTopologyIcon kind={icon} />
    <span aria-hidden="true" className="min-w-0 truncate">{label}</span>
    {reading.virtualIps?.map(address => <button key={address} type="button" data-gryt="member-lan-address" data-virtual-ip={address}
      aria-label={`${t("memberLan.copyVirtualIp")}: ${address}`} title={`${t("memberLan.copyVirtualIp")}: ${address}`}
      onClick={event => copyVirtualIp(event, address)} onPointerDown={event => event.stopPropagation()}
      className="shrink-0 truncate text-[10px] underline decoration-dotted underline-offset-2 hover:text-gryt-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-gryt-accent">
      {address}
    </button>)}
    {reading.dnsAddresses?.map(address => <button key={address.dnsName} type="button" data-gryt="member-lan-dns" data-virtual-ip={address.virtualIp}
      aria-label={`${t("memberLan.copyDnsName")}: ${communityDnsDisplayName(address.dnsName)} → ${address.virtualIp}`} title={`${t("memberLan.copyDnsName")}: ${communityDnsDisplayName(address.dnsName)} → ${address.virtualIp}`}
      onClick={event => copyDnsName(event, address.dnsName)} onPointerDown={event => event.stopPropagation()}
      className="min-w-0 max-w-full break-all text-left text-[10px] underline decoration-dotted underline-offset-2 hover:text-gryt-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-gryt-accent">
      {communityDnsDisplayName(address.dnsName)}{(reading.dnsAddresses?.length ?? 0) > 1 ? ` → ${address.virtualIp}` : ""}
    </button>)}
  </span></Tooltip>;
}
