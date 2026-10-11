/* eslint-disable react-refresh/only-export-components -- The small context and hook share the same policy. */
import {createContext,useContext} from "react";
export interface EffectiveVoicePolicy {
  inputMode:"voice_activity"|"push_to_talk";requiredPushToTalk:boolean;
  serverMuted:boolean;serverDeafened:boolean;canSpeak:boolean;
}
const Context=createContext<EffectiveVoicePolicy|undefined>(undefined);
export const EffectiveVoicePolicyProvider=Context.Provider;
export const useEffectiveVoicePolicy=()=>useContext(Context);
