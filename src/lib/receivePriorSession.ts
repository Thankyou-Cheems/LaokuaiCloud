import { type PriorLease, ReceivePriorCache, type ReceivePriorScope, type StoredReceivePrior } from "./receivePriorCache";

export interface PriorIdentity {participantId:string;receiverId:string;trackId:string;generation:number}
export interface PriorEvidence extends PriorIdentity {acceptedSpeechSeconds:number;lastAcceptedSpeechAudioTimeSeconds?:number|null}
type Binding={identity:PriorIdentity;scope:ReceivePriorScope;lease:PriorLease;accepted:number;clearAudioTime:number};
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
    this.bindings.set(id,{identity:{...identity},scope:{...scope},lease,accepted:0,clearAudioTime:-Infinity});
    const prior=this.cache.get(scope);if(prior)restore(prior,{...identity});
    return true;
  }
  observe(snapshot:Snapshot):boolean {
    const binding=this.bindings.get(key(snapshot));
    if(!binding || !Number.isFinite(snapshot.acceptedSpeechSeconds) || snapshot.acceptedSpeechSeconds<=binding.accepted)return false;
    binding.accepted=snapshot.acceptedSpeechSeconds;
    // A queued pre-clear batch can have a larger counter. Only actual accepted
    // DSP audio after the user's clear boundary may renew the newly issued lease.
    if(binding.clearAudioTime!==-Infinity && (!Number.isFinite(snapshot.lastAcceptedSpeechAudioTimeSeconds) ||
      snapshot.lastAcceptedSpeechAudioTimeSeconds!<=binding.clearAudioTime))return false;
    const prior=this.exportPrior(snapshot,this.now());
    return !!prior && this.cache.save(binding.scope,prior,binding.lease);
  }
  unbind(identity:PriorIdentity):void {this.bindings.delete(key(identity));}
  reset():void {this.bindings.clear();}
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
