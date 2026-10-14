import type { HybridMediaCandidate, HybridReceivePort } from "../types/Hybrid";

export interface HybridReceiveInputOptions {
  sfuNode: AudioNode;
  downstream: AudioNode;
  sfuTrack: MediaStreamTrack;
  createCandidateNode(candidate: HybridMediaCandidate): AudioNode;
  isCurrent(): boolean;
  getSfuMediaSequence(): number;
  waitForSfuMedia(afterSequence: number): Promise<HybridMediaCandidate>;
  onSelection?(kind: "sfu" | "p2p" | "none", trackId: string | null, revision: number): void;
}

interface EdgeLease { owner: HybridReceiveInput | null; selected: AudioNode | null; revision: number }
const edges = new WeakMap<AudioNode, WeakMap<AudioNode, EdgeLease>>();

/** Opt-in ownership of one existing SFU input; downstream DSP and manual gain stay in place. */
export class HybridReceiveInput implements HybridReceivePort {
  private selected: AudioNode | null;
  private disposed = false;
  private revision = -1;
  private readonly edge: EdgeLease;
  private channels = new Map<AudioNode, GainNode>();
  private handoff?: { revision: number; promise: Promise<void>; resolve(): void; reject(error: Error): void; timer?: ReturnType<typeof setTimeout> };

  constructor(private readonly options: HybridReceiveInputOptions) {
    let downstreams = edges.get(options.sfuNode);
    if (!downstreams) { downstreams = new WeakMap(); edges.set(options.sfuNode, downstreams); }
    let edge = downstreams.get(options.downstream);
    if (!edge) {
      // The first owner borrows the edge already connected by the SDK receive graph.
      edge = { owner: null, selected: options.sfuNode, revision: -1 };
      downstreams.set(options.downstream, edge);
    }
    edge.owner?.detachForReplacement();
    // Retired P2P inputs cannot transfer a candidate node into another owner.
    if (edge.selected && edge.selected !== options.sfuNode) {
      edge.selected.disconnect(options.downstream); edge.selected = null;
    }
    this.edge = edge; edge.owner = this;
    this.selected = edge.selected; this.revision = edge.revision;
  }

  isCurrent(): boolean { return !this.disposed && this.edge.owner === this && this.options.isCurrent(); }
  getSelectedKind(): "sfu" | "none" { return this.selected === this.options.sfuNode ? "sfu" : "none"; }
  getSelectionRevision(): number { return this.revision; }
  getSfuMediaSequence(): number { return this.options.getSfuMediaSequence(); }
  waitForSfuMedia(sequence: number): Promise<HybridMediaCandidate> {
    return this.options.waitForSfuMedia(sequence);
  }

  waitForSelection(revision: number): Promise<void> {
    if (!this.isCurrent() || revision !== this.revision) return Promise.reject(new Error("stale_receive_selection"));
    return this.handoff?.revision === revision ? this.handoff.promise : Promise.resolve();
  }

  select(kind: "sfu" | "p2p" | "none", candidate: HybridMediaCandidate | undefined, revision: number): void {
    if (!this.isCurrent() || !Number.isSafeInteger(revision) || revision <= this.revision) {
      throw new Error("stale_receive_selection");
    }
    if (kind === "p2p" && (!candidate || candidate.track.kind !== "audio" ||
        candidate.track.readyState !== "live" || !candidate.stream.getAudioTracks().includes(candidate.track))) {
      throw new Error("invalid_receive_candidate");
    }
    if (kind === "sfu" && (this.options.sfuTrack.kind !== "audio" || this.options.sfuTrack.readyState !== "live" ||
        (candidate && candidate.track !== this.options.sfuTrack))) throw new Error("invalid_receive_candidate");
    const next = kind === "sfu" ? this.options.sfuNode :
      kind === "p2p" ? this.options.createCandidateNode(candidate!) : null;
    if (next && (next === this.options.downstream || next.context !== this.options.downstream.context)) {
      throw new Error("invalid_receive_node");
    }
    this.revision = revision;
    this.edge.revision = revision;
    this.cancelHandoff();
    if (this.selected !== next) {
      const previous = this.selected;
      // Short sequential fades bound the level step without mixing two delayed
      // encodings. This is not sample/time alignment of the independent tracks.
      if (next && typeof this.options.downstream.context.createGain === "function") {
        this.fadeTo(previous, next, revision);
        this.notify(kind, kind === "sfu" ? this.options.sfuTrack.id : candidate!.track.id, revision);
        return;
      }
      if (previous) this.disconnect(previous);
      this.selected = this.edge.selected = null;
      if (!next) for (const node of [...this.channels.keys()]) this.disconnect(node);
      if (next) {
        try { next.connect(this.options.downstream); this.selected = this.edge.selected = next; }
        catch (error) {
          try { next.disconnect(this.options.downstream); } catch { /* Already disconnected. */ }
          this.notify("none", null, revision);
          throw error;
        }
      }
    }
    this.notify(kind, kind === "none" ? null : kind === "sfu" ? this.options.sfuTrack.id : candidate!.track.id, revision);
  }

  private fadeTo(previous: AudioNode | null, next: AudioNode, revision: number): void {
    const context = this.options.downstream.context, now = context.currentTime;
    const half = 0.012, middle = now + (previous ? half : 0), end = middle + half;
    // Prepare the successor muted before changing the current audible edge.
    const incoming = context.createGain(); incoming.gain.setValueAtTime(0, now);
    const existing = previous ? this.channels.get(previous) : undefined;
    const outgoing = previous ? existing ?? context.createGain() : undefined;
    if (outgoing && !existing) outgoing.gain.setValueAtTime(1, now);
    let directDetached = false;
    try {
      next.connect(incoming); incoming.connect(this.options.downstream);
      if (previous && outgoing && !existing) {
        previous.connect(outgoing); outgoing.connect(this.options.downstream);
        previous.disconnect(this.options.downstream); directDetached = true;
      }
    } catch (error) {
      try { next.disconnect(incoming); } catch { /* New edge may not exist. */ }
      try { incoming.disconnect(); } catch { /* Continue rollback. */ }
      if (previous && outgoing && !existing) {
        try { previous.disconnect(outgoing); } catch { /* New edge may not exist. */ }
        try { outgoing.disconnect(); } catch { /* Continue rollback. */ }
        if (directDetached) previous.connect(this.options.downstream);
      }
      throw error;
    }
    this.channels.set(next, incoming);
    if (previous) {
      this.channels.set(previous, outgoing!);
      outgoing!.gain.cancelScheduledValues(now);
      outgoing!.gain.setValueAtTime(1, now); outgoing!.gain.linearRampToValueAtTime(0, middle);
    }
    incoming.gain.setValueAtTime(0, middle); incoming.gain.linearRampToValueAtTime(1, end);
    this.selected = this.edge.selected = next;
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((a, b) => { resolve = a; reject = b; });
    void promise.catch(() => undefined);
    const handoff = this.handoff = { revision, promise, resolve, reject } as NonNullable<typeof this.handoff>;
    const deadline = performance.now() + 1000;
    const finish = () => {
      if (this.handoff !== handoff) return;
      if (!this.isCurrent()) { this.dispose(); return; }
      if (context.currentTime < end) {
        if (context.state === "closed") { this.dispose(); return; }
        if (performance.now() >= deadline) { this.cancelHandoff(new Error("operation_timeout")); return; }
        handoff.timer = setTimeout(finish, 5); return;
      }
      try {
        if (previous) this.disconnect(previous);
        this.handoff = undefined; resolve();
      } catch (error) { this.handoff = undefined; reject(error instanceof Error ? error : new Error("invalid_receive_node")); }
    };
    handoff.timer = setTimeout(finish, Math.ceil((end - now) * 1000) + 5);
  }

  private disconnect(node: AudioNode): void {
    const gain = this.channels.get(node);
    if (gain) { node.disconnect(gain); gain.disconnect(this.options.downstream); this.channels.delete(node); }
    else node.disconnect(this.options.downstream);
  }

  private cancelHandoff(error = new Error("stale_receive_selection")): void {
    const handoff = this.handoff;
    if (!handoff) return;
    this.handoff = undefined; if (handoff.timer) clearTimeout(handoff.timer);
    for (const node of [...this.channels.keys()]) if (node !== this.selected) this.disconnect(node);
    const gain = this.selected && this.channels.get(this.selected);
    if (gain) { const now = gain.context.currentTime; gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(1, now); }
    handoff.reject(error);
  }

  private detachForReplacement(): void {
    this.cancelHandoff();
    const preserve = this.selected === this.options.sfuNode;
    const managed = !!this.selected && this.channels.has(this.selected);
    for (const node of [...this.channels.keys()]) this.disconnect(node);
    if (preserve && this.selected) {
      // Return the original unity edge before transferring SFU ownership.
      if (managed) this.selected.connect(this.options.downstream);
    } else if (this.selected) {
      if (!managed) this.selected.disconnect(this.options.downstream);
      this.edge.selected = null;
    }
    this.selected = null;
  }

  private notify(kind: "sfu" | "p2p" | "none", trackId: string | null, revision: number): void {
    try { this.options.onSelection?.(kind, trackId, revision); } catch { /* Observer cannot change routing. */ }
  }

  /** Dispose before the SDK stream entry; restore only while that physical SFU entry is current. */
  relinquishSfu(): void {
    if (this.disposed) return;
    if (this.edge.owner !== this) { this.selected = null; this.disposed = true; return; }
    if (this.selected !== this.options.sfuNode) throw new Error("hybrid_restore_incomplete");
    if (this.handoff) throw new Error("hybrid_restore_incomplete");
    if (this.channels.has(this.selected)) { this.disconnect(this.selected); this.selected.connect(this.options.downstream); }
    this.edge.owner = null; this.selected = null; this.disposed = true;
  }

  dispose(restoreSfu = false): void {
    if (this.disposed) return;
    if (this.isCurrent()) {
      this.select(restoreSfu ? "sfu" : "none", undefined, this.revision + 1);
      if (restoreSfu) {
        // Legacy synchronous ownership release must not leave a fade timer
        // targeting an owner that is about to disappear.
        this.cancelHandoff();
        if (this.selected && this.channels.has(this.selected)) {
          this.disconnect(this.selected); this.selected.connect(this.options.downstream);
        }
      }
    }
    else if (this.edge.owner === this && this.selected) {
      this.cancelHandoff(); this.disconnect(this.selected); this.edge.selected = null;
    }
    if (this.edge.owner === this) this.edge.owner = null;
    this.selected = null;
    this.disposed = true;
  }
}
