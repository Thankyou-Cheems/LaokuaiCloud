import { type HybridScope, type ReceivePathBinding, ReceivePathObserver, type ReceivePathObserverOptions, type ReceivePathRow, type ReceivePathScope, type ReceivePathSnapshot } from "@gryt/voice";

import type { SelectedVoiceMediaEvidence } from "./memberVoiceMediaPath";
import { type AuthenticatedVoiceConnection, MemberVoiceMediaStore, type VoiceMediaObservationLease } from "./memberVoiceMediaStore";

export interface VoiceReceiveHost {
  connection: AuthenticatedVoiceConnection;
  bindings: readonly ReceivePathBinding[];
  connectionEpoch: number;
  /** From the current session's passive getter, never copied from an observer row. */
  hybridScope: HybridScope | null;
}
const sameHybrid = (a: HybridScope | null, b: HybridScope | null) => !!a && !!b &&
  (["serverInstanceId", "roomId", "roomGeneration", "localParticipantId", "localSessionId", "canReceive", "canPublish"] as const).every(k => a[k] === b[k]);
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
const recent = (n: number | null, now: number) => n !== null && Number.isFinite(n) && n >= 0 && n <= now && now - n <= 3000;

/** One passive SDK subscription feeds the existing authority store. Borrowed
 * PC/socket/source objects never escape the adapter or acquire lifecycle owners. */
export class MemberVoiceReceiveTranslator {
  readonly observer: ReceivePathObserver;
  private key = "";
  private scope: ReceivePathScope | null = null;
  private ordinal = 0;
  private ids = new WeakMap<object, number>();
  private nextId = 0;
  private rows = new Map<string, { lease: VoiceMediaObservationLease; key: string }>();
  private unsubscribe?: () => void;
  private unsubscribeDetails?: () => void;
  private details = 0;
  private subscriptionEpoch = 0;
  private disposed = false;
  constructor(private readonly store: MemberVoiceMediaStore, private readonly options: {
    getSfu: ReceivePathObserverOptions["getSfu"];
    getHost(): VoiceReceiveHost | null;
    now(): number;
    /** Tests only; production always uses the page's performance.now domain. */
    clock?: ReceivePathObserverOptions["clock"];
  }) {
    this.observer = new ReceivePathObserver({ getSfu: options.getSfu,
      getScope: () => this.currentHost() ? this.scope : null,
      getBindings: () => this.currentHost()?.bindings ?? [], ...(options.clock ? { clock: options.clock } : {}) });
  }
  private id(v: object) { let id = this.ids.get(v); if (!id) { id = ++this.nextId; this.ids.set(v, id); } return id; }
  private hostKey(h: VoiceReceiveHost): string {
    const c = h.connection;
    return JSON.stringify([c.accountId, c.host, c.serverInstanceId, c.roomId, c.localUserId, c.localSessionId,
      c.localPublicationId, this.id(c.socket), this.id(c.peerConnection), h.connectionEpoch, h.hybridScope]);
  }
  private readHost(): VoiceReceiveHost | null {
    const h = this.options.getHost(), sfu = this.options.getSfu();
    const pc = sfu.getPeerConnection?.();
    if (!h || !sfu.isConnected || !pc || pc.connectionState !== "connected" || pc !== h.connection.peerConnection ||
      sfu.getConnectionEpoch?.() !== h.connectionEpoch || !positive(h.connectionEpoch)) return null;
    const a = h.hybridScope, c = h.connection;
    if (a && (!a.canReceive || !a.roomGeneration || a.serverInstanceId !== c.serverInstanceId ||
      a.roomId !== c.roomId || a.localParticipantId !== c.localUserId || a.localSessionId !== c.localSessionId)) return null;
    return h;
  }
  private currentHost(): VoiceReceiveHost | null {
    if (this.disposed) return null;
    const h = this.readHost(); return h && this.hostKey(h) === this.key ? h : null;
  }
  private refresh(): void {
    const h = this.disposed ? null : this.readHost(), key = h ? this.hostKey(h) : "";
    if (key !== this.key) { this.key = key; this.ordinal++; this.rows.clear(); }
    if (!h) { this.scope = null; this.store.reconcile(); return; }
    const c = h.connection, a = h.hybridScope;
    this.scope = { source: "host-authenticated-connection", bindingId: `client-receive-${this.ordinal}`,
      serverId: c.host, roomId: c.roomId, localSessionId: c.localSessionId, canReceive: true };
    this.store.reconcile({ ...c, ...(a ? { roomAuthority: { serverInstanceId: a.serverInstanceId, roomId: a.roomId,
      localUserId: a.localParticipantId, localSessionId: a.localSessionId, roomGenerationToken: a.roomGeneration } } : {}) });
  }
  update(): void { if (!this.disposed) { this.refresh(); this.observer.update(); } }
  start(): void {
    if (this.disposed || this.unsubscribe) return;
    this.refresh();
    this.unsubscribe = this.observer.subscribe(s => { if (!this.details) this.accept(s); });
  }
  requestDetails(): () => void {
    if (this.disposed) return () => {};
    if (++this.details === 1) this.unsubscribeDetails = this.observer.subscribe(s => this.accept(s), { details: true });
    let live = true; const epoch = this.subscriptionEpoch;
    return () => { if (!live || this.disposed || epoch !== this.subscriptionEpoch) return; live = false;
      if (--this.details === 0) { this.unsubscribeDetails?.(); this.unsubscribeDetails = undefined; this.observer.update(); } };
  }
  private retire(session: string): void {
    const prior = this.rows.get(session); if (prior) this.store.invalidateReceive(prior.lease);
    this.rows.delete(session);
  }
  private accept(snapshot: ReceivePathSnapshot): void {
    if (this.disposed) return;
    this.refresh();
    const h = this.currentHost(), now = this.options.now();
    if (!h || snapshot.clockDomain !== (this.options.clock ? "injected-local" : "performance.now") ||
      snapshot.connectionEpoch !== h.connectionEpoch || !snapshot.scope || !this.scope ||
      (Object.keys(this.scope) as (keyof ReceivePathScope)[]).some(k => snapshot.scope![k] !== this.scope![k]) ||
      !recent(snapshot.readAtMs, now)) {
      for (const session of this.rows.keys()) this.retire(session); return;
    }
    const seen = new Set<string>();
    for (const row of snapshot.rows) {
      const session = row.remoteSessionId;
      if (!session || seen.has(session)) { if (session) this.retire(session); continue; } seen.add(session);
      let lease = this.store.capture(session);
      const source = this.observer.getSource(row.sourceId), binding = h.bindings.find(b => b.sessionId === session);
      if (!lease || !source || source !== binding?.source || source.receiveCleanup !== lease.source ||
        row.participantId !== lease.scope.remoteServerUserId || row.publicationId !== lease.scope.remotePublicationId ||
        row.selected === null || !positive(row.receiveGeneration) || !positive(row.selectionEpoch) ||
        (row.selectionSource === "sdk-hybrid-selected-edge" && !sameHybrid(row.hybridScope, h.hybridScope)) ||
        (row.selected === "p2p" && row.selectionSource !== "sdk-hybrid-selected-edge")) { this.retire(session); continue; }
      const key = JSON.stringify([row.sourceId, row.receiveGeneration, row.selectionEpoch, row.trackId,
        row.selectionRevision, row.routeGeneration, row.hybridScope]);
      const prior = this.rows.get(session);
      if (prior && (prior.lease !== lease || prior.key !== key)) { this.retire(session); lease = this.store.capture(session)!; }
      const evidence = this.translate(row, now, snapshot.readAtMs);
      if (evidence && this.store.acceptReceive(lease, evidence)) this.rows.set(session, { lease, key });
      else this.retire(session);
    }
    for (const session of this.rows.keys()) if (!seen.has(session)) this.retire(session);
  }
  private translate(row: ReceivePathRow, now: number, readAt: number): SelectedVoiceMediaEvidence | null {
    if (row.selected === null) return null;
    const d = row.decode, fresh = row.availability === "fresh" && !!row.trackId && recent(row.observedAtMs, now) &&
      !!d && d.fresh && d.source === "rtc-inbound-rtp-totalSamplesReceived" && recent(d.startAtMs, now) &&
      d.startAtMs < d.endAtMs && d.endAtMs === row.observedAtMs && positive(d.packetsDelta) && positive(d.samplesDelta) &&
      positive(d.decodedFramesDelta) && d.decodedFramesDelta === d.samplesDelta;
    const route = { mediaRouteId: row.sourceId, routeGeneration: row.receiveGeneration, selectionRevision: row.selectionEpoch };
    const transition = ["switching", "recovering"].includes(row.status) ? "confirmed-switching" :
      row.status === "failed" && !fresh ? "confirmed-failed" : "stable";
    const e: SelectedVoiceMediaEvidence = { ...route, source: "sdk-selected-receive-media",
      // Selection is a current local read; it never serves as decoded/media proof time.
      observedAtMs: recent(row.observedAtMs, now) ? row.observedAtMs! : readAt,
      selected: row.selected === "p2p" ? "peer" : row.selected, selectedTrackId: row.trackId,
      availability: fresh ? "usable" : row.selected === "none" || row.status === "failed" ? "unavailable" : "unknown", transition,
      diagnostic: { status: row.status, reason: row.reason, hybridRouteGeneration: row.routeGeneration, hybridSelectionRevision: row.selectionRevision } };
    if (!fresh || !d || !row.trackId) return e;
    e.mediaProof = { ...route, source: "sdk-decoded-receive-media", observedAtMs: d.endAtMs,
      windowStartedAtMs: d.startAtMs, decodedFramesDelta: d.decodedFramesDelta, selectedTrackId: row.trackId };
    const m = row.metrics, leg = row.selected === "p2p" ? "peer-to-local" : "sfu-to-local";
    if (m && row.metricLeg === leg) {
      if (m.selectedPairId) e.selectedIcePairId = m.selectedPairId;
      const rtt = m.rttWindow, loss = m.lossWindow;
      const rttValid = m.selectedPairId && rtt && recent(rtt.startAtMs, now) && rtt.startAtMs < rtt.endAtMs && rtt.endAtMs === d.endAtMs && m.rttSource === "rtc-selected-candidate-pair";
      const lossValid = loss && loss.startAtMs === d.startAtMs && loss.endAtMs === d.endAtMs && m.lossSource === "exact-audio-track-inbound-rtp";
      e.metrics = { ...route, source: "selected-media-stats", observedAtMs: d.endAtMs,
        scope: row.selected === "p2p" ? "peer-transport" : "sfu-transport", rttMs: rttValid ? m.rttMs : null,
        ...(lossValid ? { loss: { packetsReceived: loss.received, packetsLost: loss.lost, windowMs: loss.endAtMs - loss.startAtMs } } : {}) };
    }
    return e;
  }
  dispose(): void {
    if (this.disposed) return; this.stop(); this.disposed = true; this.observer.dispose();
  }
  stop(): void {
    this.subscriptionEpoch++;
    this.unsubscribe?.(); this.unsubscribeDetails?.(); this.unsubscribe = undefined; this.unsubscribeDetails = undefined;
    this.details = 0; this.rows.clear(); this.scope = null; this.key = ""; this.ordinal++; this.store.clear();
  }
}
