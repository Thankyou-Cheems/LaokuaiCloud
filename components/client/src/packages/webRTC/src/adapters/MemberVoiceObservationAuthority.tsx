/* eslint-disable react-refresh/only-export-components -- passive lifetime context and hook */
import type { BrowserHybridVoiceSession } from "@gryt/voice";
import { createContext, useContext } from "react";

export interface MemberVoiceObservationAuthority {
  /** Borrow the actual current session's read-only scope getter. Never own its cleanup. */
  registerSession(session: BrowserHybridVoiceSession): () => void;
  requestDetails(): () => void;
  update(): void;
}
const Context = createContext<MemberVoiceObservationAuthority | null>(null);
export const MemberVoiceObservationAuthorityProvider = Context.Provider;
export const useMemberVoiceObservationAuthority = () => useContext(Context);
