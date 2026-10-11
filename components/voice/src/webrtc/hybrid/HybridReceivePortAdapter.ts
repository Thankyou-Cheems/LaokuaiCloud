import type { StreamSources } from "../types/SFU";
import type { HybridMediaCandidate, HybridReceivePort } from "../types/Hybrid";
import { HybridReceiveInput } from "./HybridReceiveInput";
import type { SfuAudioEvidence, SfuDecodedAudioMonitor } from "./SfuDecodedAudioMonitor";
import type { HybridScope } from "../types/Hybrid";
import type { ReceivePathSelectionPort } from "../types/ReceivePath";

export interface HybridReceivePortOptions {
  source: StreamSources[string];
  monitor: SfuDecodedAudioMonitor;
  isCurrent(): boolean;
  /** Actual selected track object, not an SFU alias or a guessed ID. */
  onSelection?(kind: "sfu" | "p2p" | "none", track: MediaStreamTrack | null, revision: number): void;
  onRetired?(): void;
  getReadOnlyRoute?(): { routeGeneration: number; status: string; reason: string | null } | null;
  getReadOnlyScope?(): HybridScope | null;
  getReadOnlyParticipant?(): { participantId: string; sessionId: string; publicationId: string };
}

/** Owns the existing source -> analyser edge, leaving the receive DSP/manual/bus intact. */
export class HybridReceivePortAdapter implements HybridReceivePort {
  private readonly input: HybridReceiveInput;
  private readonly evidence: SfuAudioEvidence;
  private unsubscribe: () => void = () => {};
  private disposed = false;
  private selected: "sfu" | "p2p" | "none" = "sfu";
  private observers = new Set<() => void>();
  private readonly readOnlyPort: ReceivePathSelectionPort;
  readonly sfuTrack: MediaStreamTrack;
  constructor(private readonly options: HybridReceivePortOptions) {
    const { source } = options;
    if (source.receivePath?.getSelection().current) throw new Error("hybrid_receive_owner_conflict");
    const control = source.receiveCleanup;
    if (!("mediaStream" in source.stream) || !control?.isCurrent || !control.subscribeRetirement || !control.isCurrent()) {
      throw new Error("hybrid_receive_entry_unsupported");
    }
    const stream = source.stream.mediaStream, tracks = stream.getAudioTracks();
    if (tracks.length !== 1 || stream.getTracks().length !== 1 || tracks[0].readyState !== "live") throw new Error("hybrid_receive_entry_unsupported");
    this.sfuTrack = tracks[0];
    this.evidence = options.monitor.bind(stream, this.sfuTrack, () => this.isCurrent());
    this.input = new HybridReceiveInput({ sfuNode: source.stream, downstream: source.analyser, sfuTrack: this.sfuTrack,
      isCurrent: () => !this.disposed && options.isCurrent() && control.isCurrent!(),
      createCandidateNode: candidate => (source.analyser.context as AudioContext).createMediaStreamSource(candidate.stream),
      getSfuMediaSequence: () => this.evidence.getSequence(), waitForSfuMedia: after => this.evidence.waitForFresh(after),
      onSelection: (kind, _id, revision) => {
        this.selected = kind;
        options.onSelection?.(kind, kind === "sfu" ? this.sfuTrack : kind === "p2p" ? this.selectedCandidate?.track ?? null : null, revision);
        this.notifyObservers();
      },
    });
    this.readOnlyPort = { getSelection: () => {
      const route = options.getReadOnlyRoute?.();
      return { current: this.isCurrent(), kind: this.selected, track: this.selected === "sfu" ? this.sfuTrack :
        this.selected === "p2p" ? this.selectedCandidate?.track ?? null : null, revision: this.getSelectionRevision(),
        routeGeneration: route?.routeGeneration ?? null, status: route?.status ?? this.selected,
        reason: route?.reason ?? null, hybridScope: options.getReadOnlyScope?.() ?? null,
        remoteIdentity: options.getReadOnlyParticipant?.() ?? null };
    }, getObservation: () => this.selected === "p2p" && this.isCurrent() ? this.selectedCandidate?.getReceiveObservation?.() ?? null : null,
    subscribe: listener => { this.observers.add(listener); return () => { this.observers.delete(listener); }; } };
    source.receivePath = this.readOnlyPort;
    this.unsubscribe = control.subscribeRetirement(() => { this.dispose(); options.onRetired?.(); });
  }
  private selectedCandidate?: HybridMediaCandidate;
  isCurrent(): boolean { return !this.disposed && this.options.isCurrent() && this.options.source.receiveCleanup?.isCurrent?.() === true; }
  getSelectionRevision(): number { return this.input.getSelectionRevision(); }
  getSelection() { return { kind: this.selected, trackId: this.selected === "sfu" ? this.sfuTrack.id :
    this.selected === "p2p" ? this.selectedCandidate?.track.id ?? null : null, revision: this.getSelectionRevision() }; }
  getSfuMediaSequence(): number { return this.evidence.getSequence(); }
  waitForSfuMedia(after: number): Promise<HybridMediaCandidate> { return this.evidence.waitForFresh(after); }
  select(kind: "sfu" | "p2p" | "none", candidate: HybridMediaCandidate | undefined, revision: number): void {
    const previous = this.selectedCandidate;
    this.selectedCandidate = candidate;
    try { this.input.select(kind, candidate, revision); }
    catch (error) { this.selectedCandidate = previous; throw error; }
    this.selected = kind;
  }
  /** Caller must resolve only after an exact current authenticated SFU restore ACK. No expiry/timer substitute. */
  async restoreSfu(restoreForwarding: () => Promise<void>, isAuthorized: () => boolean = () => true): Promise<void> {
    const revision = this.getSelectionRevision(), sequence = this.getSfuMediaSequence();
    if (!this.isCurrent()) throw new Error("sfu_binding_retired");
    await restoreForwarding();
    if (!isAuthorized() || !this.isCurrent() || revision !== this.getSelectionRevision()) throw new Error("stale_receive_selection");
    const media = await this.waitForSfuMedia(sequence);
    if (!isAuthorized() || !this.isCurrent() || revision !== this.getSelectionRevision()) throw new Error("stale_receive_selection");
    this.select("sfu", media, revision + 1);
  }
  dispose(): void {
    if (this.disposed) return;
    try { this.input.dispose(); } finally {
      this.disposed = true; this.evidence.dispose(); this.unsubscribe(); this.notifyObservers(); this.observers.clear();
    }
  }
  /** Relinquish ownership only after verified restoration; keep the SDK's original SFU edge. */
  releaseRestored(): void {
    if (this.disposed) return;
    if (this.selected !== "sfu") throw new Error("hybrid_restore_incomplete");
    this.input.dispose(true); this.disposed = true; this.evidence.dispose(); this.unsubscribe();
    if (this.options.source.receivePath === this.readOnlyPort) delete this.options.source.receivePath;
    this.notifyObservers(); this.observers.clear();
  }
  private notifyObservers(): void { for (const listener of this.observers) { try { listener(); } catch {} } }
}
