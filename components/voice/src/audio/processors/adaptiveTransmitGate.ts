/** One 10 ms model decision; energy is auxiliary SNR evidence, never a VAD replacement. */
export interface TransmitSpeechEvidence {
  probability: number;
  rmsDbfs: number;
  valid: boolean;
  nonzero: boolean;
}

/** Ephemeral noise floor and gate state. No timer, storage or device-global history. */
export class AdaptiveTransmitGate {
  floorDbfs: number | null = null;
  open = false;
  speech = false;
  private learnedFrames = 0;
  private candidateFrames = 0;
  private holdFrames = 0;
  reset() {
    this.floorDbfs = null;
    this.learnedFrames = this.candidateFrames = this.holdFrames = 0;
    this.open = this.speech = false;
  }
  process(evidence: TransmitSpeechEvidence, eligible: boolean, hangoverMs = 300) {
    this.speech = false;
    if (!eligible || !evidence.valid || !Number.isFinite(evidence.probability)
      || evidence.probability < 0 || evidence.probability > 1
      || !Number.isFinite(evidence.rmsDbfs) || !evidence.nonzero) {
      this.open = false; this.candidateFrames = this.holdFrames = 0;
      return;
    }
    const {probability, rmsDbfs} = evidence;
    // Only trusted non-speech learns. Slow upward adaptation prevents a voice being learnt as noise.
    if (probability <= 0.05) {
      const measured = Math.max(-90, Math.min(-20, rmsDbfs));
      if (this.floorDbfs === null) this.floorDbfs = measured;
      else this.floorDbfs += (measured - this.floorDbfs) * (measured > this.floorDbfs ? 0.002 : 0.2);
      this.learnedFrames++;
    }
    const snr = this.floorDbfs === null ? -Infinity : rmsDbfs - this.floorDbfs;
    const candidate = this.learnedFrames >= 10 && probability >= (this.open ? 0.6 : 0.7)
      && snr >= (this.open ? 6 : 10);
    this.candidateFrames = candidate ? this.candidateFrames + 1 : 0;
    // Strong model speech opens immediately; quieter candidates require SNR and adjacent frames.
    this.speech = probability >= 0.95 || this.candidateFrames >= 2;
    if (this.speech) {
      this.open = true;
      this.holdFrames = Math.max(0, Math.ceil(Math.min(10000, Math.max(0, hangoverMs)) / 10));
    } else if (this.holdFrames > 0) {
      this.holdFrames--;
    } else {
      this.open = false;
    }
  }
}
