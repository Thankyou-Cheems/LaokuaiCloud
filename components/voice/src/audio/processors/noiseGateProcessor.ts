import { TRANSMIT_SPEECH_CORE_CODE } from "./transmitSpeechCode";
/* On the audio thread, not the main one: requestAnimationFrame stops when the window is
   hidden, so the old gate force-opened while minimised and recipients heard it (GRYT-18). */

export const NOISE_GATE_WORKLET_NAME = "noise-gate-processor";

/** AnalyserNode's default dB window, which the previous implementation used. */
const MIN_DECIBELS = -100;
const MAX_DECIBELS = -30;

/** Gain ramp applied on open/close, matching the old 10 ms linear ramp. */
const RAMP_SECONDS = 0.01;

export const NOISE_GATE_WORKLET_CODE = TRANSMIT_SPEECH_CORE_CODE + /* js */ `
const MIN_DB = ${MIN_DECIBELS};
const MAX_DB = ${MAX_DECIBELS};
const DB_RANGE = MAX_DB - MIN_DB;
const RAMP_SECONDS = ${RAMP_SECONDS};

class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // 0-100, matching the existing user-facing setting.
      { name: 'threshold', defaultValue: 0, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
      // Milliseconds to hold the gate open after the signal drops below threshold.
      { name: 'release', defaultValue: 300, minValue: 0, maxValue: 10000, automationRate: 'k-rate' },
      // Level smoothing, equivalent to AnalyserNode.smoothingTimeConstant.
      { name: 'smoothing', defaultValue: 0.8, minValue: 0, maxValue: 0.99, automationRate: 'k-rate' },
      { name: 'automatic', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'eligible', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'evidenceEnabled', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super(options);
    this._level = 0;        // smoothed level, 0-100
    this._gain = 1;         // gain actually applied right now
    this._open = true;      // logical gate state
    this._holdUntil = 0;    // currentTime to hold open until
    this._reported = null;  // last state posted to the main thread
    this._blocks = 0;       // blocks since the last level message
    this._evidence={probability:0,rmsDbfs:-120,valid:true,nonzero:false};this._probability=null;this._adaptive = new AdaptiveTransmitGate(); this._sequence = -1; this._eligible = false;
    this.port.onmessage = e => { if(e.data==='reset-evidence') {this._adaptive.reset();this._sequence=-1;} };
  }

  // UI/debug only. Nothing in the audio path may depend on these being read.
  _report(open) {
    if (this._reported === open) return;
    this._reported = open;
    this.port.postMessage({ type: 'gate', open: open, level: this._level });
  }

  // The UI needs the same level the gate decides on, otherwise the meter and
  // the gate disagree and the threshold looks wrong. ~21 ms at 48 kHz.
  _reportLevel() {
    if (++this._blocks < 8) return;
    this._blocks = 0;
    this.port.postMessage({ type: 'level', open: this._open, level: this._level });
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!output || output.length === 0) return true;

    // Input 1 is the pre-processing tap used for detection, measured before RNNoise as the
    // old code did. Falls back to the gated signal if the tap is not connected.
    const detectInput = inputs[1] && inputs[1].length ? inputs[1] : input;
    const detectCh = detectInput && detectInput[0];

    const threshold = parameters.threshold[0];
    const releaseMs = parameters.release[0];
    const smoothing = parameters.smoothing[0];

    // A threshold of 0 means "no gating" — used for push-to-talk, where
    // muteGain does the gating instead. Stay fully open and cheap.
    const bypass = threshold <= 0;

    // Track the level even when bypassed, so the UI meter still works in
    // push-to-talk mode where the gate itself is disabled.
    if (detectCh && detectCh.length) {
      let sum = 0;
      for (let i = 0; i < detectCh.length; i++) {
        sum += detectCh[i] * detectCh[i];
      }
      const rms = Math.sqrt(sum / detectCh.length);

      // Linear RMS -> dBFS -> 0-100 over the same window the AnalyserNode used.
      const db = rms > 0 ? 20 * Math.log10(rms) : MIN_DB;
      const clamped = db < MIN_DB ? MIN_DB : db > MAX_DB ? MAX_DB : db;
      const instant = ((clamped - MIN_DB) / DB_RANGE) * 100;

      this._level = smoothing * this._level + (1 - smoothing) * instant;
    }

    if (bypass) {
      this._open = true;
    } else if (detectCh && detectCh.length) {
      if (this._level >= threshold) {
        this._open = true;
        this._holdUntil = currentTime + releaseMs / 1000;
      } else if (this._open && currentTime >= this._holdUntil) {
        this._open = false;
      }
    }

    this._report(this._open);
    this._reportLevel();

    const target = this._open ? 1 : 0;
    // Per-sample ramp so open/close doesn't click.
    const step = (1 / (RAMP_SECONDS * sampleRate));

    const frames = output[0].length;
    const channels = output.length;
    const carrier = outputs[1], evidence = inputs[2];
    const enabled = parameters.evidenceEnabled?.[0] >= 0.5;
    const eligible = parameters.eligible?.[0] >= 0.5;
    const automatic = parameters.automatic?.[0] >= 0.5;
    if(carrier) for(const channel of carrier)channel.fill(0);
    if(eligible!==this._eligible) {this._adaptive.reset();this._sequence=-1;this._eligible=eligible;}

    for (let i = 0; i < frames; i++) {
      const valid = enabled && evidence?.[2]?.[i] >= 0.5;
      if(valid && evidence[3][i]!==this._sequence) {
        this._sequence=evidence[3][i];this._probability=evidence[0][i];
        this._evidence.probability=evidence[0][i];this._evidence.rmsDbfs=evidence[1][i];this._evidence.nonzero=evidence[1][i]>-120;
        this._adaptive.process(this._evidence,eligible,releaseMs);
      }
      const actualTarget = automatic ? (eligible && valid && this._adaptive.open ? 1 : 0) : target;
      if (this._gain < actualTarget) {
        this._gain = Math.min(actualTarget, this._gain + step);
      } else if (this._gain > actualTarget) {
        this._gain = Math.max(actualTarget, this._gain - step);
      }

      for (let c = 0; c < channels; c++) {
        const src = input && input[c];
        const value=src ? src[i]*this._gain : 0;
        output[c][i] = enabled ? (Number.isFinite(value) ? Math.max(-0.8912509381337456,Math.min(0.8912509381337456,value)) : 0) : value;
      }
      if(carrier) {
        carrier[0][i]=eligible && valid && this._adaptive.speech && this._gain>0 && output[0][i]!==0 ? 1 : 0;
        carrier[1][i]=valid?1:0;
      }
    }

    if(automatic && this._blocks===0)this.port.postMessage({type:'automatic-gate',open:this._adaptive.open && eligible,
      floorDbfs:this._adaptive.floorDbfs,probability:this._probability});
    return true;
  }
}

registerProcessor('${NOISE_GATE_WORKLET_NAME}', NoiseGateProcessor);
`;

/** AudioContexts that already have the module registered. */
const registered = new WeakSet<BaseAudioContext>();

/**
 * Registers the worklet module on the given context. Safe to call repeatedly.
 * Throws if the module cannot be registered, so callers can fall back.
 */
export async function ensureNoiseGateWorklet(
  audioContext: BaseAudioContext,
): Promise<void> {
  if (registered.has(audioContext)) return;

  const blob = new Blob([NOISE_GATE_WORKLET_CODE], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);

  try {
    await audioContext.audioWorklet.addModule(url);
    registered.add(audioContext);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Creates the gate node. Input 0 is the signal to gate, input 1 is the
 * pre-processing tap used for level detection.
 */
export function createNoiseGateNode(
  audioContext: AudioContext,
): AudioWorkletNode {
  return new AudioWorkletNode(audioContext, NOISE_GATE_WORKLET_NAME, {
    numberOfInputs: 3,
    numberOfOutputs: 2,
    outputChannelCount: [1, 2],
    channelCount: 4,
    channelCountMode: "explicit",
  });
}
