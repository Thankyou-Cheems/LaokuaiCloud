import type { VoicePacketSample, VoiceQualityReport } from "./voiceQualityStats";

type Row = {report?:VoiceQualityReport; expires:number;generation:number;seq:number};
function record(value:unknown,keys:string[]):value is Record<string,unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key=>Object.prototype.hasOwnProperty.call(value,key));
}
const milliseconds=(value:unknown)=>value===null || typeof value==="number" && Number.isFinite(value) && value>=0 && value<=60000;
const positive=(value:unknown)=>Number.isSafeInteger(value) && (value as number)>0;
function packet(value:unknown):value is VoicePacketSample|null {
  if(value===null)return true;
  if(!record(value,["windowMs","packetsReceived","packetsLost"]))return false;
  const {windowMs,packetsReceived,packetsLost}=value;
  return typeof windowMs==="number" && Number.isFinite(windowMs) && windowMs>=500 && windowMs<=10000 &&
    Number.isSafeInteger(packetsReceived) && (packetsReceived as number)>=0 &&
    Number.isSafeInteger(packetsLost) && (packetsLost as number)>=0 &&
    (packetsReceived as number)+(packetsLost as number)<=20000*windowMs/1000;
}
function summary(value:unknown):value is VoiceQualityReport {
  if(!record(value,["schemaVersion","connectionGeneration","seq","iceRttMs","uplink","receive"]))return false;
  return value.schemaVersion===1 && positive(value.connectionGeneration) && positive(value.seq) && milliseconds(value.iceRttMs) &&
    (value.uplink===null || record(value.uplink,["rttMs","sample"]) && milliseconds(value.uplink.rttMs) && packet(value.uplink.sample)) &&
    (value.receive===null || record(value.receive,["jitterMaxMs","sample"]) && milliseconds(value.receive.jitterMaxMs) && packet(value.receive.sample));
}
/** Per authenticated socket/room. Server timestamps determine duration, never local clock synchronization. */
export class VoiceQualityStore {
  private rows=new Map<string,Row>();
  accept(value:unknown,known:ReadonlySet<string>,now:number):boolean {
    if(!Number.isFinite(now) || !record(value,["schemaVersion","clientId","report","receivedAt","expiresAt"]) ||
      value.schemaVersion!==1 || typeof value.clientId!=="string" || !known.has(value.clientId) || value.clientId.length>512 ||
      typeof value.receivedAt!=="number" || !Number.isFinite(value.receivedAt) ||
      typeof value.expiresAt!=="number" || !Number.isFinite(value.expiresAt))return false;
    const duration=value.expiresAt-value.receivedAt;
    if(duration<0 || duration>8000)return false;
    const prior=this.rows.get(value.clientId);
    if(value.report===null) {
      if(prior)this.rows.set(value.clientId,{...prior,report:undefined,expires:now});
      return true;
    }
    if(!summary(value.report))return false;
    const report=value.report;
    if(prior && (report.connectionGeneration<prior.generation || report.connectionGeneration===prior.generation && report.seq<=prior.seq))return false;
    this.rows.set(value.clientId,{report:structuredClone(report),expires:now+duration,generation:report.connectionGeneration,seq:report.seq});
    // Bounded even against repeated server-side roster churn; old reports cannot address removed clients.
    while(this.rows.size>500)this.rows.delete(this.rows.keys().next().value!);
    return true;
  }
  read(id:string,now:number):VoiceQualityReport|undefined {
    const row=this.rows.get(id);return row && now<row.expires ? row.report : undefined;
  }
  retain(known:ReadonlySet<string>):void { for(const [id,row] of this.rows)if(!known.has(id))row.report=undefined; }
  reset():void {this.rows.clear();}
}
