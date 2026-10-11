import { RECEIVE_ANALYZER_BASE64 } from "./receiveAnalyzerAsset";
import { TRANSMIT_SPEECH_CORE_CODE } from "./transmitSpeechCode";

export const TRANSMIT_EVIDENCE_NAME = "gryt-transmit-evidence-v1";
export const TRANSMIT_EVIDENCE_CODE = TRANSMIT_SPEECH_CORE_CODE + `
class TransmitEvidence extends AudioWorkletProcessor {
  static get parameterDescriptors(){return [{name:"allowed",defaultValue:0,minValue:0,maxValue:1,automationRate:"k-rate"}];}
  constructor(options) {
    super(); this.allowed=false; this.disposed=false; this.handle=0; this.at=0; this.outAt=0; this.ready=false; this.sequence=0;
    this.size=sampleRate/100; this.pcm=new Float32Array(this.size); this.out=new Float32Array(this.size);
    try {
      this.runtime=createReceiveAnalyzerRuntime(options.processorOptions.analyzerModule);
      this.handle=this.runtime.gryt_create(sampleRate,0);
      if(!this.handle || (sampleRate!==44100 && sampleRate!==48000)) throw Error('unsupported');
      this.bind();
    } catch { this.handle=0;this.port.postMessage({type:"fault"}); }
    this.port.onmessage=e=>{
      if(e.data==='dispose') {this.disposed=true;if(this.handle)this.runtime.gryt_destroy(this.handle);this.handle=0;this.port.close();}
      else if(e.data==='reset-history') {
        this.at=0;this.ready=false;this.pcm.fill(0);this.out.fill(0);
        if(this.handle) {if(this.runtime.gryt_reset(this.handle)!==0){this.runtime.gryt_destroy(this.handle);this.handle=0;this.port.postMessage({type:"fault"});}else this.bind();}
      }
    };
  }
  bind() {
    this.input=new Float32Array(this.runtime.memory.buffer,this.runtime.gryt_input(this.handle),this.size);
    this.result=new Float32Array(this.runtime.memory.buffer,this.runtime.gryt_output(this.handle),8);
  }
  process(inputs,outputs,parameters) {
    if(this.disposed)return false;
    const allowed=parameters.allowed[0]>=0.5;
    if(allowed!==this.allowed){this.allowed=allowed;this.at=0;this.ready=false;this.pcm.fill(0);this.out.fill(0);}
    const source=inputs[0]?.[0], audio=outputs[0][0], evidence=outputs[1];
    for(const channel of evidence)channel.fill(0);
    for(let i=0;i<audio.length;i++) {
      audio[i]=this.ready?this.out[this.outAt++]:0;
      if(this.ready) {evidence[0][i]=this.probability;evidence[1][i]=this.db;evidence[2][i]=1;evidence[3][i]=this.sequence;if(this.outAt===this.size)this.ready=false;}
      const value=source?.[i]??0;
      this.pcm[this.at]=Number.isFinite(value)?value:0;
      if(this.handle)this.input[this.at]=Math.max(-32768,Math.min(32767,this.pcm[this.at]*32768));
      if(++this.at===this.size) {
        this.at=0;
        if(!this.handle)continue;
        const code=this.runtime.gryt_process10ms(this.handle,this.size), p=this.result[0];
        if(code!==0 || !Number.isFinite(p) || p<0 || p>1){this.runtime.gryt_destroy(this.handle);this.handle=0;this.port.postMessage({type:"fault"});continue;}
        let energy=0;for(const sample of this.pcm)energy+=sample*sample;
        this.probability=p;this.db=energy>0?10*Math.log10(energy/this.size):-120;
        this.out.set(this.pcm);this.outAt=0;this.ready=true;this.sequence=(this.sequence+1)%1048576;
      }
    }
    return true;
  }
}
registerProcessor("${TRANSMIT_EVIDENCE_NAME}",TransmitEvidence);
`;
export async function createTransmitEvidence(context: AudioContext) {
  const analyzerModule=await loadTransmitSpeech(context);
  return new AudioWorkletNode(context,TRANSMIT_EVIDENCE_NAME,{numberOfInputs:1,numberOfOutputs:2,
    outputChannelCount:[1,4],channelCount:1,channelCountMode:"explicit",processorOptions:{analyzerModule}});
}

let modulePromise: Promise<WebAssembly.Module> | undefined;
const loads = new WeakMap<BaseAudioContext, Promise<WebAssembly.Module>>();
const registrations = new WeakMap<BaseAudioContext, Promise<void>>();
export function loadTransmitSpeech(context: BaseAudioContext): Promise<WebAssembly.Module> {
  const previous = loads.get(context);
  if (previous) return previous;
  if (!modulePromise) {
    modulePromise = WebAssembly.compile(Uint8Array.from(atob(RECEIVE_ANALYZER_BASE64), value => value.charCodeAt(0)));
    void modulePromise.catch(() => { modulePromise = undefined; });
  }
  let registration = registrations.get(context);
  if (!registration) {
    const url = URL.createObjectURL(new Blob([TRANSMIT_EVIDENCE_CODE], { type: "application/javascript" }));
    registration = Promise.resolve().then(() => context.audioWorklet.addModule(url)).finally(() => URL.revokeObjectURL(url));
    registrations.set(context, registration);
    void registration.catch(() => registrations.delete(context));
  }
  const promise = Promise.all([registration, modulePromise]).then(([, module]) => module);
  loads.set(context, promise);
  void promise.catch(() => loads.delete(context));
  return promise;
}
