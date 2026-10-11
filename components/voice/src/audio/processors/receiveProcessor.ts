import { RECEIVE_DSP_CODE } from "./receiveDspCode";
import { RECEIVE_ANALYZER_BASE64 } from "./receiveAnalyzerAsset";

export const RECEIVE_PROCESSOR_NAME = "gryt-receive-dsp-v3";
export const RECEIVE_WORKLET_CODE = RECEIVE_DSP_CODE + `
const EMPTY_CHANNELS = [];
const routes = new Set();
const protectors = new Map();
let runtime;
function sharedRuntime(module) {
  if (!runtime && module) {
    try { runtime = createReceiveAnalyzerRuntime(module); } catch {}
  }
  return runtime;
}
class ReceiveProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {name:"enabled", defaultValue:0, minValue:0, maxValue:1, automationRate:"k-rate"},
      {name:"fastProtection", defaultValue:0, minValue:0, maxValue:1, automationRate:"k-rate"},
      {name:"muted", defaultValue:0, minValue:0, maxValue:1, automationRate:"k-rate"}
    ];
  }
  constructor(options) {
    super();
    const opts = options.processorOptions;
    this.kind = opts.kind;
    this.core = this.kind === "leveler"
      ? new ReceiveLongTermLeveler(sampleRate, sharedRuntime(opts.analyzerModule)) : new ReceiveLimiter(sampleRate);
    this.disposed = false; this.wasMuted = false;
    this.identity = undefined; this.role = "unknown"; this.sequence = 0;
    this.enabled = false; this.muted = false; this.audioTimeSeconds = 0;
    this.lastAcceptedSpeechAudioTimeSeconds = null; this.priorRevision = -1;
    this.routeKey = opts.routeKey;
    if (this.kind === "leveler") routes.add(this);
    else if (this.routeKey !== undefined) protectors.set(this.routeKey, this);
    this.port.onmessage = event => {
      const data = event.data;
      if (data === "dispose") {
        this.disposed = true; routes.delete(this);
        if (protectors.get(this.routeKey) === this) protectors.delete(this.routeKey);
        if (this.kind === "leveler") {
          this.core.destroy();
          if (routes.size === 0) runtime = undefined;
        }
        this.port.close();
      } else if (data?.kind === "configure" && this.kind === "leveler") {
        const old = this.identity, next = data.identity;
        const changed = (!old !== !next) || (old && next &&
          (old.participantId !== next.participantId || old.receiverId !== next.receiverId ||
           old.trackId !== next.trackId || old.generation !== next.generation));
        if (changed) this.sequence = 0;
        const needsReset = changed || this.role !== data.role || this.enabled !== data.enabled || this.muted !== data.muted;
        this.identity = next; this.role = data.role; this.enabled = data.enabled; this.muted = data.muted;
        this.controlRevision = data.controlRevision;
        if (needsReset) { this.core.configure(this.eligible(), sampleRate); this.lastAcceptedSpeechAudioTimeSeconds = null; }
        if (this.eligible() && data.prior && (needsReset || this.priorRevision !== data.priorRevision))
          this.core.controller.importPrior(data.prior);
        else if (this.eligible() && !data.prior && this.priorRevision !== data.priorRevision &&
          this.core.controller.activeSeconds === 0 && this.core.controller.priorRestoring) this.core.reset();
        this.priorRevision = data.priorRevision;
      } else if (data?.kind === "snapshot" && this.kind === "limiter") {
        const snapshots = [];
        for (const route of routes) {
          if (route.disposed || !route.identity) continue;
          if (route.eligible() && !route.core.available && !route.core.fault && route.core.supported)
            route.core.configure(true, sampleRate);
          snapshots.push(route.snapshot());
        }
        this.port.postMessage({kind:"receive-auto-levels", schemaVersion:1, snapshots,
          analyzerFault:[...routes].some(route => route.core.fault)});
      }
    };
  }
  eligible() { return this.enabled && !this.muted && this.role === "microphone" && Boolean(this.identity); }
  snapshot() {
    const c = this.core.controller, reasons = [];
    let unavailable;
    if (!this.enabled) unavailable = "disabled";
    else if (this.role !== "microphone") unavailable = "association_ambiguous";
    else if (!this.core.supported) unavailable = "unsupported_sample_rate";
    else if (!this.core.available || this.muted || this.core.frames === 0) unavailable = "analyzer_unavailable";
    if (unavailable) reasons.push(unavailable);
    else {
      if (c.noiseLimited) reasons.push("noise_budget");
      if (c.rangeLimited) reasons.push("gain_range");
      if (!c.noiseReliable) reasons.push("noise_evidence_missing");
    }
    return {...this.identity, sequence:++this.sequence, audioTimeSeconds:this.audioTimeSeconds,
      controlRevision:this.controlRevision,
      status:unavailable ? "unavailable" : reasons.length ? "limited" : c.settledSeconds >= 2 ? "settled" : "learning",
      limitReasons:reasons, appliedAutoGainDb:unavailable ? null : this.core.appliedDb,
      learnedAutoGainDb:unavailable ? null : c.gainDb, targetAutoGainDb:unavailable ? null : c.desiredDb,
      acceptedSpeechSeconds:c.activeSeconds, speechWindowSeconds:c.energyCount/100,
      estimatorReliability:unavailable ? "invalid" : c.energyCount >= 500 ? "established" : "provisional",
      compressionGainReductionDb:unavailable ? null : -20*Math.log10(protectors.get(this.routeKey)?.core.fastGain || 1),
      speechLevelDbfs:unavailable || !Number.isFinite(c.levelDb) ? null : c.levelDb,
      priorRestoring:c.priorRestoring, priorRejected:c.priorRejected,
      lastAcceptedSpeechAudioTimeSeconds:this.lastAcceptedSpeechAudioTimeSeconds};
  }
  process(inputs, outputs, parameters) {
    if (this.disposed) return false;
    this.audioTimeSeconds = (currentFrame + (outputs[0]?.[0]?.length || 0)) / sampleRate;
    const muted = parameters.muted[0] >= 0.5;
    if (muted) {
      if (!this.wasMuted) { this.core.reset(); this.lastAcceptedSpeechAudioTimeSeconds = null; }
      this.wasMuted = true;
      for (const channel of outputs[0]) channel.fill(0);
      return true;
    }
    this.wasMuted = false;
    const acceptedBefore = this.kind === "leveler" ? this.core.controller.activeSeconds : 0;
    this.core.process(inputs[0] || EMPTY_CHANNELS, outputs[0], parameters.enabled[0] >= 0.5,
      (parameters.fastProtection?.[0] || 0) >= 0.5);
    if (this.kind === "leveler" && this.core.controller.activeSeconds > acceptedBefore)
      this.lastAcceptedSpeechAudioTimeSeconds = this.audioTimeSeconds;
    return true;
  }
}
registerProcessor("${RECEIVE_PROCESSOR_NAME}", ReceiveProcessor);
`;

let analyzerModule: Promise<WebAssembly.Module> | undefined;
function compileAnalyzer(): Promise<WebAssembly.Module> {
  if (analyzerModule) return analyzerModule;
  const bytes = Uint8Array.from(atob(RECEIVE_ANALYZER_BASE64), value => value.charCodeAt(0));
  analyzerModule = WebAssembly.compile(bytes);
  void analyzerModule.catch(() => { analyzerModule = undefined; });
  return analyzerModule;
}
const loads = new WeakMap<BaseAudioContext, Promise<WebAssembly.Module>>();
const workletLoads = new WeakMap<BaseAudioContext, Promise<void>>();
function loadWorklet(context: BaseAudioContext): Promise<void> {
  const pending = workletLoads.get(context);
  if (pending) return pending;
  const url = URL.createObjectURL(new Blob([RECEIVE_WORKLET_CODE], { type: "application/javascript" }));
  const result = Promise.resolve().then(() => context.audioWorklet.addModule(url)).finally(() => URL.revokeObjectURL(url));
  workletLoads.set(context, result);
  void result.catch(() => workletLoads.delete(context));
  return result;
}
export function loadReceiveProcessor(context: BaseAudioContext): Promise<WebAssembly.Module> {
  const pending = loads.get(context);
  if (pending) return pending;
  const result = Promise.all([loadWorklet(context), Promise.resolve().then(compileAnalyzer)])
    .then(([, module]) => module);
  loads.set(context, result);
  void result.catch(() => loads.delete(context));
  return result;
}
