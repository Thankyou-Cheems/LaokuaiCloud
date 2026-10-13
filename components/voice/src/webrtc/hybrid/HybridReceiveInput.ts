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

  constructor(private readonly options: HybridReceiveInputOptions) {
    let downstreams = edges.get(options.sfuNode);
    if (!downstreams) { downstreams = new WeakMap(); edges.set(options.sfuNode, downstreams); }
    let edge = downstreams.get(options.downstream);
    if (!edge) {
      // The first owner borrows the edge already connected by the SDK receive graph.
      edge = { owner: null, selected: options.sfuNode, revision: -1 };
      downstreams.set(options.downstream, edge);
    }
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
    if (this.selected !== next) {
      const previous = this.selected;
      // Never connect a second upstream while the previous disconnect is unconfirmed.
      if (previous) previous.disconnect(this.options.downstream);
      this.selected = this.edge.selected = null;
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

  private notify(kind: "sfu" | "p2p" | "none", trackId: string | null, revision: number): void {
    try { this.options.onSelection?.(kind, trackId, revision); } catch { /* Observer cannot change routing. */ }
  }

  /** Dispose before the SDK stream entry; restore only while that physical SFU entry is current. */
  relinquishSfu(): void {
    if (this.disposed) return;
    if (this.edge.owner !== this) { this.selected = null; this.disposed = true; return; }
    if (this.selected !== this.options.sfuNode) throw new Error("hybrid_restore_incomplete");
    this.edge.owner = null; this.selected = null; this.disposed = true;
  }

  dispose(restoreSfu = false): void {
    if (this.disposed) return;
    if (this.isCurrent()) this.select(restoreSfu ? "sfu" : "none", undefined, this.revision + 1);
    else if (this.edge.owner === this && this.selected) {
      this.selected.disconnect(this.options.downstream); this.edge.selected = null;
    }
    if (this.edge.owner === this) this.edge.owner = null;
    this.selected = null;
    this.disposed = true;
  }
}
