/** Local statistics only. This module never reads audio or applies a DSP gain. */
export const RECEIVE_PRIOR_CACHE_SCHEMA = "gryt-receive-level-v2" as const;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const STORAGE_KEY = "gryt.receive-priors.v1";

export interface StoredReceivePrior {
  schemaVersion: 1;
  processorSchema: typeof RECEIVE_PRIOR_CACHE_SCHEMA;
  learnedGainDb: number;
  speechLevelDbfs: number;
  effectiveSpeechSeconds: number;
  lastVerifiedUnixMs: number;
}
export interface ReceivePriorScope {
  accountId: string;
  serverInstanceId: string;
  remoteUserId: string;
}
export interface PriorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface PriorPersistenceOptions {
  /** Zero preserves immediate writes; product use coalesces within a fixed bounded window. */
  delayMs?: number;
  /** Persistence is optional; never let an observer failure interrupt audio. */
  onFailure?: () => void;
}
export interface PriorLease {
  readonly key: string;
  readonly epoch: number;
}
interface Row { scope: ReceivePriorScope; prior: StoredReceivePrior; lastAccessUnixMs: number }

function validScope(value: unknown): value is ReceivePriorScope {
  if (!value || typeof value !== "object") return false;
  const scope = value as ReceivePriorScope;
  return [scope.accountId, scope.serverInstanceId, scope.remoteUserId].every(id => typeof id === "string" && id.length > 0 && id.length <= 512);
}
export function decodeReceivePrior(value: unknown, now: number): StoredReceivePrior | undefined {
  if (!value || typeof value !== "object") return undefined;
  const p = value as StoredReceivePrior;
  if (p.schemaVersion !== 1 || p.processorSchema !== RECEIVE_PRIOR_CACHE_SCHEMA ||
      ![p.learnedGainDb, p.speechLevelDbfs, p.effectiveSpeechSeconds, p.lastVerifiedUnixMs].every(Number.isFinite) ||
      p.learnedGainDb < -12 || p.learnedGainDb > 18 || p.speechLevelDbfs < -84 || p.speechLevelDbfs > 24 ||
      p.effectiveSpeechSeconds < 5 || p.effectiveSpeechSeconds > 1e9 || p.lastVerifiedUnixMs > now ||
      !Number.isSafeInteger(p.lastVerifiedUnixMs) || p.lastVerifiedUnixMs <= 0 || now - p.lastVerifiedUnixMs >= TTL_MS) return undefined;
  return { schemaVersion: 1, processorSchema: RECEIVE_PRIOR_CACHE_SCHEMA, learnedGainDb: p.learnedGainDb,
    speechLevelDbfs: p.speechLevelDbfs, effectiveSpeechSeconds: p.effectiveSpeechSeconds, lastVerifiedUnixMs: p.lastVerifiedUnixMs };
}
function keyOf(scope: ReceivePriorScope): string {
  return JSON.stringify([scope.accountId, scope.serverInstanceId, scope.remoteUserId, RECEIVE_PRIOR_CACHE_SCHEMA]);
}

/** A lease invalidates delayed work after account switch or either clear action. */
export class ReceivePriorCache {
  private rows = new Map<string, Row>();
  private account: string | null = null;
  private epoch = 0;
  private storageHealthy = true;
  private dirty = false;
  private pendingWrite?: ReturnType<typeof setTimeout>;
  private readonly delayMs: number;
  constructor(private storage: PriorStorage | undefined, private now: () => number = Date.now,
    private options: PriorPersistenceOptions = {}) {
    this.delayMs = Number.isFinite(options.delayMs) ? Math.max(0, Math.min(1000, options.delayMs!)) : 0;
    let raw: string | null | undefined;
    try { raw = storage?.getItem(STORAGE_KEY); }
    catch { this.storageHealthy = false; return; }
    if (!raw || raw.length > 1_000_000) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || (parsed as { v?: number }).v !== 1 || !Array.isArray((parsed as { rows?: unknown }).rows)) return;
      for (const entry of (parsed as { rows: unknown[] }).rows.slice(0, MAX_ENTRIES)) {
        if (!entry || typeof entry !== "object") continue;
        const row = entry as Row;
        const prior = decodeReceivePrior(row.prior, now());
        if (validScope(row.scope) && prior && Number.isFinite(row.lastAccessUnixMs)) {
          this.rows.set(keyOf(row.scope), { scope: { ...row.scope }, prior, lastAccessUnixMs: Math.min(row.lastAccessUnixMs, now()) });
        }
      }
    } catch { this.rows.clear(); }
  }
  get available(): boolean { return this.storageHealthy && !!this.storage; }
  setAccount(accountId: string | null): void {
    if (this.account === accountId) return;
    this.flush();
    this.account = accountId; this.epoch++;
  }
  begin(scope: ReceivePriorScope): PriorLease | undefined {
    return validScope(scope) && scope.accountId === this.account ? { key: keyOf(scope), epoch: this.epoch } : undefined;
  }
  get(scope: ReceivePriorScope): StoredReceivePrior | undefined {
    if (!this.available || scope.accountId !== this.account) return undefined;
    const key = keyOf(scope); const row = this.rows.get(key);
    if (!row) return undefined;
    const prior = decodeReceivePrior(row.prior, this.now());
    if (!prior) { this.rows.delete(key); return undefined; }
    row.lastAccessUnixMs = this.now();
    return { ...prior };
  }
  save(scope: ReceivePriorScope, prior: StoredReceivePrior, lease: PriorLease): boolean {
    if (!this.available || !validScope(scope) || scope.accountId !== this.account || lease.epoch !== this.epoch || lease.key !== keyOf(scope)) return false;
    const clean = decodeReceivePrior(prior, this.now());
    if (!clean) return false;
    // The bridge supplies an SDK export only after actual accepted speech advances.
    this.rows.set(keyOf(scope), { scope: { ...scope }, prior: clean, lastAccessUnixMs: this.now() });
    if (this.rows.size > MAX_ENTRIES) this.prune(); return this.queuePersist();
  }
  clear(scope: ReceivePriorScope): void {
    if (scope.accountId !== this.account) return;
    this.epoch++; this.rows.delete(keyOf(scope)); this.dirty = true; this.flush();
  }
  clearAccount(): void {
    this.epoch++;
    for (const [key, row] of this.rows) if (row.scope.accountId === this.account) this.rows.delete(key);
    this.dirty = true; this.flush();
  }
  count(): number {
    this.prune();
    return [...this.rows.values()].filter(row => row.scope.accountId === this.account).length;
  }
  /** Flush pending current rows, including on leave/hidden/pagehide. No-op when clean. */
  flush(): boolean {
    if (this.pendingWrite !== undefined) clearTimeout(this.pendingWrite);
    this.pendingWrite = undefined;
    if (!this.dirty) return this.available;
    this.dirty = false;
    if (!this.available) return false;
    this.prune();
    return this.persist();
  }
  private queuePersist(): boolean {
    this.dirty = true;
    if (this.delayMs === 0) return this.flush();
    // Schedule once from the first dirty row. Later speech must not postpone it.
    if (this.pendingWrite === undefined) {
      try { this.pendingWrite = setTimeout(() => { this.pendingWrite = undefined; this.flush(); }, this.delayMs); }
      catch { return this.flush(); }
    }
    // Accepted in memory; the bounded write window is deliberately not a durability receipt.
    return true;
  }
  private prune(): void {
    for (const [key, row] of this.rows) if (!decodeReceivePrior(row.prior, this.now())) this.rows.delete(key);
    this.evictOverflow();
  }
  private evictOverflow(): void {
    while (this.rows.size > MAX_ENTRIES) {
      let oldestKey: string | undefined; let oldestTime = Infinity;
      for (const [key, row] of this.rows) if (oldestKey === undefined || row.lastAccessUnixMs < oldestTime) {
        oldestKey = key; oldestTime = row.lastAccessUnixMs;
      }
      if (oldestKey === undefined) break;
      this.rows.delete(oldestKey);
    }
  }
  private persist(): boolean {
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify({ v: 1, rows: [...this.rows.values()] })); return this.available; }
    catch {
      this.storageHealthy = false; this.rows.clear(); this.epoch++;
      try { this.options.onFailure?.(); } catch { /* Cache observers cannot interrupt audio. */ }
      return false;
    }
  }
}
