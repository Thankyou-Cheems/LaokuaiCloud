import type { EasyTierCommunityState, EasyTierLocalNetworkDetails } from "./easyTierCommunity";

export interface VoiceLocalNetworkReading {
  serverId: string;
  generation: number;
  details: EasyTierLocalNetworkDetails | null;
  reason: "available" | "missing" | "scope-mismatch" | "expired" | "invalid";
  /** No authenticated member-to-peer producer exists. Local adjacency is insufficient. */
  memberBindings: readonly never[];
  physicalPath: "unknown";
  rttMs: null;
}
/** ET's main-process UTC acquisition times are a separate clock domain from SDK
 * performance.now. Voice room changes never manage community lifetime. */
export function readVoiceLocalNetwork(serverId: string | undefined, state: EasyTierCommunityState | undefined,
  unixNow: number): VoiceLocalNetworkReading | undefined {
  if (!serverId) return;
  const base = { serverId, generation: state?.generation ?? 0, details: null,
    memberBindings: [] as never[], physicalPath: "unknown" as const, rttMs: null };
  if (!state || state.phase !== "connected" || !state.localDetails) return { ...base, reason: "missing" };
  const d = state.localDetails;
  if (state.serverId !== serverId || d.serverId !== serverId || d.generation !== state.generation || !d.instanceId)
    return { ...base, reason: "scope-mismatch" };
  if (d.source !== "owned-cli-route-list" || d.running !== true || d.memberBinding !== "unavailable" || d.rttMs !== null ||
    !Number.isSafeInteger(d.acquisitionStartedAtUnixMs) || !Number.isSafeInteger(d.acquiredAtUnixMs) ||
    !Number.isFinite(unixNow) || d.acquisitionStartedAtUnixMs <= 0 || d.acquiredAtUnixMs < d.acquisitionStartedAtUnixMs ||
    d.acquiredAtUnixMs > unixNow || !Number.isFinite(d.maxAgeMs) || d.maxAgeMs <= 0 || d.maxAgeMs > 5000)
    return { ...base, reason: "invalid" };
  if (unixNow - d.acquisitionStartedAtUnixMs > d.maxAgeMs) return { ...base, reason: "expired" };
  // Main's producer already sanitizes the schema. Keep a copy of its explicitly
  // declared local facts; never attach them to a member/ICE edge or outbound path.
  const details: EasyTierLocalNetworkDetails = { source: d.source, serverId, instanceId: d.instanceId, generation: d.generation,
    acquisitionStartedAtUnixMs: d.acquisitionStartedAtUnixMs, acquiredAtUnixMs: d.acquiredAtUnixMs, maxAgeMs: d.maxAgeMs,
    running: true, localPeerId: d.localPeerId, virtualIp: d.virtualIp, latencyFirst: d.latencyFirst,
    routes: d.routes.map(r => ({ peerId: r.peerId, virtualIp: r.virtualIp, nextHopPeerId: r.nextHopPeerId,
      latencyFirstNextHopPeerId: r.latencyFirstNextHopPeerId, cost: r.cost, latencyFirstCost: r.latencyFirstCost })),
    peers: d.peers.map(p => ({ peerId: p.peerId, defaultConnectionId: p.defaultConnectionId,
      connections: p.connections.map(c => ({ connectionId: c.connectionId, closed: c.closed, tunnelType: c.tunnelType, reportedDirect: c.reportedDirect })) })),
    memberBinding: "unavailable", rttMs: null, missingEvidence: [...d.missingEvidence] };
  return { ...base, details, reason: "available" };
}
