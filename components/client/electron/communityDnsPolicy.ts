import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { CommunityDnsListener, CommunityDnsRecords, communityDnsZone, parseCommunityDnsDirectory } from './communityDnsResolver';

interface OwnedZone { zone: string; ownershipId: string }
export interface DnsPolicyRequest extends OwnedZone { schemaVersion: 1; operation: 'ensure' | 'remove' }
export interface DnsPolicyResponse { schemaVersion: 1; ok: boolean; code: string }
export interface DnsPolicyPorts {
  enabled(): boolean;
  ledgerPath(): string;
  helperPath(): string;
  monoMs(): number; wallMs(): number;
  invoke?(request: DnsPolicyRequest): Promise<DnsPolicyResponse>;
  listener?: Pick<CommunityDnsListener, 'start' | 'stop'> & Partial<Pick<CommunityDnsListener, 'onFailure'>>;
  records?: CommunityDnsRecords;
}
export function invokeDnsPolicy(helper: string, request: DnsPolicyRequest): Promise<DnsPolicyResponse> {
  return new Promise((resolve, reject) => {
    const child = execFile(helper, ['--dns-policy'], {windowsHide: true, timeout: 4000, maxBuffer: 8192, encoding: 'utf8'}, (error, out) => {
      if (error) { reject(new Error('dns-policy-unavailable')); return; }
      try {
        const value = JSON.parse(out);
        if (value?.schemaVersion !== 1 || typeof value.ok !== 'boolean' || typeof value.code !== 'string' ||
          !/^[a-z-]{1,64}$/.test(value.code) || Object.keys(value).sort().join(',') !== 'code,ok,schemaVersion') throw new Error();
        resolve(value);
      } catch { reject(new Error('dns-policy-invalid-response')); }
    });
    child.stdin?.on('error', () => undefined); child.stdin?.end(JSON.stringify(request) + '\n');
  });
}

/** Optional main-owned DNS lifecycle. Failures remove names, never stop community ET. */
export class CommunityDnsPolicy {
  private records: CommunityDnsRecords;
  private listener: Pick<CommunityDnsListener, 'start' | 'stop'> & Partial<Pick<CommunityDnsListener, 'onFailure'>>;
  private queue: Promise<void> = Promise.resolve();
  private epochs = new Map<string, number>();
  private ready = new Map<string, string>();
  private pendingScopes = new Map<string, string>();
  private owned: OwnedZone[] | null = null;
  private initialized = false;
  private listening = false;
  private closed = false;
  constructor(private ports: DnsPolicyPorts) {
    this.records = ports.records ?? new CommunityDnsRecords(ports.monoMs, ports.wallMs);
    this.listener = ports.listener ?? new CommunityDnsListener(this.records);
    this.listener.onFailure?.(() => {
      for (const [scope, epoch] of this.epochs) this.epochs.set(scope, epoch + 1);
      this.records.clearAll(); this.ready.clear(); this.pendingScopes.clear(); this.listening = false;
      void this.enqueue(async () => {
        // The listener closes its failed generation itself. Calling stop() a
        // second time here could erase a fresh publication waiting to restart.
        for (const row of [...this.load()]) if (!this.referenced(row.zone)) await this.remove(row.zone);
      }).catch(() => undefined);
    });
  }
  private load(): OwnedZone[] {
    if (this.owned) return this.owned;
    const path = this.ports.ledgerPath();
    if (!existsSync(path)) return this.owned = [];
    const content = readFileSync(path, 'utf8'); if (content.length > 16_384) throw new Error('dns-ledger-invalid');
    const data = JSON.parse(content);
    if (data?.schemaVersion !== 1 || Object.keys(data).sort().join(',') !== 'schemaVersion,zones' || !Array.isArray(data.zones) || data.zones.length > 16)
      throw new Error('dns-ledger-invalid');
    const unique = new Set();
    for (const row of data.zones) {
      if (!row || Object.keys(row).sort().join(',') !== 'ownershipId,zone' || !communityDnsZone(row.zone) ||
        !/^[0-9a-f]{32}$/.test(row.ownershipId) || unique.has(row.zone)) throw new Error('dns-ledger-invalid');
      unique.add(row.zone);
    }
    return this.owned = data.zones;
  }
  private persist(rows: OwnedZone[]): void {
    const path = this.ports.ledgerPath(); mkdirSync(dirname(path), {recursive: true});
    const temp = path + '.next-' + randomBytes(8).toString('hex');
    writeFileSync(temp, JSON.stringify({schemaVersion: 1, zones: rows}), {encoding: 'utf8', flag: 'wx', mode: 0o600});
    renameSync(temp, path); this.owned = rows;
  }
  private call(operation: 'ensure' | 'remove', row: OwnedZone): Promise<DnsPolicyResponse> {
    const request: DnsPolicyRequest = {schemaVersion: 1, operation, ...row};
    return this.ports.invoke ? this.ports.invoke(request) : invokeDnsPolicy(this.ports.helperPath(), request);
  }
  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work); this.queue = next.catch(() => undefined); return next;
  }
  private referenced(zone: string): boolean {
    return [...this.ready.values(), ...this.pendingScopes.values()].includes(zone);
  }
  private async remove(zone: string): Promise<void> {
    const row = this.load().find(value => value.zone === zone); if (!row) return;
    const result = await this.call('remove', row);
    if (!result.ok) throw new Error('dns-policy-cleanup-failed');
    this.persist(this.load().filter(value => value.zone !== zone));
  }
  /** Before any new policy, retire previous crash intents without adopting other rules. */
  private async initialize(): Promise<void> {
    if (this.initialized) return;
    for (const row of [...this.load()]) await this.remove(row.zone);
    this.initialized = true;
  }
  recover(): Promise<void> {
    if (!this.ports.enabled() || this.closed) return Promise.resolve();
    return this.enqueue(() => this.initialize());
  }
  publish(scope: string, raw: unknown, requestMono: number, requestWall: number): void {
    if (!this.ports.enabled() || this.closed) return;
    const epoch = (this.epochs.get(scope) ?? 0) + 1; this.epochs.set(scope, epoch);
    let zone: string;
    try {
      const parsed = parseCommunityDnsDirectory(raw, scope);
      zone = this.records.replace(parsed, scope, requestMono, requestWall);
    } catch { this.clear(scope); return; }
    this.pendingScopes.set(scope, zone);
    if (this.ready.get(scope) === zone) return;
    void this.enqueue(async () => {
      const current = () => !this.closed && this.ports.enabled() && this.epochs.get(scope) === epoch;
      if (!current()) return;
      await this.initialize();
      if (!current()) return;
      if (!this.listening) { await this.listener.start(); this.listening = true; }
      if (!current()) return;
      const previous = this.ready.get(scope);
      if (previous && previous !== zone) { this.ready.delete(scope); await this.remove(previous); }
      // A prior migration may have lost readiness after unconfirmed cleanup.
      // Retry that durable intent before applying another orphaned zone.
      for (const row of [...this.load()]) if (row.zone !== zone && !this.referenced(row.zone)) await this.remove(row.zone);
      let owned = this.load().find(row => row.zone === zone);
      if (!owned) {
        if (this.load().length >= 16) throw new Error('dns-zone-limit');
        owned = {zone, ownershipId: randomBytes(16).toString('hex')};
        this.persist([...this.load(), owned]); // Persist intent before any WMI write.
      }
      const result = await this.call('ensure', owned);
      if (!result.ok) throw new Error('dns-policy-unavailable');
      if (!current()) { if (!this.referenced(zone)) await this.remove(zone); return; }
      this.ready.set(scope, zone);
    }).catch(() => {
      // An older operation must not erase a newer publication or its reused rule.
      if (this.epochs.get(scope) === epoch) this.clear(scope);
      else void this.enqueue(async () => { if (!this.referenced(zone)) await this.remove(zone); }).catch(() => undefined);
    });
  }
  isReady(scope: string): boolean {
    const zone = this.ready.get(scope);
    return !this.closed && this.ports.enabled() && this.listening && !!zone && this.records.hasFreshZone(scope, zone);
  }
  clear(scope: string): void {
    this.epochs.set(scope, (this.epochs.get(scope) ?? 0) + 1); this.records.clear(scope);
    const zone = this.ready.get(scope) ?? this.pendingScopes.get(scope);
    this.ready.delete(scope); this.pendingScopes.delete(scope);
    if (zone) void this.enqueue(async () => { if (!this.referenced(zone)) await this.remove(zone); }).catch(() => undefined);
  }
  async stop(): Promise<void> {
    this.closed = true; this.records.clearAll(); this.ready.clear(); this.pendingScopes.clear();
    await this.enqueue(async () => {
      let failure = false;
      try {
        // A disabled isolation run must not adopt an old production ledger;
        // an already active policy must still clean up if its flag changes.
        if (this.ports.enabled() || this.initialized || this.owned !== null || this.listening)
          for (const row of [...this.load()]) { try { await this.remove(row.zone); } catch { failure = true; } }
      } catch { failure = true; }
      finally { try { await this.listener.stop(); } catch { failure = true; } this.listening = false; }
      if (failure) throw new Error('dns-policy-cleanup-failed');
    });
  }
  /** Await bounded helper work during tests or the existing quit drain. */
  async settled(): Promise<void> {
    for (;;) { const queue = this.queue; await queue; if (queue === this.queue) return; }
  }
}
