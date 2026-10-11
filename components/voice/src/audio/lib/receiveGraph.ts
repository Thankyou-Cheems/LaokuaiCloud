import { loadReceiveProcessor, RECEIVE_PROCESSOR_NAME } from "../processors/receiveProcessor";
import { RECEIVE_AUTO_LEVEL_TELEMETRY_HZ, type ReceiveAutoLevelBatch, type ReceiveAutoLevelIdentity,
  type ReceiveAutoLevelSnapshot } from "./receiveAutoLevels";
import { validateReceiveLevelPrior, type ReceiveLevelPrior } from "./receiveLevelPrior";

export interface ReceiveLevelingState {
  status: "disabled" | "loading" | "active" | "degraded" | "suspended";
  reason?: string;
  /** Maximum added DSP delay among the currently attached routes, excluding device/WebRTC delay. */
  latencyMs: number;
}
export type ReceiveAudioRole = "microphone" | "screen" | "unknown";
export interface ReceiveStreamControl {
  /** Retires before audio nodes are disconnected; optional for compatible external controls. */
  isCurrent?(): boolean;
  subscribeRetirement?(listener: () => void): () => void;
  setRole(role: ReceiveAudioRole): void;
  setMuted(muted: boolean): void;
  setIdentity(identity: ReceiveAutoLevelIdentity | undefined): void;
  /** Queues a safe historical prior only for this exact current binding; returns false on stale/invalid input. */
  setPrior(prior: ReceiveLevelPrior | undefined, expectedIdentity: ReceiveAutoLevelIdentity): boolean;
  dispose(): void;
}

const controllers = new WeakMap<AudioContext, ReceiveController>();
const CEILING = Math.pow(10, -3 / 20);
const curve = new Float32Array(4097);
const silentCurve = new Float32Array(2);
for (let i = 0; i < curve.length; ++i) {
  const x = 2 * i / (curve.length - 1) - 1;
  curve[i] = Math.max(-CEILING, Math.min(CEILING, x));
}

function disposeNode(node?: AudioWorkletNode) {
  if (!node) return;
  node.onprocessorerror = null;
  node.port.postMessage("dispose");
  node.port.close();
  node.disconnect();
}

function worklet(context: AudioContext, kind: "leveler" | "limiter", enabled: boolean, analyzerModule?: WebAssembly.Module, routeKey?: number, fastProtection = false) {
  return new AudioWorkletNode(context, RECEIVE_PROCESSOR_NAME, {
    numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: "explicit",
    outputChannelCount: [2], parameterData: { enabled: enabled ? 1 : 0, fastProtection: fastProtection ? 1 : 0 },
    processorOptions: { kind, analyzerModule, routeKey },
  });
}

export class ReceiveController {
  readonly bus: GainNode;
  private guard: WaveShaperNode;
  private busLimiter?: AudioWorkletNode;
  private chains = new Set<ReceiveRoute>();
  private listeners = new Set<(state: ReceiveLevelingState) => void>();
  private autoListeners = new Set<(batch: ReceiveAutoLevelBatch) => void>();
  private telemetryTimer?: ReturnType<typeof setInterval>;
  private autoBatch: ReceiveAutoLevelBatch = { kind: "receive-auto-levels", schemaVersion: 1, snapshots: [] };
  analyzerModule?: WebAssembly.Module;
  private timer?: ReturnType<typeof setTimeout>;
  private loading = false;
  private disposed = false;
  private retryMs = 1000;
  private failure?: string;
  private generation = 0;
  private muted = false;
  enabled: boolean;
  state: ReceiveLevelingState;

  constructor(readonly context: AudioContext, enabled: boolean) {
    this.enabled = enabled;
    this.state = { status: enabled ? "loading" : "disabled", latencyMs: 0 };
    this.bus = context.createGain();
    this.guard = context.createWaveShaper();
    this.guard.curve = this.muted ? silentCurve : enabled ? curve : null;
    this.bus.connect(this.guard);
    this.guard.connect(context.destination);
    context.addEventListener("statechange", this.contextChanged);
    if (enabled) void this.recover();
  }

  private contextChanged = () => {
    this.publish();
    this.invalidateAutoLevels();
    if (this.context.state === "running" && this.enabled) void this.recover();
  };

  subscribe(listener: (state: ReceiveLevelingState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }

  subscribeAutoLevels(listener: (batch: ReceiveAutoLevelBatch) => void) {
    this.autoListeners.add(listener); listener(this.autoBatch);
    return () => { this.autoListeners.delete(listener); };
  }

  invalidateAutoLevels(target?: ReceiveRoute) {
    for (const route of this.chains) if (!target || route === target) route.invalidateSnapshot();
    const snapshots = [...this.chains].flatMap(route => route.latestSnapshot ?? []);
    this.autoBatch = { kind: "receive-auto-levels", schemaVersion: 1, snapshots };
    for (const listener of this.autoListeners) listener(this.autoBatch);
  }

  private acceptAutoLevels = (event: MessageEvent<ReceiveAutoLevelBatch>) => {
    if (this.disposed || event.data?.kind !== "receive-auto-levels" || event.data.schemaVersion !== 1) return;
    if (!Array.isArray(event.data.snapshots)) return;
    if ((event.data as ReceiveAutoLevelBatch & { analyzerFault?: boolean }).analyzerFault) {
      this.fail("analyzer-error"); return;
    }
    const snapshots: ReceiveAutoLevelSnapshot[] = [];
    for (const route of this.chains) {
      for (const candidate of event.data.snapshots) if (route.acceptSnapshot(candidate)) break;
      if (route.latestSnapshot) snapshots.push(route.latestSnapshot);
    }
    this.autoBatch = { kind: "receive-auto-levels", schemaVersion: 1, snapshots };
    for (const listener of this.autoListeners) listener(this.autoBatch);
    this.publish();
  };

  private publish() {
    const streamDelay = [...this.chains].some(route => route.healthy) ? 3 : 0;
    const delay = Math.ceil(this.context.sampleRate * 0.003) / this.context.sampleRate * 1000;
    const healthy = Boolean(this.busLimiter) && [...this.chains].every(route => route.healthy);
    const state: ReceiveLevelingState = {
      status: !this.enabled ? "disabled" : this.context.state !== "running" ? "suspended"
        : this.failure || [...this.chains].some(route => route.analyzerReason) ? "degraded"
        : this.loading ? "loading" : healthy ? "active" : "loading",
      latencyMs: (this.busLimiter ? delay : 0) + (streamDelay ? delay : 0),
      reason: this.enabled && this.context.state !== "running" ? "audio-context-" + this.context.state
        : this.enabled ? this.failure ?? [...this.chains].find(route => route.analyzerReason)?.analyzerReason : undefined,
    };
    if (state.status === this.state.status && state.reason === this.state.reason && state.latencyMs === this.state.latencyMs) return;
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  setEnabled(enabled: boolean) {
    if (this.disposed || enabled === this.enabled) return;
    this.enabled = enabled;
    this.guard.curve = this.muted ? silentCurve : enabled ? curve : null;
    this.busLimiter?.parameters.get("enabled")?.setValueAtTime(enabled ? 1 : 0, this.context.currentTime);
    for (const route of this.chains) route.setEnabled(enabled);
    this.invalidateAutoLevels();
    this.publish();
    if (enabled) void this.recover();
  }

  setMuted(muted: boolean) {
    const changed = muted !== this.muted;
    this.muted = muted;
    this.guard.curve = muted ? silentCurve : this.enabled ? curve : null;
    this.busLimiter?.parameters.get("muted")?.setValueAtTime(muted ? 1 : 0, this.context.currentTime);
    if (changed) {
      for (const route of this.chains) route.applyMute();
      this.invalidateAutoLevels();
    }
  }
  get globallyMuted() { return this.muted; }

  attach(input: AudioNode, manual: GainNode): ReceiveRoute {
    const route = new ReceiveRoute(this, input, manual);
    this.chains.add(route);
    this.publish();
    if (this.enabled || this.busLimiter) void this.recover();
    return route;
  }

  remove(route: ReceiveRoute) {
    this.chains.delete(route);
    this.invalidateAutoLevels(route);
    this.publish();
  }

  fail(reason: string) {
    if (this.disposed) return;
    ++this.generation;
    this.failure = reason;
    // Drop all adaptive gain when any worklet dies; the surviving clamp limits the summed bus.
    for (const route of this.chains) route.fallback();
    this.invalidateAutoLevels();
    this.bus.disconnect();
    disposeNode(this.busLimiter);
    this.busLimiter = undefined;
    this.bus.connect(this.guard);
    this.publish();
    this.scheduleRetry();
  }

  private scheduleRetry() {
    if (this.timer || this.disposed || !this.enabled) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.recover();
    }, this.retryMs);
    this.retryMs = Math.min(30000, this.retryMs * 2);
  }

  async recover() {
    if (this.disposed || this.loading || this.context.state === "closed") return;
    if (this.busLimiter && [...this.chains].every(route => route.healthy)) return;
    const generation = this.generation;
    this.loading = true;
    this.publish();
    try {
      this.analyzerModule = await loadReceiveProcessor(this.context);
      if (this.disposed || generation !== this.generation) return;
      if (!this.busLimiter) {
        const limiter = worklet(this.context, "limiter", this.enabled);
        limiter.onprocessorerror = () => this.fail("bus-processor-error");
        limiter.port.onmessage = event => { if (this.busLimiter === limiter) this.acceptAutoLevels(event); };
        this.bus.disconnect();
        this.bus.connect(limiter);
        limiter.connect(this.guard);
        this.busLimiter = limiter;
        this.setMuted(this.muted);
        if (!this.telemetryTimer) this.telemetryTimer = setInterval(() => {
          if (this.context.state === "running") this.busLimiter?.port.postMessage({ kind: "snapshot" });
        }, 1000 / RECEIVE_AUTO_LEVEL_TELEMETRY_HZ);
      }
      for (const route of this.chains) if (!route.healthy) route.activate();
      this.failure = undefined;
      this.retryMs = 1000;
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
    } catch {
      this.fail("worklet-unavailable");
    } finally {
      this.loading = false;
      this.publish();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
    this.context.removeEventListener("statechange", this.contextChanged);
    for (const route of [...this.chains]) route.dispose();
    this.bus.disconnect();
    disposeNode(this.busLimiter);
    this.guard.disconnect();
    this.listeners.clear();
    this.autoListeners.clear();
    controllers.delete(this.context);
  }
}

let nextRouteKey = 0;
export class ReceiveRoute implements ReceiveStreamControl {
  private retirement = new Set<() => void>();
  isCurrent(): boolean { return !this.disposed; }
  subscribeRetirement(listener: () => void): () => void {
    if (this.disposed) { listener(); return () => {}; }
    this.retirement.add(listener); return () => { this.retirement.delete(listener); };
  }
  private readonly routeKey = ++nextRouteKey;
  private leveler?: AudioWorkletNode;
  private limiter?: AudioWorkletNode;
  private guard: WaveShaperNode;
  private fallbackGain: GainNode;
  private disposed = false;
  private role: ReceiveAudioRole = "unknown";
  private muted = false;
  private identity?: ReceiveAutoLevelIdentity;
  private previousIdentity?: ReceiveAutoLevelIdentity;
  private sequence = 0;
  private workletSequence = 0;
  private controlRevision = 0;
  private prior?: ReceiveLevelPrior;
  private priorRevision = 0;
  latestSnapshot?: ReceiveAutoLevelSnapshot;
  analyzerReason?: string;
  get healthy() { return Boolean(this.leveler && this.limiter); }

  constructor(private owner: ReceiveController, private input: AudioNode, private manual: GainNode) {
    this.guard = owner.context.createWaveShaper();
    this.fallbackGain = owner.context.createGain();
    this.guard.connect(owner.bus);
    this.fallback();
  }
  setEnabled(enabled: boolean) {
    this.guard.curve = this.effectivelyMuted ? silentCurve : enabled ? curve : null;
    this.fallbackGain.gain.setTargetAtTime(enabled ? 0.5 : 1, this.owner.context.currentTime, 0.005);
    this.leveler?.parameters.get("enabled")?.setValueAtTime(enabled && this.role === "microphone" ? 1 : 0, this.owner.context.currentTime);
    this.limiter?.parameters.get("enabled")?.setValueAtTime(enabled ? 1 : 0, this.owner.context.currentTime);
    this.limiter?.parameters.get("fastProtection")?.setValueAtTime(enabled && this.role === "microphone" ? 1 : 0, this.owner.context.currentTime);
    this.configure();
  }
  private configure() {
    this.analyzerReason = undefined;
    ++this.controlRevision;
    this.leveler?.port.postMessage({ kind: "configure", identity: this.identity, role: this.role,
      enabled: this.owner.enabled, muted: this.effectivelyMuted, controlRevision: this.controlRevision,
      prior: this.prior, priorRevision: this.priorRevision });
  }
  setIdentity(identity: ReceiveAutoLevelIdentity | undefined) {
    if (identity && (!identity.participantId || !identity.receiverId || !identity.trackId ||
      !Number.isSafeInteger(identity.generation) || identity.generation < 0)) identity = undefined;
    if (identity && this.previousIdentity?.receiverId === identity.receiverId && identity.generation < this.previousIdentity.generation) return;
    const old = this.identity;
    if (old && identity && old.participantId === identity.participantId && old.receiverId === identity.receiverId &&
      old.trackId === identity.trackId && old.generation === identity.generation) return;
    this.identity = identity ? { ...identity } : undefined;
    this.prior = undefined; ++this.priorRevision;
    if (identity) {
      const prior = this.previousIdentity;
      if (!prior || prior.receiverId !== identity.receiverId || prior.participantId !== identity.participantId ||
        prior.trackId !== identity.trackId || prior.generation !== identity.generation) this.sequence = 0;
      this.previousIdentity = { ...identity };
    }
    this.workletSequence = 0;
    this.configure(); this.owner.invalidateAutoLevels(this);
  }
  setPrior(prior: ReceiveLevelPrior | undefined, expectedIdentity: ReceiveAutoLevelIdentity): boolean {
    const id = this.identity;
    if (!id || id.participantId !== expectedIdentity.participantId || id.receiverId !== expectedIdentity.receiverId ||
      id.trackId !== expectedIdentity.trackId || id.generation !== expectedIdentity.generation || this.disposed ||
      (this.latestSnapshot?.acceptedSpeechSeconds ?? 0) > 0) return false;
    const safe = prior === undefined ? undefined : validateReceiveLevelPrior(prior);
    if (prior !== undefined && !safe) return false;
    this.prior = safe; ++this.priorRevision; this.configure();
    this.owner.invalidateAutoLevels(this);
    return true;
  }
  unknownSnapshot(): ReceiveAutoLevelSnapshot | undefined {
    if (!this.identity) return;
    return { ...this.identity, sequence: this.sequence, audioTimeSeconds: this.owner.context.currentTime,
      status: "unavailable", limitReasons: [this.owner.enabled ? "analyzer_unavailable" : "disabled"],
      appliedAutoGainDb: null, learnedAutoGainDb: null, targetAutoGainDb: null,
      acceptedSpeechSeconds: 0, speechWindowSeconds: 0, estimatorReliability: "invalid", compressionGainReductionDb: null,
      speechLevelDbfs: null, priorRestoring: false, priorRejected: false, lastAcceptedSpeechAudioTimeSeconds: null };
  }
  invalidateSnapshot() {
    ++this.sequence;
    this.latestSnapshot = this.unknownSnapshot();
  }
  acceptSnapshot(snapshot: ReceiveAutoLevelSnapshot) {
    const identity = this.identity;
    if (!identity || snapshot.participantId !== identity.participantId || snapshot.receiverId !== identity.receiverId ||
      snapshot.trackId !== identity.trackId || snapshot.generation !== identity.generation || snapshot.sequence <= this.workletSequence) return false;
    if ((snapshot as ReceiveAutoLevelSnapshot & { controlRevision?: number }).controlRevision !== this.controlRevision) return false;
    if (this.owner.context.state !== "running") return false;
    if ((!this.owner.enabled || this.effectivelyMuted || this.role !== "microphone") && snapshot.status !== "unavailable") return false;
    if (!Number.isFinite(snapshot.audioTimeSeconds) || !Array.isArray(snapshot.limitReasons)) return false;
    this.workletSequence = snapshot.sequence;
    this.latestSnapshot = { ...snapshot, sequence: ++this.sequence };
    this.analyzerReason = this.role === "microphone" && this.owner.enabled && !this.effectivelyMuted &&
      snapshot.status === "unavailable" ? snapshot.limitReasons[0] : undefined;
    return true;
  }
  setRole(role: ReceiveAudioRole) {
    if (role === this.role) return;
    this.role = role;
    this.setEnabled(this.owner.enabled);
    this.owner.invalidateAutoLevels(this);
  }
  setMuted(muted: boolean) {
    if (muted === this.muted) return;
    this.muted = muted;
    this.applyMute();
    this.owner.invalidateAutoLevels(this);
  }
  private get effectivelyMuted() { return this.muted || this.owner.globallyMuted; }
  applyMute() {
    this.setEnabled(this.owner.enabled);
    for (const node of [this.leveler, this.limiter]) {
      node?.parameters.get("muted")?.setValueAtTime(this.effectivelyMuted ? 1 : 0, this.owner.context.currentTime);
    }
  }
  fallback() {
    if (this.disposed) return;
    this.input.disconnect();
    this.manual.disconnect();
    this.fallbackGain.disconnect();
    disposeNode(this.leveler);
    disposeNode(this.limiter);
    this.leveler = this.limiter = undefined;
    this.workletSequence = 0;
    this.fallbackGain.gain.value = this.owner.enabled ? 0.5 : 1;
    this.input.connect(this.fallbackGain);
    this.fallbackGain.connect(this.manual);
    this.manual.connect(this.guard);
    this.setEnabled(this.owner.enabled);
  }
  activate() {
    if (this.disposed || this.healthy) return;
    const context = this.owner.context;
    let leveler: AudioWorkletNode | undefined;
    let limiter: AudioWorkletNode | undefined;
    try {
      leveler = worklet(context, "leveler", this.owner.enabled && this.role === "microphone", this.owner.analyzerModule, this.routeKey);
      limiter = worklet(context, "limiter", this.owner.enabled, undefined, this.routeKey, this.role === "microphone");
      leveler.onprocessorerror = limiter.onprocessorerror = () => this.owner.fail("stream-processor-error");
      this.input.disconnect();
      this.fallbackGain.disconnect();
      this.manual.disconnect();
      this.input.connect(leveler);
      leveler.connect(this.manual);
      this.manual.connect(limiter);
      limiter.connect(this.guard);
      this.leveler = leveler;
      this.limiter = limiter;
      this.applyMute();
    } catch (error) {
      disposeNode(leveler);
      disposeNode(limiter);
      this.fallback();
      throw error;
    }
  }
  dispose() {
    if (this.disposed) return;
    for (const listener of this.retirement) { try { listener(); } catch { /* Continue physical cleanup. */ } }
    this.retirement.clear();
    this.disposed = true;
    this.input.disconnect();
    this.manual.disconnect();
    this.fallbackGain.disconnect();
    this.guard.disconnect();
    disposeNode(this.leveler);
    disposeNode(this.limiter);
    this.owner.remove(this);
  }
}

export function getReceiveController(context: AudioContext, enabled = false) {
  let controller = controllers.get(context);
  if (!controller) {
    controller = new ReceiveController(context, enabled);
    controllers.set(context, controller);
  }
  return controller;
}
