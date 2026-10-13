import {appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync} from "node:fs";
import {join} from "node:path";

import {type LocalDiagnostic,safeDiagnostic} from "../src/lib/localDiagnostics";

/** Local only, maximum 2 MiB x 3. Repeated records aggregate before disk I/O. */
export class LocalDiagnosticWriter {
  private pending = new Map<string, {event: LocalDiagnostic; count: number; firstMs: number; lastMs: number}>();
  private timer: ReturnType<typeof setInterval>;
  constructor(private directory: string, private maxBytes = 2 * 1024 * 1024) {
    this.timer = setInterval(() => this.flush(), 1000); this.timer.unref();
  }
  record(value: unknown): void {
    const event = safeDiagnostic(value); if (!event) return;
    // Countdown numbers are observations, not distinct messages.
    const key = JSON.stringify([event.phase, event.operation, event.action, event.code, event.hostSlot, event.cleanup,
      event.generation, event.httpStatus, event.scopeGeneration, event.routeOrdinal, event.routeGeneration,
      event.selectionRevision, event.status, event.selected, event.reason, event.forwardingPaused,
      event.connected, event.rosterReady, event.epochReady, event.pathClass, event.pathReason,
      event.localCandidateType, event.remoteCandidateType, event.underlayClass, event.decodeProof,
      event.decodeReason, event.failureReason, event.forwardingAction, event.result]);
    const old = this.pending.get(key), now = Date.now();
    if (old) {old.event = event; old.count = Math.min(old.count + 1, 1_000_000); old.lastMs = now;}
    else if (this.pending.size < 256) this.pending.set(key, {event, count: 1, firstMs: now, lastMs: now});
  }
  flush(): void {
    const batch = [...this.pending.values()]; this.pending.clear(); if (!batch.length) return;
    try {
      mkdirSync(this.directory, {recursive: true, mode: 0o700});
      const file = join(this.directory, "events.jsonl");
      for (const item of batch) {
        const line = JSON.stringify({v: 1, ...item}) + "\n";
        if (existsSync(file) && statSync(file).size + Buffer.byteLength(line) > this.maxBytes) {
          const first = join(this.directory, "events.1.jsonl"), second = join(this.directory, "events.2.jsonl");
          if (existsSync(second)) rmSync(second);
          if (existsSync(first)) renameSync(first, second);
          renameSync(file, first);
        }
        appendFileSync(file, line, {mode: 0o600});
      }
    } catch { /* Diagnostics cannot change auth, media or retry behavior. */ }
  }
  close(): void {clearInterval(this.timer); this.flush();}
}
