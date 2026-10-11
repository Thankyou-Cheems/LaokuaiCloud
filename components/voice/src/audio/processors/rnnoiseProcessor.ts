const RNNOISE_WORKLET_NAME = 'rnnoise-processor';
const MAX_OUTPUT_QUEUE = 8;

const WORKLET_CODE = /* js */ `
class RNNoiseWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {return [
    {name:"allowed",defaultValue:1,minValue:0,maxValue:1,automationRate:"k-rate"},
    {name:"evidenceEnabled",defaultValue:0,minValue:0,maxValue:1,automationRate:"k-rate"}];}
  constructor(options) {
    super(options);
    this._allowed=true;this._freshToken=0;
    this._FRAME = 480;
    this._in = new Float32Array(this._FRAME);
    this._inIdx = 0;
    this._outQ = [];
    this._outFrame = null;
    this._outIdx = 0;
    this._on = false;
    this._workerPort = null;
    this._generation = 0;
    this._waiting = false;
    this._fresh = true;

    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'worker-port') {
        this._workerPort = e.ports[0];
        this._workerPort.onmessage = (ev) => {
          if (ev.data.type === 'processed') {
            if (ev.data.generation !== this._generation || this._waiting) return;
            if (this._outQ.length >= ${MAX_OUTPUT_QUEUE}) this._outQ.shift();
            this._outQ.push({pcm:new Float32Array(ev.data.frame), probability:ev.data.probability, rmsDbfs:ev.data.rmsDbfs,
              valid:ev.data.valid, sequence:ev.data.sequence});
          } else if(ev.data.type==='fault' && ev.data.generation===this._generation) {
            this._outQ.length=0;this._outFrame=null;this._waiting=true;
            this.port.postMessage({type:'fault',reason:ev.data.reason});
          } else if (ev.data.type === 'reset-ack'  && ev.data.generation === this._generation) {
            this._waiting = false;
          }
        };
        if(this._waiting)this._workerPort.postMessage({type:'reset',generation:this._generation});
      } else if (d.type === 'enable') {
        this._on = d.enabled;
        if (!d.enabled) {
          this._outQ.length = 0;
          this._outFrame = null;
          this._outIdx = 0;
        }
      } else if (d.type === 'reset-transmission') {
        this._freshToken=d.generation; this._generation=Math.max(this._generation+1,d.generation);
        this._in.fill(0); this._inIdx = 0;
        this._outQ.length = 0; this._outFrame = null; this._outIdx = 0;
        this._waiting = true; this._fresh = false;
        this._workerPort?.postMessage({type:'reset', generation:this._generation});
      }
    };
  }

  process(inputs, outputs, parameters) {
    const allowed=parameters?.allowed?.[0]>=0.5;
    if(parameters?.evidenceEnabled?.[0]>=0.5 && allowed!==this._allowed) {
      this._allowed=allowed;this._generation++;this._in.fill(0);this._inIdx=0;
      this._outQ.length=0;this._outFrame=null;this._outIdx=0;this._waiting=true;
      this._workerPort?.postMessage({type:'reset',generation:this._generation});
    }
    const src = inputs[0] && inputs[0][0];
    const dst = outputs[0] && outputs[0][0];
    const evidence = outputs[1];
    if (evidence) for (const channel of evidence) channel.fill(0);
    if (!src || !dst) return true;

    if (!this._on) {
      dst.set(src);
      return true;
    }

    if (this._waiting) { dst.fill(0); return true; }

    if (this._workerPort) {
      for (let i = 0; i < src.length; i++) {
        this._in[this._inIdx++] = src[i];
        if (this._inIdx >= this._FRAME) {
          const buf = this._in;
          this._in = new Float32Array(this._FRAME);
          this._inIdx = 0;
          this._workerPort.postMessage({ type: 'frame', frame: buf.buffer, generation:this._generation }, [buf.buffer]);
        }
      }
    }

    for (let i = 0; i < dst.length; i++) {
      if (!this._outFrame || this._outIdx >= this._FRAME) {
        if (this._outQ.length > 0) {
          this._outFrame = this._outQ.shift();
          this._outIdx = 0;
        } else {
          dst[i] = 0;
          continue;
        }
      }
      dst[i] = this._outFrame.pcm[this._outIdx++];
      if (evidence && sampleRate === 48000 && this._outFrame.valid) {
        evidence[0][i] = this._outFrame.probability; evidence[1][i] = this._outFrame.rmsDbfs;
        evidence[2][i] = 1; evidence[3][i] = this._outFrame.sequence;
      }
      if (!this._fresh) {
        this._fresh = true;
        this.port.postMessage({type:'fresh', generation:this._freshToken});
      }
    }

    return true;
  }
}
registerProcessor('${RNNOISE_WORKLET_NAME}', RNNoiseWorkletProcessor);
`;

export const RNNOISE_WORKLET_CODE = WORKLET_CODE;
const registered = new WeakMap<BaseAudioContext, Promise<void>>();

async function ensureWorkletRegistered(ctx: AudioContext): Promise<void> {
  const old = registered.get(ctx); if (old) return old;
  const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const result = Promise.resolve().then(() => ctx.audioWorklet.addModule(url)).finally(() => URL.revokeObjectURL(url));
  registered.set(ctx, result); void result.catch(() => registered.delete(ctx)); return result;
}

export class RNNoiseProcessor {
  private node: AudioWorkletNode | null = null;
  private worker: Worker | null = null;
  private enabled = false;
  private generation = 0;
  private reset?: { resolve(): void; reject(error: Error): void; generation: number };
  private failureListener?: (reason: string) => void;
  setFailureListener(listener: (reason: string) => void) { this.failureListener = listener; }

  async initialize(audioContext: AudioContext): Promise<void> {
    await ensureWorkletRegistered(audioContext);

    this.node = new AudioWorkletNode(audioContext, RNNOISE_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 2,
      outputChannelCount: [1, 4],
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    this.node.port.onmessage = event => {
      if(event.data.type==='fault') {
        this.reset?.reject(new Error(event.data.reason));this.reset=undefined;
        this.failureListener?.(event.data.reason);return;
      }
      const pending = this.reset;
      if (pending && event.data.type === 'fresh' && event.data.generation === pending.generation) {
        pending.resolve(); this.reset = undefined;
      }
    };
    this.node.onprocessorerror = () => {
      this.reset?.reject(new Error('rnnoise-processor-error')); this.reset = undefined;
      this.failureListener?.('rnnoise-processor-error');
    };

    // .js, not .ts, because this string survives compilation unchanged. A .ts path points at
    // nothing in dist, and the consumer's bundler fails after publish has already passed.
    this.worker = new Worker(
      new URL('./rnnoiseWorker.js', import.meta.url),
      { type: 'module' },
    );
    this.worker.onerror = () => {
      this.reset?.reject(new Error('rnnoise-worker-error')); this.reset = undefined;
      this.failureListener?.('rnnoise-worker-error');
    };

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('RNNoise worker init timeout')),
        15_000,
      );
      this.worker!.onmessage = (e) => {
        if (e.data.type === 'ready') {
          clearTimeout(timeout);
          resolve();
        } else if (e.data.type === 'error') {
          clearTimeout(timeout);
          this.failureListener?.("rnnoise-worker-error");
          reject(new Error(e.data.message));
        }
      };
      this.worker!.postMessage({ type: 'init' });
    });

    // Direct worklet↔worker channel so audio frames never touch the main thread
    const channel = new MessageChannel();
    this.node.port.postMessage({ type: 'worker-port' }, [channel.port1]);
    this.worker.postMessage({ type: 'worker-port' }, [channel.port2]);
  }

  getSpeechEvidenceOutput(): number { return 1; }

  getNode(): AudioWorkletNode | null {
    return this.node;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.node?.port.postMessage({ type: 'enable', enabled });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  resetForTransmission(): Promise<void> {
    if (!this.node || !this.worker || !this.enabled) return Promise.reject(new Error('rnnoise-unavailable'));
    this.reset?.reject(new Error('fresh-audio-superseded'));
    const generation = ++this.generation;
    return new Promise<void>((resolve, reject) => {
      this.reset = { resolve, reject, generation };
      this.node!.port.postMessage({type:'reset-transmission', generation});
    });
  }

  destroy(): void {
    this.reset?.reject(new Error('rnnoise-destroyed')); this.reset = undefined;
    this.enabled = false;
    this.worker?.postMessage({ type: 'destroy' });
    this.worker?.terminate();
    this.worker = null;
    try { this.node?.disconnect(); this.node?.port.close(); } catch { /* already disconnected */ }
    this.node = null;
  }
}
