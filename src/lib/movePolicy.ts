import type {MoveDestinationSettings} from "./moveAuthority";

export interface MovePolicyBinding {
  host:string;generation:string;requestId:string;destinationChannelId:string;
  policy:MoveDestinationSettings;beforePromotionRevision:number;
}
export interface MovePolicyEvidence {
  host:string;channel:string;generation:string;
  config:{audio:{inputMode:string;noiseSuppression:boolean;transmitEligible?:boolean;muted:boolean;serverMuted:boolean;
    deafened:boolean;serverDeafened:boolean};connection:{mediaMode?:string;eSportsMode:boolean;maxBitrate?:number|null}};
  transmission:{publicationAcknowledged?:boolean;publicationBlocked?:boolean;publicationRevision?:number};
}
/** All fields are server controls. Equal transport flags alone never prove permission/mute policy. */
export function sameMovePolicy(a:MoveDestinationSettings,b:MoveDestinationSettings):boolean {
  return a.requirePTT===b.requirePTT && a.disableRNNoise===b.disableRNNoise && a.maxBitrate===b.maxBitrate &&
    a.eSportsMode===b.eSportsMode && a.speak===b.speak && a.shareVideo===b.shareVideo && a.shareScreen===b.shareScreen &&
    a.isMuted===b.isMuted && a.isDeafened===b.isDeafened;
}
export function isMovePolicyAcknowledged(binding:MovePolicyBinding|undefined,requestId:string,policy:MoveDestinationSettings,
  evidence:MovePolicyEvidence):boolean {
  if(!binding || binding.requestId!==requestId || binding.host!==evidence.host || binding.generation!==evidence.generation ||
    binding.destinationChannelId!==evidence.channel || !sameMovePolicy(binding.policy,policy))return false;
  const {audio,connection}=evidence.config,ack=evidence.transmission;
  if(connection.mediaMode!=="audio-only" || connection.maxBitrate!==policy.maxBitrate || (policy.requirePTT && audio.inputMode!=="push_to_talk") ||
    (policy.disableRNNoise && audio.noiseSuppression) || (policy.eSportsMode && !connection.eSportsMode) ||
    audio.transmitEligible!==policy.speak || (policy.isMuted && !(audio.muted || audio.serverMuted)) ||
    (policy.isDeafened && !(audio.deafened || audio.serverDeafened)))return false;
  return ack.publicationAcknowledged===true && ack.publicationBlocked===true &&
    Number.isSafeInteger(ack.publicationRevision) && ack.publicationRevision!>=binding.beforePromotionRevision;
}
