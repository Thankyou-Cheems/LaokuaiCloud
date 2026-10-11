import type { Server } from "socket.io";
import type { Clients } from "../../types";
import type { VoiceQualityRegistration } from "../handlers/voiceQuality";

interface Entry { registration: VoiceQualityRegistration; fingerprint: string; userId: string }
const registrations = new WeakMap<Server, Map<string, Entry>>();
function fingerprint(ci: Clients[string] | undefined): string {
  return ci ? JSON.stringify([ci.serverUserId, ci.grytUserId, !!ci.accessToken,
    ci.hasJoinedChannel, ci.voiceChannelId, ci.streamID, ci.isConnectedToVoice]) : "";
}
export function retainVoiceQuality(io: Server, sid: string, clients: Clients, registration: VoiceQualityRegistration): void {
  let entries = registrations.get(io);
  if (!entries) { entries = new Map(); registrations.set(io, entries); }
  entries.get(sid)?.registration.dispose();
  entries.set(sid, { registration, fingerprint: fingerprint(clients[sid]), userId: clients[sid]?.serverUserId ?? "" });
}
export function clearVoiceQuality(io: Server, sid: string): void {
  registrations.get(io)?.get(sid)?.registration.clear();
}
export function clearUserVoiceQuality(io: Server, userId: string): void {
  for (const entry of registrations.get(io)?.values() ?? []) if (entry.userId === userId) entry.registration.clear();
}
/** Every authoritative roster publish checks invalidation, including kick/ban,
 * restore and room changes through older handlers. Clear remembers the old room. */
export function reconcileVoiceQuality(io: Server, clients: Clients): void {
  for (const [sid, entry] of registrations.get(io) ?? []) {
    const next = fingerprint(clients[sid]);
    if (next !== entry.fingerprint) {
      entry.registration.clear(); entry.fingerprint = next;
      entry.userId = clients[sid]?.serverUserId ?? "";
    }
  }
}
export function disposeVoiceQuality(io: Server, sid: string): void {
  const entries = registrations.get(io); entries?.get(sid)?.registration.dispose(); entries?.delete(sid);
}
