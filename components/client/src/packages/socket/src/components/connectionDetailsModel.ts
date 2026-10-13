import type { VoicePathDirection } from "../../../../lib/memberVoiceMediaPath";

/** Presentation-only extension. The unified provider owns authentication,
 * publication/track/generation correlation and TTL. Never pass raw SDK stats here.
 * Existing provider directions are compatible; absent extension fields stay null. */
export interface ConnectionDetailsDirection extends VoicePathDirection {
  /** Exact normalized provider output; false is lack of fresh decode proof,
   * not proof that the selected transport failed. */
  mediaAvailable?: boolean;
  transition?: "stable" | "confirmed-switching" | "confirmed-failed" | "unknown";
  /** Independent age of the selected-transport measurement, not path observation age. */
  metricsAgeMs?: number | null;
  lossWindowMs?: number | null;
}
export interface ConnectionDetailsPath { receive: ConnectionDetailsDirection; send: ConnectionDetailsDirection }
export interface ConnectionDetailsRow { label: string; value: string; numeric?: boolean }
type Translate = (key: string, values?: Record<string, string | number>) => string;
const nonnegative = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const allowed = (value: string | undefined, list: readonly string[], fallback: string) => value && list.includes(value) ? value : fallback;

/** Resolve only the exact current-room microphone publication from the existing
 * authenticated roster. Presence, screen publications and ambiguous aliases fail closed. */
export function connectionDetailsPublication(input: {
  host?: string; member?: string; currentHost?: string | null; currentRoom?: string | null; connected: boolean;
  roster: Record<string, { serverUserId?: string; hasJoinedChannel?: boolean; voiceChannelId?: string; isConnectedToVoice?: boolean;
    streamID?: string; cameraStreamID?: string; screenShareVideoStreamID?: string; screenShareAudioStreamID?: string }>;
}): string | undefined {
  if (!input.connected || !input.host || !input.member || input.host !== input.currentHost || !input.currentRoom) return;
  const entries = Object.values(input.roster);
  const matches = entries.filter(c => c.serverUserId === input.member && c.hasJoinedChannel && c.voiceChannelId === input.currentRoom && c.isConnectedToVoice === true && !!c.streamID?.trim());
  if (matches.length !== 1) return;
  const publication = matches[0].streamID!;
  if (entries.filter(c => c.streamID === publication).length !== 1 || entries.some(c => [c.cameraStreamID, c.screenShareVideoStreamID, c.screenShareAudioStreamID].includes(publication))) return;
  return publication;
}

/** Whitelisted display values only. No inferred rates, cumulative counters or generated history. */
export function connectionDetailsDirectionRows(d: ConnectionDetailsDirection, t: Translate, direction?: "receive" | "send"): ConnectionDetailsRow[] {
  if (direction === "send" && d.reason === "missing" && d.selected === "unknown") {
    return [{ label: t("connectionDetails.sendEvidence"), value: t("connectionDetails.sendNotReported") }];
  }
  const measured = d.metricsReason === "measured";
  const availability = d.mediaAvailable === true ? "usable" : d.label === "error" && d.transition === "confirmed-failed" ? "unavailable" : "unknown";
  const transition = allowed(d.transition, ["stable", "confirmed-switching", "confirmed-failed", "unknown"],
    d.label === "switching" ? "confirmed-switching" : d.label === "error" ? "confirmed-failed" : "unknown");
  const scope = allowed(d.metricsScope, ["peer-transport", "sfu-transport"], "unknown");
  const rtt = measured && scope !== "unknown" && nonnegative(d.rttMs) && d.rttMs <= 60000 ? `${Math.round(d.rttMs)} ms` : t("connectionDetails.notMeasured");
  const loss = measured && nonnegative(d.lossPercent) && d.lossPercent <= 100 ? `${d.lossPercent.toFixed(1)}%` : t("connectionDetails.notMeasured");
  const age = (ms: unknown) => nonnegative(ms) ? t("memberVoicePath.age", { seconds: (ms / 1000).toFixed(1) }) : t("connectionDetails.notMeasured");
  const label = allowed(d.label, ["direct", "member-relay", "server-relay", "easytier-direct", "easytier-relay", "webrtc-non-turn", "turn-relay", "unknown", "path-pending", "switching", "error", "pending"], "path-pending");
  const selected = allowed(d.selected, ["peer", "sfu", "none", "unknown"], "unknown");
  const rows: ConnectionDetailsRow[] = [
    { label: t("connectionDetails.logicalSelection"), value: t(`memberVoicePath.selected.${selected}`) },
    { label: t("connectionDetails.availabilityTitle"), value: t(`connectionDetails.availability.${availability}`) },
    { label: t("connectionDetails.transitionTitle"), value: t(`connectionDetails.transition.${transition}`) },
    { label: t("connectionDetails.physicalPath"), value: t(`memberVoicePath.labels.${label}`) },
    { label: t(scope === "peer-transport" ? "memberVoicePath.peerRtt" : scope === "sfu-transport" ? "memberVoicePath.sfuRtt" : "memberVoicePath.rtt"), value: rtt, numeric: true },
    { label: t("memberVoicePath.loss"), value: loss, numeric: true },
    { label: t("connectionDetails.lossWindow"), value: measured && nonnegative(d.lossWindowMs) && d.lossWindowMs >= 500 && d.lossWindowMs <= 10000 ? `${(d.lossWindowMs / 1000).toFixed(1)} s` : t("connectionDetails.notReported"), numeric: true },
    { label: t("connectionDetails.pathAge"), value: age(d.ageMs), numeric: true },
    { label: t("connectionDetails.metricsAge"), value: measured ? age(d.metricsAgeMs) : t("connectionDetails.notMeasured"), numeric: true },
  ];
  if (d.routeStatus) rows.splice(3, 0, { label: t("connectionDetails.routeStatus"), value: t(`memberVoicePath.routeStates.${allowed(d.routeStatus, ["sfu", "queued", "probing", "switching", "p2p", "recovering", "failed", "unknown"], "unknown")}`) });
  if (d.transportPath) rows.splice(4, 0, { label: t("connectionDetails.transportPath"), value: t(`memberVoicePath.labels.${allowed(d.transportPath, ["easytier-direct", "easytier-relay", "webrtc-non-turn", "turn-relay", "unknown"], "unknown")}`) });
  if (d.reason && ["not-integrated", "scope-mismatch", "missing", "expired", "invalid", "inconsistent", "media-unavailable", "underlay-unproven"].includes(d.reason)) rows.push({ label: t("connectionDetails.reason"), value: t(`memberVoicePath.reasons.${d.reason}`) });
  rows.push({ label: t("connectionDetails.metricsStatus"), value: t(`memberVoicePath.metrics.${allowed(d.metricsReason, ["missing", "expired", "invalid", "measured"], "missing")}`) });
  return rows;
}
