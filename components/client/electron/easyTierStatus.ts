import type { EasyTierRoute } from "../src/lib/easyTierCommunity";
import type { LanEnrollment } from "../src/lib/memberLanStatus";

interface EasyTierPeerState { userId: string; virtualIp: string | null; route: EasyTierRoute; rttMs: number | null }

/** Provided by an authenticated membership authority, separately from ET RPC. */
export interface EasyTierIdentityBinding {
  serverId: string;
  instanceId: string;
  generation: number;
  userId: string;
  peerId: number;
  authenticated: boolean;
  expiresAtMs: number;
  deviceId: string;
  observedAtUnixMs: number;
  enrollment: LanEnrollment;
  enrollmentObservedAtUnixMs: number;
}

export interface EasyTierRttObservation {
  source: "easytier-local";
  fromPeerId: number;
  toPeerId: number;
  observedAtMs: number;
  observedAtUnixMs: number;
  ms: number;
}

export interface EasyTierStatusSample {
  serverId: string;
  instanceId: string;
  generation: number;
  /** Monotonic local acquisition time, never a peer supplied timestamp. */
  acquiredAtMs: number;
  acquiredAtUnixMs: number;
  /** A fresh scoped CollectNetworkInfo result, not a cached CLI/table dump. */
  freshRpc: boolean;
  latencyFirst: boolean | null;
  info: unknown;
  bindings: EasyTierIdentityBinding[];
  /** Bare PeerConnStats.latency_us has no measurement timestamp: leave absent. */
  rtt?: EasyTierRttObservation[];
  /** Verified data-forwarding decision, including packet policy and foreign-network routing. */
  selectedRoutes?: { fromPeerId: number; toPeerId: number; nextHopPeerId: number; observedAtMs: number; observedAtUnixMs: number }[];
  /** Verified next-hop role, independent of nicknames/hostnames/virtual addresses. */
  relayRoles?: { peerId: number; kind: "server" | "member"; observedAtUnixMs: number }[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}
function peerId(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 0xffffffff ? value : null;
}
function uuid(value: unknown): string | null {
  if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return value.toLowerCase();
  const v = record(value);
  const parts = [v.part1, v.part2, v.part3, v.part4];
  if (!parts.every(x => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 0xffffffff)) return null;
  const hex = parts.map(x => (x as number).toString(16).padStart(8, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Only RFC1918 virtual IPv4 reaches UI; never an RPC physical/public address. */
export function easyTierVirtualIp(value: unknown): string | null {
  let text: string;
  if (typeof value === "string") text = value.split("/")[0];
  else {
    const addr = record(record(value).address).addr;
    if (typeof addr !== "number" || !Number.isInteger(addr) || addr < 0 || addr > 0xffffffff) return null;
    text = [addr >>> 24, (addr >>> 16) & 255, (addr >>> 8) & 255, addr & 255].join(".");
  }
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return null;
  const octets = text.split(".").map(Number);
  if (octets.some(x => x > 255)) return null;
  const [a, b] = octets;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ? octets.join(".") : null;
}

export function projectEasyTierStatus(sample: EasyTierStatusSample | null, scope: {
  serverId: string; instanceId: string; generation: number;
}, nowMs: number, maxAgeMs = 5000): { running: boolean | null; virtualIp: string | null; peers: EasyTierPeerState[] } {
  const scoped = sample !== null && sample.serverId === scope.serverId && sample.instanceId === scope.instanceId && sample.generation === scope.generation;
  const fresh = scoped && sample.freshRpc && Number.isFinite(sample.acquiredAtMs) && Number.isSafeInteger(sample.acquiredAtUnixMs) && sample.acquiredAtUnixMs > 0 && nowMs >= sample.acquiredAtMs && nowMs - sample.acquiredAtMs <= maxAgeMs;
  const unixNow = scoped ? sample.acquiredAtUnixMs + nowMs - sample.acquiredAtMs : NaN;
  const freshUnix = (at: number) => Number.isSafeInteger(at) && at > 0 && unixNow >= at && unixNow - at <= maxAgeMs;
  const info = fresh ? record(sample.info) : {};
  const node = record(info.my_node_info);
  const localPeer = peerId(node.peer_id);
  const routes = rows(info.routes);
  const peers = rows(info.peers);
  // Ambiguous, expired or unauthenticated bindings must never borrow another user's route.
  const bindings = scoped ? sample.bindings.filter(b => b.serverId === scope.serverId && b.instanceId === scope.instanceId && b.generation === scope.generation) : [];
  const result: EasyTierPeerState[] = [];
  for (const userId of new Set(bindings.map(b => b.userId))) {
    const candidates = bindings.filter(b => b.userId === userId);
    const binding = candidates[0];
    const state: EasyTierPeerState = { userId, virtualIp: null, route: "unknown", rttMs: null };
    result.push(state);
    if (!fresh || info.running !== true || candidates.length !== 1 || !binding.authenticated || !binding.deviceId || binding.enrollment !== "joined" || !freshUnix(binding.observedAtUnixMs) || !freshUnix(binding.enrollmentObservedAtUnixMs) || !Number.isFinite(binding.expiresAtMs) || binding.expiresAtMs <= nowMs || !peerId(binding.peerId) || binding.peerId === localPeer || bindings.filter(b => b.peerId === binding.peerId).length !== 1) continue;
    const matching = routes.filter(r => r.peer_id === binding.peerId);
    if (matching.length !== 1) continue;
    const route = matching[0];
    state.virtualIp = easyTierVirtualIp(route.ipv4_addr);
    if (sample.latencyFirst === null || localPeer === null) continue;
    const nextHop = peerId(sample.latencyFirst ? route.next_hop_peer_id_latency_first : route.next_hop_peer_id);
    if (nextHop === null || nextHop === localPeer) continue;
    // A route-table candidate is not the final forwarding decision. The core can
    // prefer a present peer/foreign-network path depending on the packet policy.
    const selectedRoutes = (sample.selectedRoutes ?? []).filter(r => r.fromPeerId === localPeer && r.toPeerId === binding.peerId);
    if (selectedRoutes.length !== 1 || selectedRoutes[0].nextHopPeerId !== nextHop || !freshUnix(selectedRoutes[0].observedAtUnixMs) || nowMs < selectedRoutes[0].observedAtMs || nowMs - selectedRoutes[0].observedAtMs > maxAgeMs) continue;
    const hopPeers = peers.filter(p => p.peer_id === nextHop);
    if (hopPeers.length !== 1) continue;
    const hop = hopPeers[0];
    const selected = uuid(hop.default_conn_id);
    const connections = rows(hop.conns).filter(c => uuid(c.conn_id) === selected && c.my_peer_id === localPeer && c.peer_id === nextHop && c.is_closed === false);
    if (!selected || connections.length !== 1) continue;
    const connection = connections[0];
    if (nextHop !== binding.peerId) { state.route = "relay"; continue; }
    const direct = Array.isArray(hop.directly_connected_conns) && hop.directly_connected_conns.some(c => uuid(c) === selected);
    // One hop, host ICE candidates and virtual IPs are insufficient physical evidence.
    if (!direct || !["udp", "tcp", "quic"].includes(String(record(connection.tunnel).tunnel_type))) continue;
    state.route = "physical-direct";
    const rtt = (sample.rtt ?? []).filter(r => r.source === "easytier-local" && r.fromPeerId === localPeer && r.toPeerId === binding.peerId);
    if (rtt.length === 1 && Number.isFinite(rtt[0].ms) && rtt[0].ms >= 0 && rtt[0].ms <= 60_000 && freshUnix(rtt[0].observedAtUnixMs) && nowMs >= rtt[0].observedAtMs && nowMs - rtt[0].observedAtMs <= maxAgeMs) state.rttMs = rtt[0].ms;
  }
  return { running: typeof info.running === "boolean" ? info.running : null, virtualIp: info.running === true ? easyTierVirtualIp(node.virtual_ipv4) : null, peers: result };
}
