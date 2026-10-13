import type {
  ReceivePathUnderlayResolver,
  ReceiveTransportPathEvidence,
  ReceiveUnderlayClass,
  ReceiveUnderlayEvidence,
} from "@gryt/voice";

import type { EasyTierLocalNetworkDetails } from "./easyTierCommunity";
import type { VoiceLocalNetworkReading } from "./memberVoiceLocalNetwork";

/**
 * Resolve only the selected ICE pair that is already in memory. The resolver
 * never reads a PC, starts a sampler, or binds a member identity to an ET peer.
 * Its result is deliberately weaker than a physical-path proof.
 */
export function createEasyTierVoiceUnderlayResolver(
  reading: VoiceLocalNetworkReading | undefined | (() => VoiceLocalNetworkReading | undefined),
): ReceivePathUnderlayResolver {
  return { resolve: path => {
    let current: VoiceLocalNetworkReading | undefined;
    try { current = typeof reading === "function" ? reading() : reading; } catch { current = undefined; }
    return resolvePath(path, usableDetails(current));
  } };
}

function usableDetails(reading: VoiceLocalNetworkReading | undefined): EasyTierLocalNetworkDetails | null {
  if (!reading || reading.reason !== "available" || !reading.details) return null;
  const details = reading.details;
  if (details.source !== "owned-cli-route-list" || details.running !== true || details.serverId !== reading.serverId ||
      details.generation !== reading.generation || !uuid(details.instanceId) || !Number.isSafeInteger(details.localPeerId) ||
      details.localPeerId <= 0 || !Array.isArray(details.routes) || !Array.isArray(details.peers) ||
      !Number.isSafeInteger(details.acquiredAtUnixMs) || details.acquiredAtUnixMs <= 0 ||
      !Number.isFinite(details.maxAgeMs) || details.maxAgeMs <= 0 || details.maxAgeMs > 5000) return null;
  // readVoiceLocalNetwork already checked this acquisition, but the resolver
  // can outlive a render while a peer is still polling. Expiry must fail closed
  // for ET addresses without blocking clearly non-ET public candidates.
  const now = Date.now();
  if (!Number.isSafeInteger(now) || now < details.acquiredAtUnixMs || now - details.acquiredAtUnixMs > details.maxAgeMs) return null;
  return details;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function evidence(path: ReceiveTransportPathEvidence | null | undefined, classification: ReceiveUnderlayClass,
  etDetails?: EasyTierLocalNetworkDetails): ReceiveUnderlayEvidence {
  const pathObservedAtMs = path && Number.isFinite(path.observedAtMs) && path.observedAtMs >= 0 ? path.observedAtMs : 0;
  // ET telemetry is a wall-clock snapshot while the ICE path uses a monotonic
  // clock. Translate only its age into the path's clock so a nearly-expired ET
  // snapshot cannot look freshly observed to the 3-second controller gate. If
  // the age crosses the renderer's monotonic baseline (common after restart),
  // the two clocks cannot be aligned and the ET-dependent result is unknown.
  const age = etDetails === undefined ? null : easyTierAgeMs(etDetails);
  const aligned = age !== null && Number.isFinite(age) && age <= pathObservedAtMs;
  const observedAtMs = etDetails === undefined ? pathObservedAtMs : aligned ? pathObservedAtMs - (age ?? 0) : 0;
  return { source: "host-underlay-resolver", classification: etDetails !== undefined && !aligned ? "unknown" : classification,
    observedAtMs };
}

function easyTierAgeMs(details: EasyTierLocalNetworkDetails): number {
  const now = Date.now();
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(details.acquiredAtUnixMs) || now < details.acquiredAtUnixMs) {
    return Number.POSITIVE_INFINITY;
  }
  return now - details.acquiredAtUnixMs;
}

function resolvePath(path: ReceiveTransportPathEvidence | null | undefined, details: EasyTierLocalNetworkDetails | null): ReceiveUnderlayEvidence {
  // The SDK type excludes null, but the owner can observe a retired/stale
  // object during teardown. Missing path evidence cannot approve a peer path.
  if (!path) return evidence(path, "unknown");
  if (path.classification === "turn-relay") return evidence(path, "not-easytier");
  if (path.classification !== "non-turn-candidate") return evidence(path, "unknown");
  // ICE stats with no transport protocol are not precise enough to bind an
  // address to the ET TUN path. TCP remains valid for ICE; other/missing
  // protocol values fail closed while ordinary public candidates remain a
  // non-ET result when their endpoint evidence is complete.
  if (!candidateProtocol(path.local?.protocol) || !candidateProtocol(path.remote?.protocol)) return evidence(path, "unknown");
  const local = address(path.local?.address), remote = address(path.remote?.address);
  if (!local || !remote) return evidence(path, "unknown");

  const localNonGlobal = nonGlobalAddress(local), remoteNonGlobal = nonGlobalAddress(remote);
  const localVip = details?.virtualIp === local;
  const remoteVip = details?.routes.filter(route => route.virtualIp === remote) ?? [];
  if (details && localVip && remoteVip.length === 1) return evidence(path, routeClass(details, remoteVip[0]), details);
  // With a fresh owned cache, a normal host candidate paired with a public
  // server-reflexive candidate is explicitly another underlay even when the
  // local host address is RFC1918. Requiring both candidates to be globally
  // routable would reject ordinary Internet P2P behind NAT. This is only an
  // exclusion from the currently-owned ET VIP/route set, not VPN proof.
  if (details && !localVip && remoteVip.length === 0 && ordinaryLocalAddress(local, details) && !remoteNonGlobal) {
    // A private local host candidate is only excluded by this fresh ET cache;
    // a public/public pair is independently non-ET from its ICE endpoints.
    return evidence(path, "not-easytier", localNonGlobal ? details : undefined);
  }

  // A current ET cache is required before a non-global address can be called
  // an ET VIP. A public pair is ordinary WebRTC and must remain eligible for
  // the existing peer path even while ET is unavailable.
  if (localNonGlobal || remoteNonGlobal) return evidence(path, "unknown");
  return evidence(path, "not-easytier");
}

function routeClass(details: EasyTierLocalNetworkDetails, route: EasyTierLocalNetworkDetails["routes"][number]): ReceiveUnderlayClass {
  if (details.latencyFirst === null) return "unknown";
  const nextHop = details.latencyFirst ? route.latencyFirstNextHopPeerId : route.nextHopPeerId;
  const cost = details.latencyFirst ? route.latencyFirstCost : route.cost;
  if (route.peerId <= 0 || !Number.isSafeInteger(route.peerId) || nextHop === null || cost === null ||
      !Number.isSafeInteger(nextHop) || !Number.isSafeInteger(cost) || cost < 1) return "unknown";
  // EasyTier 2.7's Route.cost is the graph path length including local and
  // destination nodes (a direct route is normally 2). The hop identity, not
  // cost === 1, distinguishes a destination reached through another peer.
  const peers = details.peers.filter(peer => peer.peerId === nextHop);
  if (peers.length !== 1) return "unknown";
  const peer = peers[0], selected = peer.defaultConnectionId;
  if (!selected) return "unknown";
  const connections = peer.connections.filter(connection => connection.connectionId === selected &&
    connection.closed === false && connection.reportedDirect && ["udp", "tcp", "quic"].includes(connection.tunnelType ?? ""));
  if (connections.length !== 1) return "unknown";
  return nextHop === route.peerId ? "easytier-direct" : "easytier-relay";
}

/** Normalize only literal IPv4/IPv6 addresses; host names never become ET evidence. */
function address(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let text = value.trim().toLowerCase();
  if (!text) return null;
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const zone = text.indexOf("%");
  if (zone >= 0) {
    if (!/^%[a-z0-9_.-]+$/i.test(text.slice(zone))) return null;
    text = text.slice(0, zone);
  }
  const octets = text.split(".");
  if (octets.length === 4 && octets.every(part => /^\d{1,3}$/.test(part))) {
    const values = octets.map(Number); if (values.every(part => part >= 0 && part <= 255)) return values.join(".");
    return null;
  }
  return normalizeIpv6(text);
}

/** True means non-global/special and therefore unsafe to classify without ET evidence. */
function nonGlobalAddress(value: string): boolean {
  const octets = value.split(".").map(Number);
  if (octets.length === 4 && octets.every(Number.isInteger)) {
    const [a, b, c] = octets;
    // RFC1918/6598, link-local, loopback/unspecified, documentation,
    // benchmarking, multicast and reserved address space are not proof of a
    // usable Internet endpoint.
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) || (a === 192 && b === 88 && c === 99) || (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) || a >= 224;
  }
  const groups = value.split(":").map(part => Number.parseInt(part, 16));
  if (groups.length !== 8 || groups.some(part => !Number.isInteger(part))) return true;
  if (groups.slice(0, 5).every(part => part === 0) && groups[5] === 0xffff) {
    const mapped = `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
    return nonGlobalAddress(mapped);
  }
  const first = groups[0];
  // Treat special/non-global IPv6 ranges as ambiguous. A valid global IPv6
  // candidate remains ordinary WebRTC when it cannot match the ET IPv4 VIP set.
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 ||
    groups.every(part => part === 0) || (groups.slice(0, 7).every(part => part === 0) && groups[7] === 1) ||
    (first & 0xff00) === 0xff00 || (groups[0] === 0x2001 && groups[1] === 0x0db8);
}

/** Addresses usable as a normal local ICE host for a public peer. */
function ordinaryLocalAddress(value: string, details: EasyTierLocalNetworkDetails): boolean {
  if (!nonGlobalAddress(value)) return true;
  const octets = value.split(".").map(Number);
  if (octets.length === 4 && octets.every(Number.isInteger)) {
    const [a, b] = octets;
    if (a === 10) {
      // The current community uses a 10/8 ET VIP space. Without an explicit
      // prefix in the CLI snapshot, another 10/8 host is ambiguous (for
      // example an unlisted 10.203.x route) and must remain unknown.
      const vip = details.virtualIp?.split(".").map(Number);
      return Boolean(vip && vip.length === 4 && vip.every(Number.isInteger) && vip[0] !== 10);
    }
    return (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const groups = value.split(":").map(part => Number.parseInt(part, 16));
  return groups.length === 8 && groups.every(part => Number.isInteger(part)) &&
    ((groups[0] & 0xfe00) === 0xfc00 || (groups[0] & 0xffc0) === 0xfe80);
}

function candidateProtocol(value: unknown): value is string {
  return typeof value === "string" && ["udp", "tcp"].includes(value.trim().toLowerCase());
}

/** Return an expanded literal IPv6 address; reject DNS-like colon strings. */
function normalizeIpv6(value: string): string | null {
  let text = value;
  const lastColon = text.lastIndexOf(":");
  if (text.includes(".") && lastColon >= 0) {
    const tail = text.slice(lastColon + 1);
    const ipv4 = tail.split(".");
    if (ipv4.length !== 4 || !ipv4.every(part => /^\d{1,3}$/.test(part))) return null;
    const octets = ipv4.map(Number);
    if (octets.some(part => part > 255)) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }
  if (!text.includes(":")) return null;
  const marker = text.indexOf("::");
  if (marker >= 0 && text.indexOf("::", marker + 2) >= 0) return null;
  const leftText = marker >= 0 ? text.slice(0, marker) : text;
  const rightText = marker >= 0 ? text.slice(marker + 2) : "";
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  const valid = (part: string) => /^[0-9a-f]{1,4}$/i.test(part);
  if (!left.every(valid) || !right.every(valid)) return null;
  if (marker < 0 ? left.length !== 8 : left.length + right.length >= 8) return null;
  const groups = marker < 0 ? left : [...left, ...Array.from({ length: 8 - left.length - right.length }, () => "0"), ...right];
  if (groups.length !== 8) return null;
  return groups.map(part => Number.parseInt(part, 16).toString(16).padStart(4, "0")).join(":");
}
