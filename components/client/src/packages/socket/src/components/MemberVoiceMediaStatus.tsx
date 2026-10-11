import { Tooltip } from "@gryt/ui";

import { useTranslation } from "@/i18n";
import { useMemberVoiceMediaPath } from "@/webRTC/src/components/MemberVoiceMediaPathAdapter";

import { ConnectionTopologyIcon, type ConnectionTopologyKind } from "../../../../components/ConnectionTopologyIcon";
import type { MemberVoiceMediaPath, VoicePathDirection } from "../../../../lib/memberVoiceMediaPath";

export function MemberVoiceMediaStatusView({ path, compact = false }: { path: MemberVoiceMediaPath; compact?: boolean }) {
  const { t } = useTranslation();
  const label = (d: VoicePathDirection & { mediaAvailable?: boolean }) =>
    d.selected === "peer" && d.mediaAvailable === true && d.label === "path-pending" ? t("memberVoicePath.p2pUnderlayPending") : t(`memberVoicePath.labels.${d.label}`);
  const details = (d: VoicePathDirection, direction: "receive" | "send") => [
    `${t(`memberVoicePath.${direction}`)}：${label(d)}`,
    t(`memberVoicePath.selected.${d.selected}`),
    d.reason ? t(`memberVoicePath.reasons.${d.reason}`) : "",
    d.nextHop ? t(`memberVoicePath.nextHop.${d.nextHop}`) : "",
    `${t(d.metricsScope === "peer-transport" ? "memberVoicePath.peerRtt" : d.metricsScope === "sfu-transport" ? "memberVoicePath.sfuRtt" : "memberVoicePath.rtt")}：${d.rttMs === null ? t("memberVoicePath.unknown") : `${Math.round(d.rttMs)} ms`}`,
    `${t("memberVoicePath.loss")}：${d.lossPercent === null ? t("memberVoicePath.unknown") : `${d.lossPercent.toFixed(1)}%`}`,
    t(`memberVoicePath.metrics.${d.metricsReason}`),
    d.ageMs === null ? "" : t("memberVoicePath.age", { seconds: (d.ageMs / 1000).toFixed(1) }),
  ].filter(Boolean).join(" · ");
  const receiveText = label(path.receive), sendText = label(path.send);
  const text = receiveText === sendText ? receiveText :
    `${t("memberVoicePath.receiveShort")}：${receiveText} · ${t("memberVoicePath.sendShort")}：${sendText}`;
  const full = `${t("memberVoicePath.title")}。${details(path.receive, "receive")}。${details(path.send, "send")}。${t("memberVoicePath.boundary")}`;
  const icon: ConnectionTopologyKind = path.receive.label !== path.send.label ? "unknown"
    : path.receive.label === "switching" || path.receive.label === "pending" ? "connecting"
    : path.receive.label === "error" ? "disconnected"
    : path.receive.label === "path-pending" ? "unknown" : path.receive.label;
  const color = [path.receive.label, path.send.label].includes("error") ? "var(--gryt-warning-11)" :
    [path.receive.label, path.send.label].every(value => ["direct", "member-relay", "server-relay"].includes(value)) ? "var(--gryt-success-11)" : "var(--gryt-neutral-11)";
  return (
    <Tooltip title={full}>
      <span className={`${compact ? "inline-flex shrink-0 items-center" : "flex min-w-0 items-start gap-1"} text-[10px] leading-tight cursor-help focus-visible:outline focus-visible:outline-2 focus-visible:outline-gryt-accent`} style={{ color }}
        data-gryt="member-voice-media-path" tabIndex={0} role="img" aria-label={full} title={full}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}>
        <ConnectionTopologyIcon kind={icon} />
        <span aria-hidden="true" className={compact ? "sr-only" : "min-w-0 break-words"}>{text}</span>
      </span>
    </Tooltip>
  );
}
export function MemberVoiceMediaStatus({ host, member, publicationId, compact }: { host?: string; member?: string; publicationId?: string; compact?: boolean }) {
  return <MemberVoiceMediaStatusView compact={compact} path={useMemberVoiceMediaPath(host, member, publicationId)} />;
}
