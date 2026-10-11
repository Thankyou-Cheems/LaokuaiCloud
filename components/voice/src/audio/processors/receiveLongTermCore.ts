import type { ReceiveLevelPrior } from "../lib/receiveLevelPrior";
// The long-term target remains fixed at -20 dBFS, independently of manual/master volume.
// See docs/receive-longterm.md for analyzer, stereo, telemetry and failure boundary decisions.
export class ReceiveLongTermController {
  gainDb = 0;
  desiredDb = 0;
  levelDb = NaN;
  activeSeconds = 0;
  sequence = 0;
  energyCount = 0;
  noiseLimited = false;
  rangeLimited = false;
  noiseReliable = false;
  settledSeconds = 0;
  priorRestoring = false;
  priorRejected = false;
  private priorLevelDb = NaN;
  private restorationDb = 0;
  private pending = new Float64Array(12);
  private energies = new Float64Array(500);
  private sorted = new Float64Array(500);
  private updateFrames = 0;
  private energyAt = 0;
  private speechAge = Infinity;
  reset() {
    this.gainDb = this.desiredDb = this.activeSeconds = this.sequence = this.energyCount = 0;
    this.updateFrames = this.energyAt = this.settledSeconds = 0;
    this.levelDb = NaN;
    this.priorLevelDb = NaN;
    this.priorRestoring = this.priorRejected = false;
    this.restorationDb = 0;
    this.speechAge = Infinity;
    this.noiseLimited = this.rangeLimited = this.noiseReliable = false;
    this.pending.fill(0); this.energies.fill(0); this.sorted.fill(Infinity);
  }
  importPrior(prior: ReceiveLevelPrior): boolean {
    // A delayed cache read must never replace fresh measurements already accepted here.
    if (this.activeSeconds > 0 || this.priorRestoring ||
      prior.schemaVersion !== 1 || prior.processorSchema !== "gryt-receive-level-v2" ||
      !Number.isFinite(prior.learnedGainDb) || prior.learnedGainDb < -12 || prior.learnedGainDb > 18 ||
      !Number.isFinite(prior.speechLevelDbfs) || prior.speechLevelDbfs < -84 || prior.speechLevelDbfs > 24 ||
      !Number.isFinite(prior.effectiveSpeechSeconds) || prior.effectiveSpeechSeconds < 5 || prior.effectiveSpeechSeconds > 1e9 ||
      !Number.isSafeInteger(prior.lastVerifiedUnixMs) || prior.lastVerifiedUnixMs < 0) return false;
    this.gainDb = prior.learnedGainDb;
    this.priorLevelDb = prior.speechLevelDbfs;
    this.restorationDb = Math.max(-6, Math.min(3, this.gainDb));
    this.priorRestoring = true;
    return true;
  }
  update(energy: number, probability: number, noiseDb: number, noiseReliable = true): number {
    const trusted = probability >= 0.95 && energy > Math.pow(10, -84 / 20) ** 2;
    this.speechAge = trusted ? 0 : this.speechAge + 0.01;
    if (trusted) {
      ++this.sequence;
      if (this.sequence <= 12) this.pending[this.sequence - 1] = energy;
      if (this.sequence === 12) for (let i = 0; i < 12; ++i) this.accept(this.pending[i]);
      else if (this.sequence > 12) this.accept(energy);
    } else this.sequence = 0;
    this.noiseReliable = noiseReliable && Number.isFinite(noiseDb);
    const dt = this.sequence === 12 ? 0.12 : this.sequence > 12 ? 0.01 : 0;
    if (Number.isFinite(this.levelDb)) {
      if (this.priorRestoring && Number.isFinite(this.priorLevelDb)) {
        if (Math.abs(this.levelDb - this.priorLevelDb) > 6) {
          this.gainDb = Math.max(-6, Math.min(3, this.gainDb));
          this.priorRestoring = false; this.priorRejected = true;
        }
        this.priorLevelDb = NaN;
      }
      const unbounded = -20 - this.levelDb;
      const noiseCap = this.noiseReliable ? Math.max(0, -42 - noiseDb) : 0;
      this.noiseLimited = unbounded > noiseCap;
      this.rangeLimited = unbounded < -12 || unbounded > 18;
      this.desiredDb = Math.max(-12, Math.min(18, unbounded, noiseCap));
      this.gainDb += Math.max(-3 * dt, Math.min(1.5 * dt, this.desiredDb - this.gainDb));
      if (this.priorRestoring) {
        this.restorationDb += Math.max(-3 * dt, Math.min(1.5 * dt, this.gainDb - this.restorationDb));
        if (Math.abs(this.restorationDb - this.gainDb) < 0.01) this.priorRestoring = false;
      }
    }
    if (dt > 0) {
      this.settledSeconds = !this.priorRestoring && this.energyCount === 500 && Math.abs(this.gainDb - this.desiredDb) <= 0.5
        ? this.settledSeconds + dt : 0;
    }
    const actualDb = this.priorRestoring ? this.restorationDb : this.gainDb;
    const positiveSafe = Math.min(Math.max(0, actualDb), this.noiseReliable ? Math.max(0, -42 - noiseDb) : 0);
    return actualDb < 0 ? actualDb : this.speechAge <= 0.12 ? positiveSafe : 0;
  }
  private accept(energy: number) {
    this.activeSeconds += 0.01;
    this.energies[this.energyAt] = energy;
    this.energyAt = (this.energyAt + 1) % 500;
    this.energyCount = Math.min(500, this.energyCount + 1);
    if (++this.updateFrames < 20) return;
    this.updateFrames = 0;
    if (this.energyCount < 100) return;
    this.sorted.fill(Infinity);
    for (let i = 0; i < this.energyCount; ++i) this.sorted[i] = this.energies[i];
    this.sorted.sort();
    const drop = Math.floor(this.energyCount * 0.2);
    let sum = 0;
    for (let i = drop; i < this.energyCount - drop; ++i) sum += this.sorted[i];
    this.levelDb = 20 * Math.log10(Math.sqrt(sum / (this.energyCount - 2 * drop)));
  }
}

export interface ReceiveAnalyzerExports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  gryt_create(rate: number, mode: number): number;
  gryt_destroy(handle: number): number;
  gryt_input(handle: number): number;
  gryt_output(handle: number): number;
  gryt_process10ms(handle: number, size: number): number;
}

export function createReceiveAnalyzerRuntime(module: WebAssembly.Module): ReceiveAnalyzerExports {
  const wasi_snapshot_preview1 = {
    proc_exit(code: number) { throw new Error("analyzer-exit-" + code); },
    fd_close() { return 8; },
    fd_seek() { return 29; },
    fd_write() { throw new Error("analyzer-upstream-diagnostic"); },
  };
  const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1 });
  const exports = instance.exports as unknown as ReceiveAnalyzerExports;
  exports._initialize();
  return exports;
}

export class ReceiveLongTermLeveler {
  readonly controller = new ReceiveLongTermController();
  readonly supported: boolean;
  targetDb = 0;
  appliedDb = 0;
  compDb = 0;
  fault = false;
  available = false;
  frames = 0;
  private handle = 0;
  private inputView?: Float32Array;
  private resultView?: Float32Array;
  private at = 0;
  private energy = 0;
  private frameSize: number;
  private gainAttack: number;
  private gainRelease: number;
  private wasEnabled = false;
  constructor(rate: number, private runtime?: ReceiveAnalyzerExports) {
    this.supported = Number.isInteger(rate) && rate >= 8000 && rate <= 48000 && rate % 100 === 0;
    this.frameSize = this.supported ? rate / 100 : Math.max(1, Math.round(rate / 100));
    this.gainAttack = 1 - Math.exp(-1 / (rate * 0.03));
    this.gainRelease = 1 - Math.exp(-1 / (rate * 0.12));
  }
  // Handle allocation/destruction is called only from constructor/control events, never process().
  configure(eligible: boolean, rate: number) {
    this.destroy(); this.reset(); this.fault = eligible && this.supported && !this.runtime;
    if (!eligible || !this.supported || !this.runtime) return;
    try {
      this.handle = this.runtime.gryt_create(rate, 0);
      if (!this.handle) return;
      this.inputView = new Float32Array(this.runtime.memory.buffer, this.runtime.gryt_input(this.handle), this.frameSize);
      this.resultView = new Float32Array(this.runtime.memory.buffer, this.runtime.gryt_output(this.handle), 8);
      this.available = true;
    } catch { this.fault = true; this.destroy(); }
  }
  destroy() {
    if (this.handle && this.runtime) {
      try { this.runtime.gryt_destroy(this.handle); } catch { this.fault = true; }
    }
    this.handle = 0; this.available = false;
    this.inputView = this.resultView = undefined;
  }
  reset() {
    this.controller.reset();
    this.targetDb = this.appliedDb = this.compDb = 0;
    this.at = this.energy = this.frames = 0;
  }
  process(input: Float32Array[], output: Float32Array[], enabled: boolean) {
    const length = output[0]?.length ?? 0;
    if (!enabled) {
      if (this.wasEnabled) this.reset();
      this.wasEnabled = false;
      for (let c = 0; c < output.length; ++c) for (let i = 0; i < length; ++i) {
        const x = input[c]?.[i] ?? 0;
        output[c][i] = Number.isFinite(x) ? x : 0;
      }
      return;
    }
    this.wasEnabled = true;
    for (let i = 0; i < length; ++i) {
      let mono = 0;
      const channels = Math.min(input.length, 2);
      for (let c = 0; c < channels; ++c) {
        const raw = input[c][i] ?? 0;
        mono += Number.isFinite(raw) ? raw : 0;
      }
      mono /= channels || 1;
      this.energy += mono * mono;
      if (this.available && this.inputView) {
        this.inputView[this.at] = Math.max(-32768, Math.min(32767, mono * 32768));
      }
      if (++this.at === this.frameSize) this.analyze();
      this.appliedDb += (this.targetDb - this.appliedDb) * (this.targetDb > this.appliedDb ? this.gainAttack : this.gainRelease);
      const gain = Math.pow(10, this.appliedDb / 20);
      for (let c = 0; c < output.length; ++c) {
        const raw = input[c]?.[i] ?? 0;
        output[c][i] = Number.isFinite(raw) ? raw * gain : 0;
      }
    }
  }
  private analyze() {
    const energy = this.energy / this.frameSize;
    this.at = this.energy = 0;
    ++this.frames;
    if (this.available && this.runtime && this.resultView) {
      try {
        if (this.runtime.gryt_process10ms(this.handle, this.frameSize) !== 0) throw new Error("analyzer-frame-rejected");
        const probability = this.resultView[0], noiseDb = this.resultView[4];
        if (!Number.isFinite(probability) || !Number.isFinite(noiseDb)) throw new Error("analyzer-nonfinite");
        this.targetDb = this.controller.update(energy, probability, noiseDb, true);
      } catch {
        this.available = false; this.fault = true;
        this.controller.reset(); this.targetDb = this.appliedDb = 0;
      }
    } else this.targetDb = 0;
  }
}
