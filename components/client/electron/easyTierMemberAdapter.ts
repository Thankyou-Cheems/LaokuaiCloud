import type { EasyTierPhase } from "../src/lib/easyTierCommunity";
import type { LanCommunitySnapshot, LanEnrollment, LanMemberEvidence } from "../src/lib/memberLanStatus";
import { type EasyTierIdentityBinding, type EasyTierStatusSample, projectEasyTierStatus } from "./easyTierStatus";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const enrollmentForPhase = (phase: EasyTierPhase): LanEnrollment =>
  phase === "connected" ? "joined" : phase === "connecting" ? "joining" : phase === "error" ? "error" : "off";

/** Projects into the UI owner's v1 contract; never authenticates a nickname/ET peer. */
export function projectEasyTierMembers(sample: EasyTierStatusSample | null, scope: {
  serverId: string; instanceId: string; generation: number;
}, phase: EasyTierPhase, nowMs: number, unixNowMs: number, maxAgeMs = 10_000): LanCommunitySnapshot | null {
  if (!sample || sample.serverId !== scope.serverId || sample.instanceId !== scope.instanceId || sample.generation !== scope.generation) return null;
  const validTime = (at: number) => Number.isSafeInteger(unixNowMs) && unixNowMs > 0 && Number.isSafeInteger(at) && at > 0 && unixNowMs >= at && unixNowMs - at <= maxAgeMs;
  const status = projectEasyTierStatus(sample, scope, nowMs, maxAgeMs);
  const info = object(sample.info);
  const localPeer = object(info.my_node_info).peer_id;
  const bindings = sample.bindings.filter(b => b.serverId === scope.serverId && b.instanceId === scope.instanceId && b.generation === scope.generation);
  const validBinding = (binding: EasyTierIdentityBinding) => binding.authenticated && !!binding.deviceId && !!binding.userId && Number.isSafeInteger(binding.peerId) && binding.peerId > 0 && binding.peerId <= 0xffffffff && binding.expiresAtMs > nowMs && validTime(binding.observedAtUnixMs);
  const locals = bindings.filter(b => b.peerId === localPeer);
  if (locals.length !== 1 || !validBinding(locals[0])) return null;
  const local = locals[0];
  const peers = status.peers;
  const routes = Array.isArray(info.routes) ? info.routes.map(object) : [];
  const members: LanMemberEvidence[] = bindings.map(binding => {
    const ambiguous = bindings.filter(b => b.userId === binding.userId).length !== 1 || bindings.filter(b => b.peerId === binding.peerId).length !== 1;
    const verified = !ambiguous && validBinding(binding);
    const member: LanMemberEvidence = {
      binding: { authenticatedUserId: binding.userId, peerId: verified ? String(binding.peerId) : null, confidence: ambiguous ? "ambiguous" : verified ? "verified" : "unverified", source: "authenticated-community", observedAtMs: binding.observedAtUnixMs },
      enrollment: { state: binding === local ? enrollmentForPhase(phase) : binding.enrollment, source: binding === local ? "easytier-local" : "authenticated-community", observedAtMs: binding === local ? sample.acquiredAtUnixMs : binding.enrollmentObservedAtUnixMs },
    };
    const peer = peers.find(p => p.userId === binding.userId);
    if (binding === local || !verified || !peer || status.running !== true || phase !== "connected" || local.enrollment !== "joined" || !validTime(local.enrollmentObservedAtUnixMs) || !validTime(binding.enrollmentObservedAtUnixMs)) return member;
    const path: NonNullable<LanMemberEvidence["path"]> = {
      kind: peer.route === "physical-direct" ? "direct" : "unknown", source: "easytier-local", communityId: scope.serverId,
      fromPeerId: String(local.peerId), toPeerId: String(binding.peerId), observedAtMs: sample.acquiredAtUnixMs,
    };
    if (peer.route === "relay") {
      const route = routes.find(r => r.peer_id === binding.peerId);
      const nextHop = sample.latencyFirst ? route?.next_hop_peer_id_latency_first : route?.next_hop_peer_id;
      const roles = (sample.relayRoles ?? []).filter(r => r.peerId === nextHop && validTime(r.observedAtUnixMs));
      if (roles.length === 1) path.kind = roles[0].kind === "server" ? "server-relay" : "member-relay";
    }
    const rtt = (sample.rtt ?? []).filter(r => r.fromPeerId === local.peerId && r.toPeerId === binding.peerId && r.source === "easytier-local");
    if (peer.rttMs !== null && rtt.length === 1 && validTime(rtt[0].observedAtUnixMs)) path.rtt = {
      scope: "peer", source: "easytier-local", communityId: scope.serverId, fromPeerId: String(local.peerId), toPeerId: String(binding.peerId), observedAtMs: rtt[0].observedAtUnixMs, ms: peer.rttMs,
    };
    member.path = path;
    return member;
  });
  const observer = members.find(m => m.binding.authenticatedUserId === local.userId)?.binding;
  if (!observer || observer.confidence !== "verified") return null;
  return { schemaVersion: 1, serverScope: scope.serverId, communityId: scope.serverId, source: "easytier-local", observedAtMs: sample.acquiredAtUnixMs, observer, members };
}
