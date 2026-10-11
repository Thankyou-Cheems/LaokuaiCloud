import { loadTransmitCapture, TRANSMIT_BOUNDARY_NAME } from "../processors/transmitCaptureProcessor";

export interface TransmissionState {
  status: "disabled" | "ready" | "suppressed" | "recovering" | "suspended" | "failed";
  reason?: string;
  generation: number;
  /** Actual final gate eligibility; does not infer speech or delivery at the SFU. */
  publicationAllowed?: boolean;
  /** Last revision actually acknowledged by the final audio boundary. */
  publicationRevision?: number;
  /** That actual acknowledgement matches the current requested control revision. */
  publicationAcknowledged?: boolean;
  /** Actual blocked value in the last accepted boundary acknowledgement. */
  publicationBlocked?: boolean;
}
export interface TransmissionReasons {
  userMuted: boolean;
  serverMuted: boolean;
  pttRequired: boolean;
  pttHeld: boolean;
}

/** Stable publication boundary; a release never writes the user's mute or PTT state. */
export class TransmissionController {
  readonly destination: MediaStreamAudioDestinationNode;
  readonly gate: GainNode;
  readonly stream: MediaStream;
  generation = 0;
  enabled = false;
  private held = false;
  private pending = false;
  private ready = false;
  private disposed = false;
  private failure?: string;
  private input?: AudioNode;
  private evidence?: AudioWorkletNode;
  private speechEnabled=false;
  private speechEligible=false;
  private speechListener?: (speaking: boolean, available: boolean) => void;
  private attachment = 0;
  private boundary?: AudioWorkletNode;
  private boundaryLoad?: Promise<void>;
  private revision = 0;
  private acknowledged = -1;
  private acknowledgedBlocked?: boolean;
  private lastBlocked?: boolean;
  private cancelRecovery?: () => void;
  private listeners = new Set<(state: TransmissionState) => void>();
  private reasons: TransmissionReasons = { userMuted: false, serverMuted: false, pttRequired: false, pttHeld: false };
  state: TransmissionState = { status: "disabled", generation: 0 };

  constructor(readonly context: AudioContext, private fresh: (generation: number) => Promise<void>,
    private createBoundary = async (ctx: AudioContext) => {
      await loadTransmitCapture(ctx);
      return new AudioWorkletNode(ctx, TRANSMIT_BOUNDARY_NAME,{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[1],channelCount:2,channelCountMode:"explicit"});
    }) {
    this.destination = context.createMediaStreamDestination();
    this.stream = this.destination.stream;
    this.gate = context.createGain();
    this.gate.gain.value = 0;
    this.gate.connect(this.destination);
    context.addEventListener("statechange", this.contextChanged);
  }
  private contextChanged = () => {
    if (this.context.state === "running" && this.pending && !this.held) this.retry();
    else this.apply();
  };
  subscribe(listener: (state: TransmissionState) => void) {
    this.listeners.add(listener); listener(this.state);
    return () => { this.listeners.delete(listener); };
  }
  setSpeechControl(enabled: boolean, eligible: boolean, listener?: (speaking: boolean, available: boolean) => void) {
    this.speechListener=listener;
    if(this.speechEnabled===enabled && this.speechEligible===eligible)return;
    const leavingSpeech=this.speechEnabled && !enabled;
    const wasEligible=this.speechEnabled && this.speechEligible;
    this.speechEnabled=enabled;this.speechEligible=eligible;
    if(!eligible)this.speechListener?.(false,true);
    this.lastBlocked=undefined;
    if(enabled)this.ensureBoundary();
    if(this.pending && (leavingSpeech || (enabled && !eligible && !this.failure))) {
      ++this.generation;this.cancelRecovery?.();this.pending=false;
      if(leavingSpeech && this.enabled && !this.held && !this.failure) {this.recover();return;}
    }
    if(enabled && eligible && !wasEligible && this.ready && !this.pending && !this.held && !this.failure) {
      this.recover();return;
    }
    this.apply();
  }
  setReasons(reasons: TransmissionReasons) { this.reasons = reasons; this.apply(); }
  attach(input: AudioNode, fresh: Promise<void> = Promise.resolve(), evidence?: AudioWorkletNode) {
    this.detach(); const attachment = ++this.attachment;
    this.input = input; input.connect(this.gate); this.evidence=evidence;
    if(this.boundary && evidence)evidence.connect(this.boundary,1,1);
    void fresh.then(() => {
      if (this.disposed || attachment !== this.attachment) return;
      this.ready = true; this.apply();
    }, () => { if (attachment === this.attachment) this.fail("capture-barrier-failed"); });
  }
  detach() {
    ++this.attachment;
    this.ready = false;
    if (this.input) { try { this.input.disconnect(this.gate); } catch { /* Already detached. */ } }
    if(this.evidence && this.boundary) {try{this.evidence.disconnect(this.boundary,1,1);}catch{/* Detached. */}}
    this.evidence=undefined;this.speechListener?.(false,true);
    this.input = undefined; this.apply();
  }
  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) this.ensureBoundary();
    if (!enabled && (this.held || this.pending || this.failure)) { this.held = false; this.retry(); }
    else this.apply();
  }
  private ensureBoundary() {
    if (this.boundary || this.boundaryLoad || this.disposed) return;
    this.boundaryLoad = this.createBoundary(this.context).then(node => {
      if (this.disposed) { node.port.postMessage('dispose'); node.port.close(); node.disconnect(); return; }
      this.boundary = node; this.gate.disconnect(this.destination);
      this.gate.connect(node); node.connect(this.destination);
      this.evidence?.connect(node,1,1);
      node.onprocessorerror = () => {
        if(this.boundary !== node)return;
        node.port.onmessage = null;
        this.acknowledged = -1; this.acknowledgedBlocked = undefined;
        this.fail("transmission-processor-error");
      };
      node.port.onmessage = event => {
        if(this.boundary !== node)return;
        const data = event.data;
        if(data.type==='speech' && data.revision===this.revision && this.speechEnabled) {
          this.speechListener?.(data.speaking===true && this.speechEligible && this.state.publicationAllowed===true,data.available===true);
        }
        if (data.type === 'boundary'  && data.revision === this.revision && data.blocked === this.lastBlocked) {
          this.acknowledged = data.revision; this.acknowledgedBlocked = data.blocked; this.apply();
        }
      };
      this.lastBlocked = undefined; this.apply();
    }, () => this.fail("transmission-worklet-load-failed")).finally(() => { this.boundaryLoad = undefined; });
  }
  setSuppressed(held: boolean) {
    if (this.disposed || (!this.enabled && held) || held === this.held) return;
    this.held = held;
    if (held) { ++this.generation; this.cancelRecovery?.(); this.pending = false; this.apply(); }
    else this.retry();
  }
  retry() {
    if (this.boundary && this.failure === "transmission-processor-error") {
      this.boundary.port.postMessage('dispose'); this.boundary.port.close(); this.boundary.disconnect();
      this.gate.disconnect(); this.gate.connect(this.destination); this.boundary = undefined;
      this.acknowledged = -1; this.acknowledgedBlocked = undefined;
    }
    this.ensureBoundary();
    if (!this.disposed && !this.held) this.recover();
  }
  fail(reason: string) { ++this.generation; this.cancelRecovery?.(); this.failure = reason; this.pending = true; this.apply(); }
  private recover() {
    const generation = ++this.generation;
    this.cancelRecovery?.();
    this.pending = true; this.failure = undefined; this.apply();
    if (this.context.state !== "running") return;
    let timer: ReturnType<typeof setTimeout>;
    let cancel: () => void;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("fresh-audio-timeout")), 10000);
      cancel = () => { clearTimeout(timer!); reject(new Error("fresh-audio-superseded")); };
    });
    this.cancelRecovery = cancel!;
    void Promise.race([Promise.resolve().then(() => this.fresh(generation)), timeout]).then(() => {
      if (this.disposed || generation !== this.generation || this.held) return;
      this.pending = false; this.failure = undefined; this.apply();
    }, error => {
      if (!this.disposed && generation === this.generation && !this.held) {
        this.failure = error instanceof Error ? error.message : "fresh-audio-failed";
        this.apply();
      }
    }).finally(() => { clearTimeout(timer!); if (this.cancelRecovery === cancel) this.cancelRecovery = undefined; });
  }
  private apply() {
    if (this.disposed) return;
    const running = this.context.state === "running";
    const blocked = !running || !this.ready || this.held || this.pending || !!this.failure || ((this.enabled || this.speechEnabled) && !this.boundary)
      || (this.speechEnabled && !this.speechEligible)
      || this.reasons.userMuted || this.reasons.serverMuted || (this.reasons.pttRequired && !this.reasons.pttHeld);
    this.gate.gain.cancelScheduledValues(this.context.currentTime);
    this.gate.gain.setValueAtTime(blocked ? 0 : 1, this.context.currentTime);
    if (this.boundary && this.lastBlocked !== blocked) {
      this.lastBlocked = blocked; ++this.revision;
      this.boundary.port.postMessage({revision:this.revision,blocked,speechEligible:this.speechEligible,speechEnabled:this.speechEnabled});
    }
    const applied = !!this.boundary && this.acknowledged === this.revision;
    const state: TransmissionState = {
      status: (this.enabled || this.pending) && !running ? "suspended" : this.failure ? "failed"
        : this.held ? applied && blocked ? "suppressed" : "recovering" : this.pending ? "recovering"
          : !this.enabled ? "disabled" : this.ready && applied ? "ready" : "recovering",
      reason: !running && (this.enabled || this.pending) ? "audio-context-" + this.context.state
        : this.failure || (this.enabled && !this.boundary ? "transmission-gate-loading"
          : this.held && !applied ? "awaiting-suppression-ack" : !this.ready && this.enabled ? "awaiting-capture"
            : this.enabled && !applied ? "awaiting-transmission-ack" : undefined),
      generation: this.generation,
      publicationAllowed: !blocked && (!(this.enabled || this.speechEnabled) || applied),
      publicationRevision: this.acknowledged >= 0 ? this.acknowledged : undefined,
      publicationAcknowledged: applied,
      publicationBlocked: this.acknowledgedBlocked,
    };
    if (JSON.stringify(state) === JSON.stringify(this.state)) return;
    this.state = state; for (const listener of this.listeners) listener(state);
  }
  dispose() {
    if (this.disposed) return;
    this.detach(); this.gate.gain.value = 0; this.disposed = true; ++this.generation; this.cancelRecovery?.();
    this.context.removeEventListener("statechange", this.contextChanged);
    this.gate.disconnect(); this.destination.disconnect();
    this.boundary?.port.postMessage('dispose'); this.boundary?.port.close(); this.boundary?.disconnect();
    for (const track of this.stream.getTracks()) track.stop();
    this.listeners.clear();
  }
}

