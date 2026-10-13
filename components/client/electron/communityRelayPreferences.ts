import type { StoredRelayPreference } from '../src/lib/communityRelay';
import { validRelayBudget } from '../src/lib/communityRelay';

function plainData(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(raw)) &&
    Reflect.ownKeys(raw).every(key => typeof key === 'string' && Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(raw, key)!, 'value'));
}
/** Private, device/account scoped consent; deliberately absent from configuration export. */
export class CommunityRelayPreferences {
  constructor(private readStore: () => unknown, private writeStore: (value: Record<string, StoredRelayPreference>) => void) {}
  private readAll(): Record<string, StoredRelayPreference> {
    const raw = this.readStore();
    if (!plainData(raw) || Object.keys(raw).length > 64) return {};
    const out: Record<string, StoredRelayPreference> = {};
    for (const [key, row] of Object.entries(raw)) {
      if (!/^[a-f0-9]{64}$/.test(key) || !plainData(row) || Object.keys(row).sort().join(',') !== 'bytesPerSecond,enabled' ||
        typeof row.enabled !== 'boolean' || (row.enabled ? !validRelayBudget(row.bytesPerSecond) : row.bytesPerSecond !== 0)) continue;
      out[key] = {enabled: row.enabled, bytesPerSecond: row.bytesPerSecond as number};
    }
    return out;
  }
  read(key: string): StoredRelayPreference | null { return this.readAll()[key] ?? null; }
  write(key: string, value: StoredRelayPreference): void {
    if (!/^[a-f0-9]{64}$/.test(key) || typeof value.enabled !== 'boolean' ||
      (value.enabled ? !validRelayBudget(value.bytesPerSecond) : value.bytesPerSecond !== 0)) throw Error('invalid-member-relay');
    const all = this.readAll();
    if (!all[key] && Object.keys(all).length >= 64) throw Error('member-relay-preference-limit');
    all[key] = {enabled: value.enabled, bytesPerSecond: value.bytesPerSecond}; this.writeStore(all);
  }
}
