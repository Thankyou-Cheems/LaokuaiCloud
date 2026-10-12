import { type PriorLease, ReceivePriorCache, type ReceivePriorScope, type StoredReceivePrior } from "./receivePriorCache";

export interface PriorIdentity {participantId:string;receiverId:string;trackId:string;generation:number}
export interface PriorEvidence extends PriorIdentity {acceptedSpeechSeconds:number;lastAcceptedSpeechAudioTimeSeconds?:number|null}
type Binding={identity:PriorIdentity;scope:ReceivePriorScope;lease:PriorLease;accepted:number;acceptedAudioTime:number;clearAudioTime:number};
const key=(id:PriorIdentity)=>JSON.stringify([id.participantId,id.receiverId,id.trackId,id.generation]);
/** The SDK remains the only exporter/restorer. This coordinator never calculates or applies gain. */
export class ReceivePriorSession<Snapshot extends PriorEvidence> {
  private readonly bindings=new Map<string,Binding>();
  constructor(private readonly cache:ReceivePriorCache,
    private readonly exportPrior:(snapshot:Snapshot,now:number)=>StoredReceivePrior|undefined,
    private readonly now:()=>number=Date.now) {}
  bind(identity:PriorIdentity,scope:ReceivePriorScope,restore:(prior:StoredReceivePrior|undefined,expected:PriorIdentity)=>boolean):boolean {
    const id=key(identity);if(this.bindings.has(id))return false;
    const lease=this.cache.begin(scope);if(!lease)return false;
    this.bindings.set(id,{identity:{...identity},scope:{...scope},lease,accepted:0,acceptedAudioTime:-Infinity,clearAudioTime:-Infinity});
    const prior=this.cache.get(scope);if(prior)restore(prior,{...identity});
    return true;
  }
  observe(snapshot:Snapshot):boolean {
    const binding=this.bindings.get(key(snapshot));
    if(!binding || !Number.isFinite(snapshot.acceptedSpeechSeconds) || snapshot.acceptedSpeechSeconds<=0 || snapshot.acceptedSpeechSeconds===binding.accepted)return false;
    // The DSP counter restarts after mute, disable and processor recovery without
    // replacing this binding. The accepted-audio cursor survives those resets and
    // advances only when the SDK accepts fresh speech, never on telemetry polls.
    const acceptedAudioTime=snapshot.lastAcceptedSpeechAudioTimeSeconds;
    if(typeof acceptedAudioTime!=="number" || !Number.isFinite(acceptedAudioTime) || acceptedAudioTime<0 || acceptedAudioTime<=binding.acceptedAudioTime)return false;
    binding.accepted=snapshot.acceptedSpeechSeconds;binding.acceptedAudioTime=acceptedAudioTime;
    // A queued pre-clear batch can have a larger counter. Only actual accepted
    // DSP audio after the user's clear boundary may renew the newly issued lease.
    if(binding.clearAudioTime!==-Infinity && (!Number.isFinite(snapshot.lastAcceptedSpeechAudioTimeSeconds) ||
      snapshot.lastAcceptedSpeechAudioTimeSeconds!<=binding.clearAudioTime))return false;
    const prior=this.exportPrior(snapshot,this.now());
    return !!prior && this.cache.save(binding.scope,prior,binding.lease);
  }
  unbind(identity:PriorIdentity):void {this.bindings.delete(key(identity));this.cache.flush();}
  reset():void {this.bindings.clear();this.cache.flush();}
  clear(scope?:ReceivePriorScope,audioTimeSeconds?:number):void {
    if(scope)this.cache.clear(scope);else this.cache.clearAccount();
    // No current context means fail closed until a fresh binding is created.
    for(const [id,binding] of this.bindings) {
      if(!scope || (binding.scope.accountId===scope.accountId && binding.scope.serverInstanceId===scope.serverInstanceId &&
        binding.scope.remoteUserId===scope.remoteUserId))binding.clearAudioTime=Number.isFinite(audioTimeSeconds) ? audioTimeSeconds! : Infinity;
      const lease=this.cache.begin(binding.scope);
      if(lease)binding.lease=lease;else this.bindings.delete(id);
    }
  }
}
