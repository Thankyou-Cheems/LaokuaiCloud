import type { HybridMediaCandidate } from "../types/Hybrid";

interface Observation { packets: number; samples: number; sequence: number; at: number }
interface Binding { stream: MediaStream; track: MediaStreamTrack; current(): boolean; observation: Observation;
  waiters: Set<{ after: number; packets: number; samples: number; timer: ReturnType<typeof setTimeout>; resolve(value: HybridMediaCandidate): void; reject(error: Error): void }> }
export interface SfuAudioEvidence {
  getSequence(): number;
  waitForFresh(after: number): Promise<HybridMediaCandidate>;
  dispose(): void;
}

/** One bounded stats read per SFU PC, shared by every physical microphone route. */
export class SfuDecodedAudioMonitor {
  private readonly pc: RTCPeerConnection;
  private bindings = new Set<Binding>();
  private disposed = false;
  private flight?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly getCurrentPc: () => RTCPeerConnection | null) {
    const pc = getCurrentPc(); if (!pc) throw new Error("sfu_media_unavailable"); this.pc = pc;
  }
  bind(stream: MediaStream, track: MediaStreamTrack, current: () => boolean): SfuAudioEvidence {
    if (this.disposed || track.kind !== "audio" || !stream.getAudioTracks().includes(track)) throw new Error("sfu_media_unavailable");
    const binding: Binding = { stream, track, current, observation: { packets: 0, samples: 0, sequence: 0, at: -Infinity }, waiters: new Set() };
    this.bindings.add(binding); this.schedule();
    const dispose = () => { this.bindings.delete(binding); for (const waiter of binding.waiters) { clearTimeout(waiter.timer); waiter.reject(new Error("sfu_binding_retired")); } binding.waiters.clear(); };
    return {
      getSequence: () => binding.observation.sequence,
      waitForFresh: async after => {
        if (!Number.isSafeInteger(after) || after < 0) throw new Error("invalid_sfu_media_sequence");
        // A post-restore-ACK stats snapshot is a checkpoint, never itself fresh media.
        await this.checkpoint();
        if (!this.valid(binding)) throw new Error("sfu_binding_retired");
        if (binding.waiters.size >= 4) throw new Error("sfu_waiter_capacity");
        const baseline = { ...binding.observation };
        return new Promise<HybridMediaCandidate>((resolve, reject) => {
          const waiter = { after: Math.max(after, baseline.sequence), packets: baseline.packets, samples: baseline.samples,
            resolve, reject, timer: setTimeout(() => { binding.waiters.delete(waiter); reject(new Error("fresh_sfu_media_unavailable")); }, 5000) };
          binding.waiters.add(waiter); this.schedule();
        });
      }, dispose,
    };
  }
  private valid(binding: Binding): boolean {
    return !this.disposed && this.getCurrentPc() === this.pc && this.pc.connectionState === "connected" &&
      this.bindings.has(binding) && binding.current() && binding.track.readyState === "live";
  }
  private async checkpoint(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("fresh_sfu_media_unavailable")), 5000); });
    const read = async () => {
      // A flight begun before the restore ACK cannot define the new baseline.
      if (this.flight) await this.flight;
      if (this.disposed) throw new Error("sfu_monitor_disposed");
      await this.read();
    };
    try { await Promise.race([read(), deadline]); } finally { clearTimeout(timer); }
  }
  private schedule(): void {
    if (this.timer || this.disposed || this.bindings.size === 0) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.read().catch(() => {}).finally(() => this.schedule()); }, 250);
  }
  private read(): Promise<void> {
    if (this.flight) return this.flight;
    const pc = this.pc;
    this.flight = pc.getStats().then(stats => {
      if (this.disposed || this.getCurrentPc() !== pc) throw new Error("sfu_generation_changed");
      for (const binding of this.bindings) {
        if (!this.valid(binding)) {
          for (const waiter of binding.waiters) { clearTimeout(waiter.timer); waiter.reject(new Error("sfu_binding_retired")); } binding.waiters.clear(); continue;
        }
        let packets = 0, samples = 0, matched = false;
        stats.forEach(row => {
          if (row.type === "inbound-rtp" && (row.kind ?? row.mediaType) === "audio" && row.trackIdentifier === binding.track.id &&
              Number.isSafeInteger(row.packetsReceived) && row.packetsReceived >= 0 && Number.isSafeInteger(row.totalSamplesReceived) && row.totalSamplesReceived >= 0) {
            packets += row.packetsReceived; samples += row.totalSamplesReceived; matched = true;
          }
        });
        if (!matched) continue; // Missing track-scoped counters are unavailable, never guessed from RMS.
        const previous = binding.observation;
        if (samples < previous.samples || packets < previous.packets) {
          for (const waiter of binding.waiters) { clearTimeout(waiter.timer); waiter.reject(new Error("sfu_counters_reset")); } binding.waiters.clear();
          binding.observation = { packets, samples, sequence: previous.sequence, at: -Infinity }; continue;
        }
        if (samples > previous.samples && packets > previous.packets) {
          binding.observation = { packets, samples, sequence: previous.sequence + 1, at: performance.now() };
          for (const waiter of binding.waiters) if (binding.observation.sequence > waiter.after && packets > waiter.packets && samples > waiter.samples) {
            binding.waiters.delete(waiter); clearTimeout(waiter.timer); waiter.resolve({ stream: binding.stream, track: binding.track, decodedFrames: Math.max(1, Math.floor(samples / 480)),
              mediaSequence: binding.observation.sequence, observedAtMs: binding.observation.at });
          }
        }
      }
    }).finally(() => { this.flight = undefined; });
    return this.flight;
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; clearTimeout(this.timer);
    for (const binding of this.bindings) for (const waiter of binding.waiters) { clearTimeout(waiter.timer); waiter.reject(new Error("sfu_monitor_disposed")); }
    this.bindings.clear();
  }
}
