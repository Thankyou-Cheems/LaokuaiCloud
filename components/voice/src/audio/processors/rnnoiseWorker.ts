import { DenoiseState,Rnnoise } from '@shiguredo/rnnoise-wasm';

let denoiseState: DenoiseState | null = null;
let model: Awaited<ReturnType<typeof Rnnoise.load>> | null = null;
let generation = 0;
let sequence = 0;
let previousEnergy = 0;
const FRAME_SIZE = 480;
const PCM_SCALE = 32768;

async function init() {
  model = await Rnnoise.load();
  denoiseState = model.createDenoiseState();
  self.postMessage({ type: 'ready' });
}

function processFrame(frame: Float32Array, replyPort: MessagePort, frameGeneration: number) {
  if (frameGeneration !== generation) return;
  if (frame.length !== FRAME_SIZE || !denoiseState) return;

  let energy = 0; let invalidInput=false;
  for(let i=0;i<FRAME_SIZE;i++) {
    const value=frame[i];invalidInput ||= !Number.isFinite(value);
    const finite=Number.isFinite(value)?value:0;
    frame[i]=Math.max(-32768,Math.min(32767,finite*PCM_SCALE));
    const normalized=frame[i]/PCM_SCALE;energy+=normalized*normalized;
  }
  const fault=(reason:string)=>{denoiseState?.destroy();denoiseState=null;replyPort.postMessage({type:"fault",reason,generation});};
  if(invalidInput){fault("rnnoise-nonfinite-input");return;}
  const probability = denoiseState.processFrame(frame);
  const windowEnergy=(energy+previousEnergy)/(2*FRAME_SIZE);previousEnergy=energy;
  const rmsDbfs=windowEnergy>0?10*Math.log10(windowEnergy):-120;
  if(!Number.isFinite(probability) || probability<0 || probability>1){fault("rnnoise-invalid-probability");return;}
  for(let i=0;i<FRAME_SIZE;i++) {
    frame[i]/=PCM_SCALE;
    if(!Number.isFinite(frame[i])){fault("rnnoise-nonfinite-output");return;}
  }
  const valid=true;

  replyPort.postMessage(
    { type: 'processed', frame: frame.buffer, generation, probability, rmsDbfs, valid, sequence: sequence=(sequence+1)%1048576 },
    [frame.buffer as ArrayBuffer],
  );
}

self.onmessage = (event: MessageEvent) => {
  const { type } = event.data;

  if (type === 'init') {
    init().catch((err) => {
      self.postMessage({ type: 'error', message: String(err) });
    });
    return;
  }

  if (type === 'worker-port') {
    const port: MessagePort = event.ports[0];
    port.onmessage = (e) => {
      if (e.data.type === 'frame') {
        processFrame(new Float32Array(e.data.frame), port, e.data.generation);
      } else if (e.data.type === 'reset') {
        generation = e.data.generation; sequence = 0; previousEnergy = 0;
        denoiseState?.destroy(); denoiseState = model!.createDenoiseState();
        port.postMessage({type:'reset-ack', generation});
      }
    };
    return;
  }

  if (type === 'destroy') {
    denoiseState?.destroy();
    denoiseState = null;
  }
};
