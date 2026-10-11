interface SpeechIndicatorInput {
  speech:unknown;
  speechState:{status:string};
  connected:boolean;
  muted:boolean;
  serverMuted:boolean;
  transmission:{status:string;publicationAcknowledged?:boolean;publicationBlocked?:boolean;publicationAllowed?:boolean};
}
/** Only the SDK's actual speech boolean can turn on the light; other values can only veto it. */
export function transmitSpeechIndicator(input:SpeechIndicatorInput):boolean {
  return input.speech===true && input.speechState.status==="available" && input.connected &&
    !input.muted && !input.serverMuted && (input.transmission.status==="ready" || input.transmission.status==="disabled") &&
    input.transmission.publicationAcknowledged===true && input.transmission.publicationBlocked===false &&
    input.transmission.publicationAllowed===true;
}
