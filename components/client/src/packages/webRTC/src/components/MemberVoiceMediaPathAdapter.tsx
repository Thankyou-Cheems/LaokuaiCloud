/* eslint-disable react-refresh/only-export-components -- passive provider and its hook share one contract */
import { createContext, useContext } from "react";

import { type MemberVoiceMediaPathSnapshot, readMemberVoiceMediaPath } from "../../../../lib/memberVoiceMediaPath";

export type { MemberVoiceMediaPathEntry, MemberVoiceMediaPathSnapshot } from "../../../../lib/memberVoiceMediaPath";
const Context = createContext<MemberVoiceMediaPathSnapshot | undefined>(undefined);
/** One mounted passive store, populated by the SDK read-only adapter. */
export const MemberVoiceMediaPathProvider = Context.Provider;
export function useMemberVoiceLocalNetwork(serverId?: string) {
  const local = useContext(Context)?.localNetwork;
  return local?.serverId === serverId ? local : undefined;
}
export function useMemberVoiceMediaPath(host?: string, member?: string, publicationId?: string) {
  const snapshot = useContext(Context);
  const matches = host && member && publicationId ? snapshot?.entries.filter(entry =>
    entry.scope.serverScope === host && entry.scope.remoteServerUserId === member && entry.scope.remotePublicationId === publicationId) : undefined;
  const entry = matches?.length === 1 ? matches[0] : undefined;
  return readMemberVoiceMediaPath({ scope: entry?.scope, evidence: entry?.evidence, nowMs: snapshot?.nowMs });
}
