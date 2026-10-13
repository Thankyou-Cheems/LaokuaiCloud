export interface StoredRelayPreference { enabled: boolean; bytesPerSecond: number }
export interface RelayPreferenceV1 extends StoredRelayPreference { v: 1; serverId: string }
export type CommunityRelayStatus = 'off' | 'waiting' | 'active' | 'suspended' | 'unavailable';
export type CommunityRelayReason = null | 'not-connected' | 'telemetry-stale' | 'backend-unavailable' | 'native-unsupported' |
  'grant-mismatch' | 'consent-conflict' | 'native-unconfirmed';
export interface CommunityRelayState {
  v: 1; serverId: string; desiredEnabled: boolean; desiredBytesPerSecond: number;
  status: CommunityRelayStatus; reason: CommunityRelayReason; confirmedEnabled: boolean;
  localBudgetApplied: boolean; bytesPerSecond: number;
  /** Local Unix milliseconds for display only; native authorization uses Instant. */
  leaseExpiresAtMs: number | null;
}
export const DEFAULT_MEMBER_RELAY_BYTES_PER_SECOND = 32_000;
export const validRelayBudget = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1024 && Number(value) <= 1_048_576;
const scopeId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256 &&
  Array.from(v).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
function exact(raw: unknown, keys: string[]): asserts raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) || Reflect.ownKeys(raw).length !== keys.length ||
    keys.some(key => !Object.prototype.hasOwnProperty.call(raw, key) || !Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(raw, key)!, 'value')))
    throw Error('invalid-member-relay');
}
export function parseRelayPreference(raw: unknown): RelayPreferenceV1 {
  exact(raw, ['v', 'serverId', 'enabled', 'bytesPerSecond']);
  if (raw.v !== 1 || !scopeId(raw.serverId) || typeof raw.enabled !== 'boolean' ||
      (raw.enabled ? !validRelayBudget(raw.bytesPerSecond) : raw.bytesPerSecond !== 0)) throw Error('invalid-member-relay');
  return {v: 1, serverId: raw.serverId, enabled: raw.enabled, bytesPerSecond: raw.bytesPerSecond as number};
}
export function parseCommunityRelayState(raw: unknown, serverId: string): CommunityRelayState {
  exact(raw, ['v', 'serverId', 'desiredEnabled', 'desiredBytesPerSecond', 'status', 'reason', 'confirmedEnabled',
    'localBudgetApplied', 'bytesPerSecond', 'leaseExpiresAtMs']);
  if (raw.v !== 1 || !scopeId(raw.serverId) || raw.serverId !== serverId || typeof raw.desiredEnabled !== 'boolean' ||
    (raw.desiredEnabled ? !validRelayBudget(raw.desiredBytesPerSecond) : raw.desiredBytesPerSecond !== 0) ||
    typeof raw.confirmedEnabled !== 'boolean' || typeof raw.localBudgetApplied !== 'boolean' ||
    !['off', 'waiting', 'active', 'suspended', 'unavailable'].includes(String(raw.status)) ||
    ![null, 'not-connected', 'telemetry-stale', 'backend-unavailable', 'native-unsupported', 'grant-mismatch', 'consent-conflict', 'native-unconfirmed'].includes(raw.reason as CommunityRelayReason)) throw Error('invalid-member-relay');
  const active = raw.status === 'active';
  if (active ? (!raw.desiredEnabled || !raw.confirmedEnabled || !raw.localBudgetApplied || !validRelayBudget(raw.bytesPerSecond) ||
      Number(raw.bytesPerSecond) > Number(raw.desiredBytesPerSecond) || !Number.isSafeInteger(raw.leaseExpiresAtMs) || Number(raw.leaseExpiresAtMs) <= 0) :
    (raw.bytesPerSecond !== 0 || raw.leaseExpiresAtMs !== null || raw.localBudgetApplied !== false)) throw Error('invalid-member-relay');
  return {...raw} as unknown as CommunityRelayState;
}
