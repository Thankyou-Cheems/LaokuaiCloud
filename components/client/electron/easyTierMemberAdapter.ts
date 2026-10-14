import { communityDnsNameZone } from "../src/lib/communityDnsNames";
import type { EasyTierPhase } from "../src/lib/easyTierCommunity";
import type { LanCommunitySnapshot, LanDnsAddress, LanEnrollment, LanMemberEvidence } from "../src/lib/memberLanStatus";
import { type EasyTierIdentityBinding, type EasyTierStatusSample, easyTierVirtualIp, projectEasyTierStatus } from "./easyTierStatus";

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
  const scopedBindings = sample.bindings.filter(b => b.serverId === scope.serverId && b.instanceId === scope.instanceId && b.generation === scope.generation);
  // The server roster is authenticated independently from local ET telemetry.
  // Revalidate it here as well because this adapter is the UI trust boundary.
  const directory = new Map<string, string[]>();
  const directoryAddresses = new Set<string>();
  for (const entry of validTime(sample.directoryObservedAtUnixMs ?? NaN) && Array.isArray(sample.directory) && sample.directory.length <= 256 ? sample.directory : []) {
    if (!entry || typeof entry.serverUserId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(entry.serverUserId)) { directory.clear(); directoryAddresses.clear(); break; }
    const address = easyTierVirtualIp(entry.virtualIp);
    if (!address || address !== entry.virtualIp || directoryAddresses.has(address)) { directory.clear(); directoryAddresses.clear(); break; }
    directory.set(entry.serverUserId, [...directory.get(entry.serverUserId) ?? [], address]); directoryAddresses.add(address);
  }
  const dnsByIp = new Map<string, LanDnsAddress>();
  const dnsNames = new Set<string>(), dnsZones = new Set<string>();
  for (const address of sample.dnsReady === true && validTime(sample.directoryObservedAtUnixMs ?? NaN) && Array.isArray(sample.dnsAddresses) && sample.dnsAddresses.length <= 256 ? sample.dnsAddresses : []) {
    if (!address || !communityDnsNameZone(address.dnsName) ||
      !directoryAddresses.has(address.virtualIp) || dnsByIp.has(address.virtualIp) || dnsNames.has(address.dnsName) ||
      !Number.isSafeInteger(address.expiresAtUnixMs) || address.expiresAtUnixMs <= unixNowMs || address.expiresAtUnixMs > unixNowMs + Math.min(maxAgeMs, 10_000)) {
      dnsByIp.clear(); break;
    }
    dnsByIp.set(address.virtualIp, {dnsName: address.dnsName, virtualIp: address.virtualIp, expiresAtUnixMs: address.expiresAtUnixMs});
    dnsNames.add(address.dnsName); dnsZones.add(communityDnsNameZone(address.dnsName)!);
  }
  if (dnsZones.size > 1) dnsByIp.clear();
  const memberDns = (virtualIps: readonly string[]) => virtualIps.flatMap(address => dnsByIp.has(address) ? [dnsByIp.get(address)!] : []);
  const validBinding = (binding: EasyTierIdentityBinding) => binding.authenticated && !!binding.deviceId && !!binding.userId && Number.isSafeInteger(binding.peerId) && binding.peerId > 0 && binding.peerId <= 0xffffffff && binding.expiresAtMs > nowMs && validTime(binding.observedAtUnixMs);
  const locals = scopedBindings.filter(b => b.peerId === localPeer);
  if (locals.length !== 1 || !validBinding(locals[0])) return null;
  const local = locals[0];
  // Several authenticated devices are one member row. Preserve their node state
  // while withholding a single path when that member has several addresses.
  const groups = new Map<string, EasyTierIdentityBinding[]>();
  for (const candidate of scopedBindings) {
    if (candidate !== local && candidate.userId === local.userId) continue;
    groups.set(candidate.userId, [...groups.get(candidate.userId) ?? [], candidate]);
  }
  const bindings = [...groups.values()].map(group => group[0]);
  const peers = status.peers;
  const routes = Array.isArray(info.routes) ? info.routes.map(object) : [];
  const members: LanMemberEvidence[] = bindings.map(binding => {
    const group = groups.get(binding.userId)!;
    const ambiguous = group.some(candidate => scopedBindings.filter(b => b.peerId === candidate.peerId).length !== 1) ||
      new Set(group.map(candidate => candidate.deviceId)).size !== group.length;
    const verified = !ambiguous && group.every(validBinding);
    const member: LanMemberEvidence = {
      binding: { authenticatedUserId: binding.userId, peerId: verified ? String(binding.peerId) : null, confidence: ambiguous ? "ambiguous" : verified ? "verified" : "unverified", source: "authenticated-community", observedAtMs: binding.observedAtUnixMs,
        expiresAtMs: Math.floor(unixNowMs + Math.min(...group.map(candidate => candidate.expiresAtMs)) - nowMs) },
      enrollment: { state: binding === local ? enrollmentForPhase(phase) : binding.enrollment, source: binding === local ? "easytier-local" : "authenticated-community", observedAtMs: binding === local ? sample.acquiredAtUnixMs : binding.enrollmentObservedAtUnixMs },
      ...(verified && binding !== local ? {connectedDevices: group.length} : {}),
    };
    const peer = peers.find(p => p.userId === binding.userId);
    // The address is useful for game/LAN setup, but it is only safe to expose
    // after the same authenticated binding used for the route projection. It
    // is never taken from a nickname, a physical endpoint or voice telemetry.
    const virtualIp = binding === local ? status.virtualIp : null;
    if (verified && virtualIp) { member.virtualIp = virtualIp; member.virtualIpObservedAtMs = sample.acquiredAtUnixMs; }
    // The local row always addresses this device. The authenticated directory
    // shows all remote devices without borrowing any device's path evidence.
    if (verified && binding !== local && directory.has(binding.userId)) {
      member.virtualIps = directory.get(binding.userId); member.virtualIpObservedAtMs = sample.directoryObservedAtUnixMs;
    }
    if (verified) {
      // The local row names this device's actual address. Other devices on the
      // same account stay on their own authenticated directory addresses.
      const addresses = binding === local ? virtualIp && directory.get(binding.userId)?.includes(virtualIp) ? [virtualIp] : [] : member.virtualIps ?? [];
      const names = memberDns(addresses);
      if (names.length) member.dnsAddresses = names;
    }
    if (binding === local || !verified || !peer || (member.virtualIps?.length ?? 0) > 1 || status.running !== true || phase !== "connected" || local.enrollment !== "joined" || !validTime(local.enrollmentObservedAtUnixMs) || !validTime(binding.enrollmentObservedAtUnixMs)) return member;
    const path: NonNullable<LanMemberEvidence["path"]> = {
      kind: peer.route === "physical-direct" ? "direct" : "unknown", source: "easytier-local", communityId: scope.serverId,
      fromPeerId: String(local.peerId), toPeerId: String(binding.peerId), observedAtMs: sample.acquiredAtUnixMs,
      // Route visibility needs the authenticated peer+address join, independently
      // from the stronger selected-forwarding/physical-path evidence below.
      routeVisible: validTime(sample.acquiredAtUnixMs) && sample.freshRpc && nowMs >= sample.acquiredAtMs && nowMs - sample.acquiredAtMs <= 5000 &&
        !!binding.virtualIp && directory.get(binding.userId)?.includes(binding.virtualIp) === true &&
        routes.filter(r => r.peer_id === binding.peerId).length === 1 &&
        easyTierVirtualIp(routes.find(r => r.peer_id === binding.peerId)?.ipv4_addr) === binding.virtualIp,
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
  // An active credential proves an address assignment, never a connected peer.
  for (const [serverUserId, virtualIps] of directory) {
    if (members.some(member => member.binding.authenticatedUserId === serverUserId)) continue;
    const names = memberDns(virtualIps);
    members.push({
      binding: {authenticatedUserId: serverUserId, peerId: null, confidence: "verified", source: "authenticated-community", observedAtMs: sample.directoryObservedAtUnixMs!},
      enrollment: {state: "assigned", source: "authenticated-community", observedAtMs: sample.directoryObservedAtUnixMs!},
      virtualIps, virtualIpObservedAtMs: sample.directoryObservedAtUnixMs,
      ...(names.length ? {dnsAddresses: names} : {}),
    });
  }
  const observer = members.find(m => m.binding.authenticatedUserId === local.userId)?.binding;
  if (!observer || observer.confidence !== "verified") return null;
  return { schemaVersion: 1, serverScope: scope.serverId, communityId: scope.serverId, source: "easytier-local", observedAtMs: sample.acquiredAtUnixMs, observer, members,
    dnsReady: sample.dnsReady === true && dnsByIp.size > 0 };
}
