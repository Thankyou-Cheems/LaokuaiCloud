/** Portable preferences only. Membership and native runtime identities never belong here. */
export interface CommunityNetworkPreferences {
  schemaVersion: 1;
  magicDns: boolean;
  latencyFirst: boolean;
  ipv6: boolean;
  upnp: boolean;
  udpHolePunching: boolean;
  tcpHolePunching: boolean;
  udpBroadcast: boolean;
}

export const DEFAULT_COMMUNITY_NETWORK_PREFERENCES: Readonly<CommunityNetworkPreferences> = Object.freeze({
  schemaVersion: 1, magicDns: true, latencyFirst: false, ipv6: true, upnp: true,
  udpHolePunching: true, tcpHolePunching: true, udpBroadcast: false,
});

export const COMMUNITY_NETWORK_BOOLEAN_KEYS = ["magicDns", "latencyFirst", "ipv6", "upnp", "udpHolePunching", "tcpHolePunching", "udpBroadcast"] as const;
export type CommunityNetworkBooleanKey = typeof COMMUNITY_NETWORK_BOOLEAN_KEYS[number];
const MAX_IMPORT_BYTES = 8192;

/** Accept exactly schema v1; unknown fields and partial settings are rejected. */
export function parseCommunityNetworkPreferences(value: unknown): CommunityNetworkPreferences {
  if (typeof value === "string") {
    if (value.length > MAX_IMPORT_BYTES || new TextEncoder().encode(value).byteLength > MAX_IMPORT_BYTES) throw Error("network-preferences-invalid");
    try { value = JSON.parse(value); } catch { throw Error("network-preferences-invalid"); }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("network-preferences-invalid");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw Error("network-preferences-invalid");
  const fields = value as Record<string, unknown>;
  const descriptors = Object.getOwnPropertyDescriptors(fields);
  const keys = Reflect.ownKeys(fields);
  if (keys.length !== COMMUNITY_NETWORK_BOOLEAN_KEYS.length + 1 || keys.some(key => typeof key !== "string" ||
    (key !== "schemaVersion" && !COMMUNITY_NETWORK_BOOLEAN_KEYS.includes(key as CommunityNetworkBooleanKey)) ||
    !Object.prototype.hasOwnProperty.call(descriptors[key], "value") || !descriptors[key].enumerable) ||
    fields.schemaVersion !== 1 || COMMUNITY_NETWORK_BOOLEAN_KEYS.some(key => typeof fields[key] !== "boolean")) throw Error("network-preferences-invalid");
  return { schemaVersion: 1, magicDns: fields.magicDns as boolean, latencyFirst: fields.latencyFirst as boolean,
    ipv6: fields.ipv6 as boolean, upnp: fields.upnp as boolean, udpHolePunching: fields.udpHolePunching as boolean,
    tcpHolePunching: fields.tcpHolePunching as boolean, udpBroadcast: fields.udpBroadcast as boolean };
}

export function exportCommunityNetworkPreferences(value: unknown): string {
  return JSON.stringify(parseCommunityNetworkPreferences(value), null, 2) + "\n";
}

export function communityNetworkPreferenceChanges(current: CommunityNetworkPreferences, next: CommunityNetworkPreferences): CommunityNetworkBooleanKey[] {
  const before = parseCommunityNetworkPreferences(current), after = parseCommunityNetworkPreferences(next);
  return COMMUNITY_NETWORK_BOOLEAN_KEYS.filter(key => before[key] !== after[key]);
}
