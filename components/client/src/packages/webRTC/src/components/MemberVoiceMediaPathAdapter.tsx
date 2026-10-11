/* eslint-disable react-refresh/only-export-components -- passive provider and its hook share one contract */
import { createContext, useContext } from "react";

import { type MemberVoiceMediaEvidence, type MemberVoiceMediaScope,readMemberVoiceMediaPath } from "../../../../lib/memberVoiceMediaPath";

export interface MemberVoiceMediaPathEntry {
  /** Independent current authenticated roster scope; never copied from evidence. */
  scope: MemberVoiceMediaScope;
  evidence?: MemberVoiceMediaEvidence;
}
export interface MemberVoiceMediaPathSnapshot {
  /** Adapter must advance this clock and invalidate entries on room/account/session changes. */
  nowMs: number;
  entries: readonly MemberVoiceMediaPathEntry[];
}
const Context = createContext<MemberVoiceMediaPathSnapshot | undefined>(undefined);
/** Injection boundary only. No SDK/ET subscriptions or parallel path store.
 * Deliberately unwired until SDK selected-media authority and full-path correlation are verified. */
export const MemberVoiceMediaPathProvider = Context.Provider;
export function useMemberVoiceMediaPath(host?: string, member?: string, publicationId?: string) {
  const snapshot = useContext(Context);
  const matches = host && member && publicationId ? snapshot?.entries.filter(entry =>
    entry.scope.serverScope === host && entry.scope.remoteServerUserId === member && entry.scope.remotePublicationId === publicationId) : undefined;
  const entry = matches?.length === 1 ? matches[0] : undefined;
  return readMemberVoiceMediaPath({ scope: entry?.scope, evidence: entry?.evidence, nowMs: snapshot?.nowMs });
}
