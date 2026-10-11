import type { ReceivePathBinding, ReceivePathObserverOptions, ReceivePathRow, ReceivePathScope,
  ReceivePathSnapshot, ReceiveSourceSelection, ReceiveTrackObservation } from "../types/ReceivePath";
import { cachedReceiveStats, readReceiveStats, receiveConnectionEpoch, ReceiveTrackStats } from "./receivePathStats";

interface Descriptor { binding: ReceivePathBinding; selection: ReceiveSourceSelection; sourceId: string; key: string; invalid: string | null }
interface Watch { marker: ReceivePathBinding["source"]["receivePath"]; track: MediaStreamTrack | null; cleanups: (() => void)[] }
const defaultClock = { now: () => performance.now(), schedule: (f: () => void, ms: number) => setTimeout(f, ms),
  cancel: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 512;
/** Local read-only UI observation. No authority requests, capture, media selection or peer construction. */
export class ReceivePathObserver {
  private clock;
  private version = 0;
  private fingerprint = "";
  private disposed = false;
  private listeners = new Map<object, { listener(snapshot: ReceivePathSnapshot): void; details: boolean }>();
  private watchers = new Map<ReceivePathBinding["source"], Watch>();
  private ids = new WeakMap<object, number>();
  private nextId = 0;
  private parsers = new Map<string, ReceiveTrackStats>();
  private observations = new Map<string, ReceiveTrackObservation>();
  private receiveEpochs = new Map<string, number>();
  private boundAt = new Map<string, number>();
  private nextReceiveEpoch = 0;
  private flight?: Promise<void>;
  private timer?: unknown;
  private sampledAt: number | null = null;
  private lastSampleStartedAt = -Infinity;
  constructor(private readonly options: ReceivePathObserverOptions) { this.clock = options.clock ?? defaultClock; }
  private id(object: object): number { let id = this.ids.get(object); if (!id) { id = ++this.nextId; this.ids.set(object, id); } return id; }
  private context(): { pc: RTCPeerConnection | null; epoch: number | null; scope: ReceivePathScope | null; rows: Descriptor[] } {
    if (this.disposed) return { pc: null, epoch: null, scope: null, rows: [] };
    let sfu, scope, bindings;
    try { sfu = this.options.getSfu(); scope = this.options.getScope(); bindings = this.options.getBindings(); }
    catch { return { pc: null, epoch: null, scope: null, rows: [] }; }
    const pc = sfu.getPeerConnection?.() ?? null, epoch = sfu.getConnectionEpoch?.() ?? receiveConnectionEpoch(pc);
    if (!scope || scope.source !== "host-authenticated-connection" || ![scope.bindingId, scope.serverId, scope.roomId, scope.localSessionId].every(text) ||
      scope.canReceive !== true || !sfu.isConnected || !pc || pc.connectionState !== "connected" ||
      sfu.currentServerConnected !== scope.serverId || sfu.currentChannelConnected !== scope.roomId || bindings.length > 128) return { pc, epoch, scope: null, rows: [] };
    const sources = new Set(Object.values(sfu.streamSources)), groups = new Map<ReceivePathBinding["source"], ReceivePathBinding[]>();
    for (const b of bindings) { const group = groups.get(b.source) ?? []; group.push(b); groups.set(b.source, group); }
    const rows: Descriptor[] = [], seen = new Set<string>();
    for (const b of bindings) {
      if (b.role !== "microphone" || ![b.participantId, b.publicationId].every(text) || b.sessionId !== null && !text(b.sessionId)) continue;
      const sourceId = `receive-source-${this.id(b.source)}`, group = groups.get(b.source)!;
      const identity = JSON.stringify([b.participantId, b.sessionId, b.publicationId, sourceId]); if (seen.has(identity)) continue; seen.add(identity);
      let invalid: string | null = null, selection: ReceiveSourceSelection;
      if (group.some(alias => alias.role !== "microphone" || alias.participantId !== b.participantId || alias.sessionId !== b.sessionId || alias.publicationId !== b.publicationId)) invalid = "publication_alias_conflict";
      if (bindings.some(other => other.source !== b.source && other.publicationId === b.publicationId)) invalid = "publication_source_conflict";
      if (bindings.some(other => other.source !== b.source && other.role === "microphone" && other.participantId === b.participantId)) invalid = "participant_source_conflict";
      if (!sources.has(b.source) || b.source.receiveCleanup?.isCurrent?.() !== true) invalid = "source_binding_retired";
      const marker = b.source.receivePath;
      if (marker) {
        try { selection = marker.getSelection(); }
        catch { selection = { current: false, kind: "none", track: null, revision: -1, routeGeneration: null,
          status: "unavailable", reason: "selection_unavailable", hybridScope: null, remoteIdentity: null }; }
      }
      else {
        const stream = "mediaStream" in b.source.stream ? b.source.stream.mediaStream : null, tracks = stream?.getTracks() ?? [];
        const track = tracks.length === 1 && tracks[0].kind === "audio" ? tracks[0] : null;
        selection = { current: !!track && track.readyState === "live", kind: "sfu", track, revision: 0,
          routeGeneration: null, status: "sfu", reason: null, hybridScope: null, remoteIdentity: null };
      }
      if (!selection.current) invalid ??= "source_binding_retired";
      const hybrid = selection.hybridScope;
      if (hybrid && (hybrid.roomId !== scope.roomId || hybrid.localSessionId !== scope.localSessionId || !hybrid.canReceive)) invalid = "hybrid_scope_conflict";
      const remote = selection.remoteIdentity;
      if (remote && (remote.participantId !== b.participantId || remote.sessionId !== b.sessionId || remote.publicationId !== b.publicationId)) invalid = "hybrid_publication_conflict";
      if (selection.kind === "p2p" && (!hybrid || !remote)) invalid ??= "hybrid_publication_unverified";
      const key = JSON.stringify([scope, epoch, identity, selection.kind, selection.revision,
        selection.routeGeneration, selection.track ? this.id(selection.track) : null, hybrid]);
      rows.push({ binding: b, selection, sourceId, key, invalid });
    }
    return { pc, epoch, scope: { ...scope }, rows };
  }
  private sync(): ReturnType<ReceivePathObserver["context"]> {
    const context = this.context(), fingerprint = JSON.stringify([context.epoch, context.scope, context.rows.map(row => [row.key, row.invalid])]);
    if (fingerprint !== this.fingerprint) {
      this.fingerprint = fingerprint; ++this.version;
      const keys = new Set(context.rows.filter(r => !r.invalid).map(r => r.key));
      for (const key of this.receiveEpochs.keys()) if (!keys.has(key)) { this.receiveEpochs.delete(key); this.boundAt.delete(key); }
      for (const key of context.rows.map(r => r.key)) if (!this.receiveEpochs.has(key)) {
        this.receiveEpochs.set(key, ++this.nextReceiveEpoch); this.boundAt.set(key, this.clock.now());
      }
      for (const key of this.parsers.keys()) if (!keys.has(key)) this.parsers.delete(key);
      for (const key of this.observations.keys()) if (!keys.has(key)) this.observations.delete(key);
      this.sampledAt = null;
    }
    if (this.listeners.size) this.watch(context.rows); return context;
  }
  private watch(rows: Descriptor[]): void {
    const sources = new Set(rows.map(r => r.binding.source));
    for (const [source, watch] of this.watchers) if (!sources.has(source)) { for (const cleanup of watch.cleanups) cleanup(); this.watchers.delete(source); }
    for (const row of rows) {
      const source = row.binding.source, marker = source.receivePath, track = row.selection.track, prior = this.watchers.get(source);
      if (prior?.marker === marker && prior?.track === track) continue;
      for (const cleanup of prior?.cleanups ?? []) cleanup();
      const cleanups: (() => void)[] = [], changed = () => this.update();
      if (marker) cleanups.push(marker.subscribe(changed));
      const retirement = source.receiveCleanup?.subscribeRetirement?.(changed); if (retirement) cleanups.push(retirement);
      track?.addEventListener?.("ended", changed); cleanups.push(() => track?.removeEventListener?.("ended", changed));
      this.watchers.set(source, { marker, track, cleanups });
    }
  }
  getSnapshot(options: { details?: boolean } = {}): ReceivePathSnapshot {
    const context = this.sync(), now = this.clock.now();
    const rows: ReceivePathRow[] = context.rows.map(row => {
      const s = row.selection;
      let observation: ReceiveTrackObservation | null = null;
      try { observation = s.kind === "p2p" ? row.binding.source.receivePath?.getObservation() ?? null : this.observations.get(row.key) ?? null; } catch {}
      const age = observation ? now - observation.observedAtMs : Infinity;
      const valid = !row.invalid && s.current && s.track?.readyState === "live" && observation?.trackId === s.track.id && age >= 0 && age <= 3000;
      const windowCurrent = !observation?.decode || observation.decode.startAtMs >= (this.boundAt.get(row.key) ?? now);
      const usable = valid && windowCurrent;
      const fresh = usable && observation?.decode?.fresh === true;
      return { participantId: row.binding.participantId, remoteSessionId: row.binding.sessionId, publicationId: row.binding.publicationId,
        sourceId: row.sourceId, trackId: row.invalid ? null : s.track?.id ?? null, selectionRevision: s.revision, routeGeneration: s.routeGeneration,
        selectionEpoch: this.receiveEpochs.get(row.key)!, receiveGeneration: this.receiveEpochs.get(row.key)!,
        selected: row.invalid ? null : s.kind, selectionSource: row.binding.source.receivePath ? "sdk-hybrid-selected-edge" : "sdk-sfu-source",
        status: s.status, availability: fresh ? "fresh" : "unavailable", reason: row.invalid ?? s.reason ??
          (valid && !windowCurrent ? "selection_window_pending" : usable ? observation?.reason ?? null : observation ? "stats_stale" : s.kind === "none" ? "no_selected_input" : "measurement_unavailable"),
        observedAtMs: usable ? observation?.observedAtMs ?? null : null, decode: usable ? structuredClone(observation?.decode ?? null) : null,
        metrics: options.details && usable ? structuredClone(observation?.metrics ?? null) : null,
        metricLeg: row.invalid ? null : s.kind === "sfu" ? "sfu-to-local" : s.kind === "p2p" ? "peer-to-local" : null,
        hybridScope: s.hybridScope ? { ...s.hybridScope } : null, physicalPath: "unverified", sentToRemote: null };
    });
    return { connectionEpoch: context.epoch, scope: context.scope, sampledAtMs: this.sampledAt, readAtMs: now,
      clockDomain: this.options.clock ? "injected-local" : "performance.now", rows };
  }
  /** Borrowed identity check for a local translator; the observer never takes lifecycle ownership. */
  getSource(sourceId: string): ReceivePathBinding["source"] | null {
    return this.sync().rows.find(row => !row.invalid && row.sourceId === sourceId)?.binding.source ?? null;
  }
  /** Host calls synchronously on auth/room/source/selection changes; this never starts sampling. */
  update(): void { this.sync(); this.emit(); }
  sample(): Promise<void> {
    if (this.disposed) return Promise.resolve(); if (this.flight) return this.flight;
    if (this.clock.now() - this.lastSampleStartedAt < 1000) return Promise.resolve();
    this.lastSampleStartedAt = this.clock.now();
    const context = this.sync(), version = this.version;
    this.flight = (async () => {
      if (context.scope && context.pc && context.rows.some(r => !r.invalid && r.selection.kind === "sfu")) {
        let cached = this.options.clock ? null : cachedReceiveStats(context.pc);
        if (cached && context.rows.some(row => !row.invalid && row.selection.kind === "sfu" && (this.boundAt.get(row.key) ?? Infinity) > cached!.at)) cached = null;
        const report = cached?.report ?? await readReceiveStats(context.pc), at = cached?.at ?? this.clock.now();
        const current = this.sync(); if (this.disposed || version !== this.version || current.pc !== context.pc) return;
        for (const row of current.rows) if (!row.invalid && row.selection.kind === "sfu" && row.selection.track) {
          let parser = this.parsers.get(row.key); if (!parser) { parser = new ReceiveTrackStats(); this.parsers.set(row.key, parser); }
          this.observations.set(row.key, parser.observe(report, row.selection.track.id, at));
        }
      }
      if (!this.disposed && version === this.version) this.sampledAt = this.clock.now();
    })().catch(() => { if (!this.disposed && version === this.version) { this.observations.clear(); this.parsers.clear(); this.sampledAt = null; } })
      .finally(() => { this.flight = undefined; if (!this.disposed) this.emit(); });
    return this.flight;
  }
  subscribe(listener: (snapshot: ReceivePathSnapshot) => void, options: { details?: boolean } = {}): () => void {
    if (this.disposed) return () => {};
    const token = {}; let subscribed = true;
    this.listeners.set(token, { listener, details: options.details === true }); this.update(); this.schedule();
    return () => {
      if (!subscribed) return; subscribed = false; this.listeners.delete(token);
      if (!this.listeners.size) { ++this.version; if (this.timer !== undefined) this.clock.cancel(this.timer); this.timer = undefined;
        for (const watch of this.watchers.values()) for (const cleanup of watch.cleanups) cleanup(); this.watchers.clear();
        this.observations.clear(); this.parsers.clear(); this.sampledAt = null; }
    };
  }
  private emit(): void { for (const { listener, details } of this.listeners.values()) { try { listener(this.getSnapshot({ details })); } catch {} } }
  private schedule(): void {
    if (this.timer !== undefined || this.disposed || !this.listeners.size) return;
    this.timer = this.clock.schedule(() => { this.timer = undefined; void this.sample().finally(() => this.schedule()); }, 1000);
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; ++this.version;
    if (this.timer !== undefined) this.clock.cancel(this.timer); this.timer = undefined;
    for (const watch of this.watchers.values()) for (const cleanup of watch.cleanups) cleanup(); this.watchers.clear();
    this.observations.clear(); this.parsers.clear(); this.boundAt.clear(); this.receiveEpochs.clear(); this.sampledAt = null; this.emit(); this.listeners.clear();
  }
}
