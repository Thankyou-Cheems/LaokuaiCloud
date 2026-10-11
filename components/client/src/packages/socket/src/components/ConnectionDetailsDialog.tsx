import { Button, Dialog } from "@gryt/ui";
import { useSFU } from "@gryt/voice";
import { type RefObject, useEffect, useRef, useState } from "react";

import { getOwnServerUserId } from "@/common";
import { useTranslation } from "@/i18n";
import { useMemberVoiceObservationAuthority } from "@/webRTC/src/adapters/MemberVoiceObservationAuthority";
import { useMemberVoiceMediaPath } from "@/webRTC/src/components/MemberVoiceMediaPathAdapter";

import { useEasyTierCommunityState, useEasyTierMemberSnapshot } from "../../../../lib/communityLanState";
import type { EasyTierCommunityState } from "../../../../lib/easyTierCommunity";
import { type MemberLanReading, readMemberLanStatus } from "../../../../lib/memberLanStatus";
import { useServerManagement } from "../hooks/useServerManagement";
import { useSockets } from "../hooks/useSockets";
import { connectionDetailsDirectionRows, type ConnectionDetailsPath, connectionDetailsPublication, type ConnectionDetailsRow } from "./connectionDetailsModel";

export interface ConnectionDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nickname: string;
  isSelf?: boolean;
  /** Already scope-validated output from the single media provider. Missing is honest. */
  path: ConnectionDetailsPath;
  lan: MemberLanReading;
  /** Local community instance state only; never a remote member's enrollment. */
  community?: Pick<EasyTierCommunityState, "phase" | "reason">;
  lanAgeMs?: number | null;
  returnFocus?: RefObject<HTMLElement | null>;
}

/** Read-only view. No SDK sampling, protocol requests, history, profile or network actions. */
export function ConnectionDetailsDialog({ open, onOpenChange, nickname, isSelf, path, lan, community, lanAgeMs, returnFocus }: ConnectionDetailsDialogProps) {
  const { t } = useTranslation();
  const close = useRef<HTMLButtonElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | undefined>(() => document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : undefined);
  useEffect(() => {
    const sync = () => setPortalContainer(document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : undefined);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const table = (rows: ConnectionDetailsRow[]) => <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-x-3 gap-y-2 text-xs">
    {rows.map(row => <div key={row.label} className="contents"><dt className="min-w-0 break-words text-gryt-muted">{row.label}</dt><dd className="m-0 min-w-0 break-words" style={row.numeric ? { fontVariantNumeric: "tabular-nums" } : undefined}>{row.value}</dd></div>)}
  </dl>;
  const lanRows: ConnectionDetailsRow[] = [
    { label: t("connectionDetails.localCommunity"), value: community ? t(`connectionDetails.communityPhase.${community.phase}`) : t("connectionDetails.notReported") },
    { label: t("memberLan.enrollmentTitle"), value: t(`memberLan.enrollment.${lan.enrollment}`) },
    { label: t("memberLan.pathTitle"), value: t(lan.pathReason === "stale" ? "memberLan.pathExpired" : `memberLan.path.${lan.path}`) },
    { label: t("memberLan.rttTitle"), value: lan.rttMs === null ? t("connectionDetails.notMeasured") : `${Math.round(lan.rttMs)} ms`, numeric: true },
    { label: t("memberLan.ageTitle"), value: typeof lanAgeMs === "number" && Number.isFinite(lanAgeMs) && lanAgeMs >= 0 ? t("memberVoicePath.age", { seconds: (lanAgeMs / 1000).toFixed(1) }) : t("connectionDetails.notMeasured"), numeric: true },
  ];
  if (community?.reason) lanRows.push({ label: t("connectionDetails.localCommunityReason"), value: t(`connectionDetails.communityReason.${community.reason}`) });
  if (lan.enrollmentReason) lanRows.push({ label: t("connectionDetails.bindingReason"), value: t(`memberLan.reason.${lan.enrollmentReason}`) });
  if (lan.pathReason) lanRows.push({ label: t("connectionDetails.lanPathReason"), value: t(`memberLan.reason.${lan.pathReason}`) });
  if (lan.rttReason) lanRows.push({ label: t("connectionDetails.lanRttReason"), value: t(`memberLan.reason.${lan.rttReason}`) });
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal container={portalContainer}><Dialog.Backdrop />
      <Dialog.Popup data-gryt="connection-details-dialog" initialFocus={close} finalFocus={returnFocus}
        style={{ top: "48px", transform: "translateX(-50%)", translate: "none", width: "min(540px, calc(100vw - 24px))", maxWidth: "calc(100vw - 24px)", maxHeight: "max(120px, calc(100dvh - 220px))" }}
        className="overflow-y-auto motion-reduce:!transition-none">
        <Dialog.Title>{t("connectionDetails.title", { nickname })}</Dialog.Title>
        <Dialog.Description>{t("connectionDetails.description")}</Dialog.Description>
        {isSelf && <p className="text-xs text-gryt-muted">{t("connectionDetails.selfBoundary")}</p>}
        {(["receive", "send"] as const).map(direction => <section key={direction} data-gryt={`connection-details-${direction}`} className="border-t border-gryt-border pt-3">
          <h3 className="mb-3 text-sm font-semibold">{t(`memberVoicePath.${direction}`)}</h3>
          {table(connectionDetailsDirectionRows(path[direction], t))}
          {direction === "send" && <p className="mt-3 text-xs text-gryt-muted">{t("connectionDetails.sendBoundary")}</p>}
        </section>)}
        <p className="text-xs text-gryt-muted">{t("connectionDetails.metricBoundary")}</p>
        <section data-gryt="connection-details-lan" className="border-t border-gryt-border pt-3"><h3 className="mb-3 text-sm font-semibold">{t("connectionDetails.lanTitle")}</h3>{table(lanRows)}<p className="mt-3 text-xs text-gryt-muted">{t("memberLan.voiceBoundary")}</p></section>
        <Dialog.Footer><Dialog.Close ref={close} render={<Button tone="neutral" size="small">{t("ui.close")}</Button>} /></Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}

/** Mounted only while inspecting a member. Existing shared hooks own all evidence;
 * changing room/account/PC updates the provider, not a retained dialog snapshot. */
export function MemberConnectionDetailsDialog({ serverHost, serverUserId, ...props }: Omit<ConnectionDetailsDialogProps, "path" | "lan" | "community" | "lanAgeMs"> & { serverHost: string; serverUserId: string }) {
  const { clients, serverDetailsList } = useSockets();
  const { servers } = useServerManagement();
  const sfu = useSFU();
  const observations = useMemberVoiceObservationAuthority();
  useEffect(() => props.open ? observations?.requestDetails() : undefined, [props.open, observations]);
  const serverId = servers[serverHost]?.serverId ?? serverDetailsList[serverHost]?.server_info?.server_id;
  const community = useEasyTierCommunityState(serverId);
  const lanSnapshot = useEasyTierMemberSnapshot(serverId);
  const publicationId = props.isSelf ? undefined : connectionDetailsPublication({ host: serverHost, member: serverUserId,
    currentHost: sfu.currentServerConnected, currentRoom: sfu.currentChannelConnected, connected: sfu.isConnected,
    roster: clients[serverHost] ?? {} });
  const path = useMemberVoiceMediaPath(serverHost, serverUserId, publicationId);
  const lan = readMemberLanStatus({ serverScope: serverId ?? "", authenticatedUserId: serverUserId,
    observerAuthenticatedUserId: getOwnServerUserId(serverHost), snapshot: lanSnapshot.snapshot, nowMs: lanSnapshot.nowMs });
  return <ConnectionDetailsDialog {...props} path={path} lan={lan} community={community}
    lanAgeMs={lan.observedAtMs === undefined ? null : lanSnapshot.nowMs - lan.observedAtMs} />;
}
