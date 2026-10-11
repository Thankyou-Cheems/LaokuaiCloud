import type { VoiceLocalNetworkReading } from "./memberVoiceLocalNetwork";

/** Passive UI contract. Populate only from authenticated roster + selected usable SDK media.
 * This does not consume candidates, PC existence, LAN adjacency, or listening impressions.
 * The adapter owns invalidation and its clock; it must not copy scope from untrusted telemetry.
 * All timestamps use the same local clock as nowMs. Remote receipts need authenticated
 * recency/sequence validation; never substitute an unvalidated remote clock or refresh old facts.
 */
export const VOICE_MEDIA_EVIDENCE_TTL_MS = 5_000;
export interface MemberVoiceMediaScope {
  /** Absent only for the original authenticated-room contract. Connection authority
   * is sufficient for local SFU receive evidence, never a remote send receipt. */
  authority?: "authenticated-connection" | "authenticated-room";
  accountId?: string;
  serverScope: string; serverInstanceId?: string; roomId: string; roomGeneration: number;
  /** Exact opaque SDK token, when supplied by authenticated room authority. */
  roomGenerationToken?: string;
  localServerUserId: string; localSessionId: string; localPublicationId: string | null;
  remoteServerUserId: string; remoteSessionId: string; remotePublicationId: string;
  connectionGeneration: number;
}
export interface SelectedVoiceMediaEvidence {
  source: "sdk-selected-receive-media" | "authenticated-selected-send-media";
  observedAtMs: number;
  selected: "peer" | "sfu" | "none";
  availability: "usable" | "unavailable" | "unknown";
  transition: "stable" | "confirmed-switching" | "confirmed-failed" | "unknown";
  mediaRouteId: string; routeGeneration: number; selectionRevision: number;
  selectedTrackId: string | null;
  diagnostic?: { status: string; reason: string | null; hybridRouteGeneration: number | null; hybridSelectionRevision: number };
  /** Fresh positive decoded-media progress, correlated with this exact selected track.
   * Sending requires an authenticated remote receipt, not local outbound bytes/ICE success. */
  mediaProof?: {
    source: "sdk-decoded-receive-media" | "authenticated-remote-decoded-media";
    observedAtMs: number; windowStartedAtMs: number; decodedFramesDelta: number;
    mediaRouteId: string; routeGeneration: number; selectionRevision: number; selectedTrackId: string;
  };
  /** Actual selected ICE pair, never a candidate or a PC identifier. */
  selectedIcePairId?: string;
  underlay?: {
    source: "authenticated-selected-media-underlay"; observedAtMs: number;
    kind: "direct" | "member-relay" | "server-relay" | "unknown";
    mediaRouteId: string; routeGeneration: number; selectionRevision: number; selectedIcePairId: string;
    association: "verified" | "unverified" | "ambiguous";
    fromServerUserId: string; toServerUserId: string;
    /** All hops proven for this selected pair and current destination forwarding route.
     * ET list_routes.next_hop_peer_id alone MUST remain first-hop-only, even for a member.
     * ET cost is hop count, never bandwidth or load. */
    coverage: "complete-path" | "first-hop-only" | "unknown";
    nextHop?: "member" | "server" | "unknown";
  };
  metrics?: {
    source: "selected-media-stats"; observedAtMs: number;
    mediaRouteId: string; routeGeneration: number; selectionRevision: number;
    scope: "peer-transport" | "sfu-transport";
    rttMs?: number | null;
    loss?: { packetsLost: number; packetsReceived: number; windowMs: number };
  };
}
export interface MemberVoiceMediaEvidence {
  schemaVersion: 1; source: "authenticated-sdk-media-selection";
  scope: MemberVoiceMediaScope; observedAtMs: number;
  receive?: SelectedVoiceMediaEvidence; send?: SelectedVoiceMediaEvidence;
}
export interface MemberVoiceMediaPathEntry {
  /** Independent current authenticated roster scope; never copied from evidence. */
  scope: MemberVoiceMediaScope;
  evidence?: MemberVoiceMediaEvidence;
}
export interface MemberVoiceMediaPathSnapshot {
  nowMs: number;
  entries: readonly MemberVoiceMediaPathEntry[];
  /** Independently scoped local ET facts; never used as member/media proof. */
  localNetwork?: VoiceLocalNetworkReading;
}
export type VoicePathLabel = "direct" | "member-relay" | "server-relay" | "path-pending" | "switching" | "error" | "pending";
export type VoicePathReason = "not-integrated" | "scope-mismatch" | "missing" | "expired" | "invalid" | "inconsistent" | "media-unavailable" | "underlay-unproven";
export interface VoicePathDirection {
  label: VoicePathLabel; reason?: VoicePathReason;
  selected: "peer" | "sfu" | "none" | "unknown";
  ageMs: number | null; nextHop?: "member" | "server";
  rttMs: number | null; lossPercent: number | null;
  metricsScope?: "peer-transport" | "sfu-transport";
  metricsReason: "missing" | "expired" | "invalid" | "measured";
  metricsAgeMs?: number | null;
  lossWindowMs?: number | null;
  /** Logical SDK selection and fresh decoded availability are independent of underlay. */
  mediaAvailable?: boolean;
  transition?: SelectedVoiceMediaEvidence["transition"];
}
export interface MemberVoiceMediaPath { receive: VoicePathDirection; send: VoicePathDirection }
const pending = (reason: VoicePathReason): VoicePathDirection => ({ label: "path-pending", reason, selected: "unknown", ageMs: null, rttMs: null, lossPercent: null, metricsReason: "missing" });
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const generation = (value: number) => Number.isSafeInteger(value) && value > 0;
const fresh = (at: number, now: number) => Number.isFinite(at) && at >= 0 && at <= now && now - at <= VOICE_MEDIA_EVIDENCE_TTL_MS;
const sameRoute = (a: {mediaRouteId: string; routeGeneration: number; selectionRevision: number}, b: SelectedVoiceMediaEvidence) => a.mediaRouteId === b.mediaRouteId && a.routeGeneration === b.routeGeneration && a.selectionRevision === b.selectionRevision;
const validScope = (scope: MemberVoiceMediaScope) => scope &&
  scope.localServerUserId !== scope.remoteServerUserId && scope.localSessionId !== scope.remoteSessionId &&
  ["serverScope", "roomId", "localServerUserId", "localSessionId", "remoteServerUserId", "remoteSessionId", "remotePublicationId"].every(key => text(scope[key as keyof MemberVoiceMediaScope])) &&
  generation(scope.roomGeneration) && generation(scope.connectionGeneration) &&
  (scope.localPublicationId === null || text(scope.localPublicationId)) &&
  (scope.authority === "authenticated-connection" ? text(scope.accountId) && (scope.serverInstanceId === undefined || text(scope.serverInstanceId)) :
    text(scope.serverInstanceId) && (scope.authority === undefined ? text(scope.localPublicationId) :
      scope.authority === "authenticated-room" && text(scope.accountId) && text(scope.roomGenerationToken)));

function direction(e: SelectedVoiceMediaEvidence | undefined, kind: "receive" | "send", scope: MemberVoiceMediaScope, now: number): VoicePathDirection {
  if (!e) return pending("missing");
  if (kind === "send" && (scope.authority === "authenticated-connection" || !text(scope.localPublicationId))) return pending("missing");
  if (e.source !== (kind === "receive" ? "sdk-selected-receive-media" : "authenticated-selected-send-media") ||
    !["peer", "sfu", "none"].includes(e.selected) || !["usable", "unavailable", "unknown"].includes(e.availability) ||
    !["stable", "confirmed-switching", "confirmed-failed", "unknown"].includes(e.transition) || !text(e.mediaRouteId) ||
    !generation(e.routeGeneration) || !generation(e.selectionRevision)) return pending("invalid");
  if (!fresh(e.observedAtMs, now)) return pending(e.observedAtMs <= now ? "expired" : "invalid");
  // SDK owner must resolve contradictory selected/availability/restore facts. Never infer a fix here.
  if (e.availability === "usable" && (e.selected === "none" || e.transition === "confirmed-failed")) return pending("inconsistent");
  const result: VoicePathDirection = { ...pending("media-unavailable"), selected: e.selected, ageMs: now - e.observedAtMs, mediaAvailable: false, transition: e.transition };
  if (e.selected === "none" && e.availability === "unavailable" && e.transition === "stable") result.label = "pending";
  if (e.transition === "confirmed-switching") {
    const proof = e.mediaProof;
    const available = e.availability === "usable" && e.selected !== "none" && text(e.selectedTrackId) && !!proof &&
      proof.source === (kind === "receive" ? "sdk-decoded-receive-media" : "authenticated-remote-decoded-media") &&
      fresh(proof.observedAtMs, now) && fresh(proof.windowStartedAtMs, now) && proof.windowStartedAtMs < proof.observedAtMs &&
      Number.isSafeInteger(proof.decodedFramesDelta) && proof.decodedFramesDelta > 0 && sameRoute(proof, e) && proof.selectedTrackId === e.selectedTrackId;
    return { ...result, label: "switching", reason: undefined, mediaAvailable: available };
  }
  if (e.transition === "confirmed-failed" && e.availability === "unavailable") return { ...result, label: "error", reason: undefined };
  if (e.transition !== "stable" || e.availability !== "usable" || e.selected === "none") return result;
  if (!text(e.selectedTrackId)) return pending("invalid");
  const proof = e.mediaProof;
  if (!proof || proof.source !== (kind === "receive" ? "sdk-decoded-receive-media" : "authenticated-remote-decoded-media") ||
    !fresh(proof.observedAtMs, now) || !fresh(proof.windowStartedAtMs, now) || proof.windowStartedAtMs >= proof.observedAtMs ||
    !Number.isSafeInteger(proof.decodedFramesDelta) || proof.decodedFramesDelta <= 0 || !sameRoute(proof, e) || proof.selectedTrackId !== e.selectedTrackId) return result;
  result.label = e.selected === "sfu" ? "server-relay" : "path-pending";
  result.mediaAvailable = true;
  result.reason = e.selected === "sfu" ? undefined : "underlay-unproven";
  const u = e.underlay;
  const correlated = u && u.source === "authenticated-selected-media-underlay" && u.association === "verified" &&
    fresh(u.observedAtMs, now) && sameRoute(u, e) && text(e.selectedIcePairId) && u.selectedIcePairId === e.selectedIcePairId &&
    u.fromServerUserId === (kind === "receive" ? scope.remoteServerUserId : scope.localServerUserId) &&
    u.toServerUserId === (kind === "receive" ? scope.localServerUserId : scope.remoteServerUserId);
  if (e.selected === "peer" && correlated) {
    if (u.nextHop === "member" || u.nextHop === "server") result.nextHop = u.nextHop;
    if (u.coverage === "complete-path" && ["direct", "member-relay", "server-relay"].includes(u.kind)) {
      result.label = u.kind as VoicePathLabel; result.reason = undefined;
    }
  }
  const m = e.metrics;
  if (!m) return result;
  if (!fresh(m.observedAtMs, now)) return { ...result, metricsReason: m.observedAtMs <= now ? "expired" : "invalid" };
  if (m.source !== "selected-media-stats" || !sameRoute(m, e) || m.scope !== (e.selected === "peer" ? "peer-transport" : "sfu-transport")) return { ...result, metricsReason: "invalid" };
  result.metricsScope = m.scope;
  result.metricsAgeMs = now - m.observedAtMs;
  if (typeof m.rttMs === "number" && Number.isFinite(m.rttMs) && m.rttMs >= 0 && m.rttMs <= 60_000) result.rttMs = m.rttMs;
  const loss = m.loss;
  if (loss && Number.isSafeInteger(loss.packetsLost) && loss.packetsLost >= 0 && Number.isSafeInteger(loss.packetsReceived) && loss.packetsReceived >= 0 &&
    Number.isSafeInteger(loss.packetsLost + loss.packetsReceived) && loss.packetsLost + loss.packetsReceived > 0 && Number.isFinite(loss.windowMs) && loss.windowMs >= 500 && loss.windowMs <= 10_000) {
    result.lossPercent = 100 * loss.packetsLost / (loss.packetsLost + loss.packetsReceived);
    result.lossWindowMs = loss.windowMs;
  }
  result.metricsReason = result.rttMs !== null || result.lossPercent !== null ? "measured" : "invalid";
  return result;
}
export function readMemberVoiceMediaPath(input: { scope?: MemberVoiceMediaScope; evidence?: MemberVoiceMediaEvidence; nowMs?: number }): MemberVoiceMediaPath {
  const reject = (reason: VoicePathReason): MemberVoiceMediaPath => ({ receive: pending(reason), send: pending(reason) });
  const { scope, evidence: e, nowMs: now } = input;
  if (!e) return reject("not-integrated");
  if (!scope || !validScope(scope) || !Number.isFinite(now) || (now as number) < 0 || e.schemaVersion !== 1 || e.source !== "authenticated-sdk-media-selection") return reject("invalid");
  if (!e.scope || Object.keys(scope).length !== Object.keys(e.scope).length || Object.keys(scope).some(key => e.scope[key as keyof MemberVoiceMediaScope] !== scope[key as keyof MemberVoiceMediaScope])) return reject("scope-mismatch");
  if (!fresh(e.observedAtMs, now as number)) return reject(e.observedAtMs <= (now as number) ? "expired" : "invalid");
  return { receive: direction(e.receive, "receive", scope, now as number), send: direction(e.send, "send", scope, now as number) };
}
