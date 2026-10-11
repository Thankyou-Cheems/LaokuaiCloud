import { easyTierConnectionId, easyTierVirtualIp } from "./easyTierStatus";

const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const id = (v: unknown): number | null => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 0xffffffff ? v : null;
const cost = (v: unknown): number | null => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 0x7fffffff ? v : null;
const unavailable = (): never => { throw new Error("invalid-owned-network-status"); };
const rows = (v: unknown, maximum: number): unknown[] => Array.isArray(v) && v.length <= maximum ? v : unavailable();

export interface EasyTierCliNetwork {
  acquiredAtMs: number;
  acquiredAtUnixMs: number;
  acquisitionStartedAtMs: number;
  acquisitionStartedAtUnixMs: number;
  latencyFirst: null;
  info: { running: true; my_node_info: { peer_id: number; virtual_ipv4: string | null }; routes: Array<Record<string, unknown>>; peers: Array<Record<string, unknown>> };
}

/** Accept ONLY the exact verbose RouteListData schema, scoped to the requested UUID. */
export function sanitizedEasyTierCliNetwork(value: unknown, instanceId: string): EasyTierCliNetwork["info"] {
  const result = object(value), node = object(result.node_info);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(instanceId)
    || typeof node.inst_id !== "string" || node.inst_id.toLowerCase() !== instanceId.toLowerCase() || !id(node.peer_id)) unavailable();
  const localPeer = id(node.peer_id)!;
  const routes: Array<Record<string, unknown>> = [], peers: Array<Record<string, unknown>> = [];
  const routeIds = new Set<number>(), peerIds = new Set<number>();
  for (const row of rows(result.peer_routes, 1024)) {
    const pair = object(row), route = object(pair.route), peer = object(pair.peer), destination = id(route.peer_id), remote = id(peer.peer_id);
    if (!destination && !remote) unavailable();
    if (destination && remote && destination !== remote) unavailable();
    if (destination) {
      if (routeIds.has(destination)) unavailable(); routeIds.add(destination);
      routes.push({ peer_id: destination, ipv4_addr: easyTierVirtualIp(route.ipv4_addr), next_hop_peer_id: id(route.next_hop_peer_id),
        next_hop_peer_id_latency_first: id(route.next_hop_peer_id_latency_first), cost: cost(route.cost), cost_latency_first: cost(route.cost_latency_first) });
    }
    if (remote) {
      if (peerIds.has(remote) || remote === localPeer) unavailable(); peerIds.add(remote);
      const connIds = new Set<string>();
      const conns = rows(peer.conns, 64).map(v => {
        const c = object(v), conn = easyTierConnectionId(c.conn_id);
        if (!conn) return unavailable();
        if (connIds.has(conn) || id(c.my_peer_id) !== localPeer || id(c.peer_id) !== remote) unavailable();
        connIds.add(conn);
        const type = object(c.tunnel).tunnel_type;
        return { conn_id: conn, my_peer_id: localPeer, peer_id: remote, is_closed: typeof c.is_closed === "boolean" ? c.is_closed : null,
          tunnel: { tunnel_type: ["tcp", "udp", "quic", "wg", "wireguard", "ws", "wss", "ring", "faketcp"].includes(String(type)) ? type : null } };
      });
      const direct = rows(peer.directly_connected_conns, 64).map(easyTierConnectionId).filter((c): c is string => c !== null);
      peers.push({ peer_id: remote, default_conn_id: easyTierConnectionId(peer.default_conn_id), directly_connected_conns: [...new Set(direct)], conns });
    }
  }
  // NodeInfo.config contains TOML/credentials. Do not parse, return or log it.
  // Bare stats.latency_us and route path_latency lack measurement time; discard them.
  return { running: true, my_node_info: { peer_id: localPeer, virtual_ipv4: easyTierVirtualIp(node.ipv4_addr) }, routes, peers };
}
