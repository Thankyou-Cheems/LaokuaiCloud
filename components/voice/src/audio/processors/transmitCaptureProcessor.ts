export const TRANSMIT_CAPTURE_NAME = "gryt-transmit-capture-v1";
export const TRANSMIT_BOUNDARY_NAME = "gryt-transmission-boundary-v1";
export const TRANSMIT_CAPTURE_CODE = `
class TransmitCapture extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.generation = options.processorOptions.generation; this.sent = false; this.disposed = false;
    this.port.onmessage = event => { if (event.data === 'dispose') { this.disposed = true; this.port.close(); } };
  }
  process(inputs, outputs) {
    if (this.disposed) return false;
    const input = inputs[0], output = outputs[0];
    for (let c = 0; c < output.length; c++) {
      const source = input[c] || input[0];
      if (source) output[c].set(source); else output[c].fill(0);
    }
    if (!this.sent && input[0] && input[0].length) {
      this.sent = true; this.port.postMessage({type:"capture", generation:this.generation, frame:currentFrame});
    }
    return true;
  }
}
registerProcessor("${TRANSMIT_CAPTURE_NAME}", TransmitCapture);
class TransmissionBoundary extends AudioWorkletProcessor {
  constructor() {
    super(); this.speechEligible=false; this.speechEnabled=false; this.lastSpeech=null; this.lastReport=0; this.lastValid=-Infinity; this.blocked = true; this.revision = 0; this.sent = -1; this.disposed = false;
    this.port.onmessage = event => {
      if (event.data === 'dispose') { this.disposed = true; this.port.close(); }
      else if (event.data.revision > this.revision) { this.revision = event.data.revision; this.blocked = event.data.blocked; this.speechEligible=event.data.speechEligible===true; this.speechEnabled=event.data.speechEnabled===true; }
    };
  }
  process(inputs, outputs) {
    if (this.disposed) return false;
    const input = inputs[0], output = outputs[0];
    for (let c = 0; c < output.length; c++) {
      const source = input[c] || input[0];
      if (this.blocked || !source) output[c].fill(0); else output[c].set(source);
    }
    const evidence=inputs[1]; let speech=false, valid=false;
    if(this.speechEnabled) for(let i=0;i<(output[0]?.length||0);i++) {
      valid ||= evidence?.[1]?.[i]>=0.5;
      speech ||= !this.blocked && this.speechEligible && evidence?.[0]?.[i]>=0.5
        && Number.isFinite(output[0][i]) && output[0][i]!==0;
    }
    if(valid)this.lastValid=currentFrame;
    const available=currentFrame-this.lastValid<=sampleRate*.25;
    if(this.speechEnabled && (speech!==this.lastSpeech || currentFrame-this.lastReport>=sampleRate*.05)) {
      this.port.postMessage({type:'speech',revision:this.revision,speaking:speech,available,frame:currentFrame});
      this.lastSpeech=speech;this.lastReport=currentFrame;
    }
    if (this.sent !== this.revision) {
      this.sent = this.revision; this.port.postMessage({type:'boundary', revision:this.revision, blocked:this.blocked, frame:currentFrame});
    }
    return true;
  }
}
registerProcessor("${TRANSMIT_BOUNDARY_NAME}", TransmissionBoundary);
`;
const loads = new WeakMap<BaseAudioContext, Promise<void>>();
export function loadTransmitCapture(context: BaseAudioContext): Promise<void> {
  const old = loads.get(context); if (old) return old;
  const url = URL.createObjectURL(new Blob([TRANSMIT_CAPTURE_CODE], { type: "application/javascript" }));
  const result = Promise.resolve().then(() => context.audioWorklet.addModule(url)).finally(() => URL.revokeObjectURL(url));
  loads.set(context, result); void result.catch(() => loads.delete(context)); return result;
}
export function createTransmitCapture(context: AudioContext, generation: number) {
  const node = new AudioWorkletNode(context, TRANSMIT_CAPTURE_NAME, { processorOptions: { generation } });
  const fresh = new Promise<void>(resolve => {
    node.port.onmessage = event => { if (event.data.type === "capture" && event.data.generation === generation) resolve(); };
  });
  return { node, fresh };
}
