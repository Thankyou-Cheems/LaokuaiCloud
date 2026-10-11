/** Presentation contract only. A future adapter verifies authentication and ET telemetry.
 * Never populate these records by nickname, online presence, ICE type or SFU RTT.
 * All timestamps use Unix milliseconds on the adapter's normalized local clock.
 * The host must advance nowMs while telemetry is idle so old readings expire.
 * Community scope survives voice-room changes. Do not store public IPs or keys here.
 */
export const MEMBER_LAN_MAX_AGE_MS = 10_000;
export type LanEnrollment = "off" | "not-joined" | "joining" | "joined" | "error";
export type LanPath = "direct" | "member-relay" | "server-relay" | "unknown";
export type LanBindingConfidence = "verified" | "unverified" | "ambiguous";
export type LanEvidenceSource = "authenticated-community" | "easytier-local";
export interface LanIdentityBinding {
  /** Authenticated server-scoped member ID (serverUserId), never a display name. */
  authenticatedUserId: string;
  /** Opaque ET identity, never a nickname or address. Null before joining. */
  peerId: string | null;
  confidence: LanBindingConfidence;
  source: "authenticated-community";
  observedAtMs: number;
}
export interface LanPeerPathEvidence {
  /** Actual measured route from this observer, not the remote peer's own route. */
  kind: LanPath;
  source: "easytier-local";
  communityId: string;
  fromPeerId: string;
  toPeerId: string;
  observedAtMs: number;
  rtt?: {
    scope: "peer";
    source: "easytier-local";
    communityId: string;
    fromPeerId: string;
    toPeerId: string;
    observedAtMs: number;
    ms: number;
  };
}
export interface LanMemberEvidence {
  binding: LanIdentityBinding;
  enrollment: { state: LanEnrollment; source: LanEvidenceSource; observedAtMs: number };
  path?: LanPeerPathEvidence;
}
export interface LanCommunitySnapshot {
  schemaVersion: 1;
  /** Exact canonical server scope supplied by the authenticated community adapter. */
  serverScope: string;
  communityId: string;
  source: LanEvidenceSource;
  observedAtMs: number;
  observer: LanIdentityBinding;
  members: readonly LanMemberEvidence[];
}
export type LanReadingReason = "not-integrated" | "scope-mismatch" | "missing" | "unverified" | "ambiguous" | "stale" | "invalid" | "not-joined" | "self";
export interface MemberLanReading {
  enrollment: LanEnrollment | "unavailable" | "unknown" | "stale";
  enrollmentReason?: LanReadingReason;
  path: LanPath;
  pathReason?: LanReadingReason;
  rttMs: number | null;
  rttReason?: LanReadingReason;
  /** Safe enums only; identity/peer IDs and arbitrary diagnostic text stay private. */
  source?: LanEvidenceSource;
  observedAtMs?: number;
}
const sources = new Set(["authenticated-community", "easytier-local"]);
const enrollments = new Set(["off", "not-joined", "joining", "joined", "error"]);
const paths = new Set(["direct", "member-relay", "server-relay", "unknown"]);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
function ageReason(timestamp: number, nowMs: number): "stale" | "invalid" | undefined {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0 || !Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > nowMs) return "invalid";
  return nowMs - timestamp > MEMBER_LAN_MAX_AGE_MS ? "stale" : undefined;
}
function bindingReason(binding: LanIdentityBinding | undefined, nowMs: number): LanReadingReason | undefined {
  if (!binding || !nonempty(binding.authenticatedUserId) || binding.source !== "authenticated-community") return "unverified";
  if (binding.confidence !== "verified") return binding.confidence === "ambiguous" ? "ambiguous" : "unverified";
  return ageReason(binding.observedAtMs, nowMs);
}
/** Fail closed to unknown. Rendering does not authenticate a claimed binding itself. */
export function readMemberLanStatus({ serverScope, authenticatedUserId, observerAuthenticatedUserId, snapshot, nowMs }: {
  serverScope: string;
  authenticatedUserId: string;
  /** Current authenticated local member in this server; required for a peer path. */
  observerAuthenticatedUserId?: string;
  snapshot?: LanCommunitySnapshot;
  nowMs?: number;
}): MemberLanReading {
  const unknown = (reason: LanReadingReason): MemberLanReading => ({ enrollment: reason === "not-integrated" ? "unavailable" : reason === "stale" ? "stale" : "unknown",
    enrollmentReason: reason, path: "unknown", pathReason: reason, rttMs: null, rttReason: reason });
  if (!snapshot) return unknown("not-integrated");
  if (snapshot.schemaVersion !== 1 || !sources.has(snapshot.source) || !Array.isArray(snapshot.members)) return unknown("invalid");
  if (!nonempty(serverScope) || !nonempty(authenticatedUserId) || snapshot.serverScope !== serverScope || !nonempty(snapshot.communityId)) return unknown("scope-mismatch");
  const clock = nowMs ?? NaN;
  const snapshotAge = ageReason(snapshot.observedAtMs, clock);
  if (snapshotAge) return unknown(snapshotAge);
  const matches = snapshot.members.filter(member => member?.binding?.authenticatedUserId === authenticatedUserId);
  if (!matches.length) return unknown("missing");
  if (matches.length !== 1) return unknown("ambiguous");
  const member = matches[0];
  const binding = bindingReason(member.binding, clock);
  if (binding) return unknown(binding);
  const peer = member.binding.peerId;
  if (peer !== null && !nonempty(peer)) return unknown("invalid");
  if (peer && snapshot.members.some(other => other !== member && other?.binding?.peerId === peer)) return unknown("ambiguous");
  if (!member.enrollment || !enrollments.has(member.enrollment.state) || !sources.has(member.enrollment.source)) return unknown("invalid");
  const membershipAge = ageReason(member.enrollment.observedAtMs, clock);
  if (membershipAge) return unknown(membershipAge);
  if (member.enrollment.state === "joined" && !peer) return unknown("unverified");
  const result: MemberLanReading = { enrollment: member.enrollment.state, path: "unknown", rttMs: null,
    source: member.enrollment.source, observedAtMs: member.enrollment.observedAtMs };
  const noPath = (reason: LanReadingReason): MemberLanReading => ({ ...result, pathReason: reason, rttReason: reason });
  if (member.enrollment.state !== "joined") return noPath("not-joined");
  const observer = snapshot.observer;
  const observerReason = bindingReason(observer, clock);
  if (observerReason) return noPath(observerReason);
  if (!nonempty(observerAuthenticatedUserId) || observer.authenticatedUserId !== observerAuthenticatedUserId) return noPath("unverified");
  if (!nonempty(observer.peerId)) return noPath("unverified");
  if (observer.authenticatedUserId === authenticatedUserId) return noPath(observer.peerId === peer ? "self" : "ambiguous");
  // The observer must also have fresh joined membership in this community.
  const local = snapshot.members.filter(item => item?.binding?.authenticatedUserId === observer.authenticatedUserId);
  if (local.length !== 1) return noPath(local.length ? "ambiguous" : "missing");
  const localReason = bindingReason(local[0].binding, clock);
  if (localReason) return noPath(localReason);
  if (local[0].binding.peerId !== observer.peerId || snapshot.members.some(item => item !== local[0] && item?.binding?.peerId === observer.peerId)) return noPath("ambiguous");
  if (local[0].enrollment?.state !== "joined") return noPath("not-joined");
  const localAge = ageReason(local[0].enrollment.observedAtMs, clock);
  if (localAge) return noPath(localAge);
  if (!sources.has(local[0].enrollment.source)) return noPath("invalid");
  const path = member.path;
  if (!path) return noPath("missing");
  if (path.source !== "easytier-local" || !paths.has(path.kind) || path.communityId !== snapshot.communityId || path.fromPeerId !== observer.peerId || path.toPeerId !== peer) return noPath("invalid");
  const pathAge = ageReason(path.observedAtMs, clock);
  if (pathAge) return noPath(pathAge);
  result.path = path.kind;
  if (path.kind === "unknown") result.pathReason = "missing";
  const rtt = path.rtt;
  if (!rtt) return { ...result, rttReason: "missing" };
  if (rtt.scope !== "peer" || rtt.source !== "easytier-local" || rtt.communityId !== snapshot.communityId || rtt.fromPeerId !== observer.peerId || rtt.toPeerId !== peer ||
    !Number.isFinite(rtt.ms) || rtt.ms < 0 || rtt.ms > 60_000) return { ...result, rttReason: "invalid" };
  const rttAge = ageReason(rtt.observedAtMs, clock);
  return rttAge ? { ...result, rttReason: rttAge } : { ...result, rttMs: rtt.ms };
}
