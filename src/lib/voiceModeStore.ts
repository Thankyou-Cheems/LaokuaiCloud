import { useSyncExternalStore } from "react";

import { parseVoiceMode, type VoiceModeState } from "./voiceMode";

type Entry = { clientId: string; state: VoiceModeState; at: number };
const hosts = new Map<string, Map<string, Entry>>();
const listeners = new Set<() => void>();
let local: VoiceModeState | null = null;
let expiry: ReturnType<typeof setInterval> | null = null;
function notify() { for (const listener of listeners) listener(); }
export function publishLocalVoiceMode(state: VoiceModeState): void {
  if (JSON.stringify(local) === JSON.stringify(state)) return;
  local = state; notify();
}
export function clearVoiceModes(host: string): void { if (hosts.delete(host)) notify(); }
export function acceptVoiceMode(host: string, value: unknown, roster: Record<string, { serverUserId?: string; hasJoinedChannel?: boolean; voiceChannelId?: string }>, room: string): boolean {
  if (!value || typeof value !== "object") return false;
  const p = value as { clientId?: string; serverUserId?: string; state?: unknown };
  if (!p.clientId || !p.serverUserId) return false;
  const peer = roster[p.clientId];
  if (!peer?.hasJoinedChannel || peer.serverUserId !== p.serverUserId || peer.voiceChannelId !== room) return false;
  const state = parseVoiceMode(p.state);
  if (!state) return false;
  let entries = hosts.get(host);
  if (!entries) { entries = new Map(); hosts.set(host, entries); }
  const previous = entries.get(p.serverUserId);
  if (previous?.clientId === p.clientId && previous.state.seq >= state.seq) return false;
  entries.set(p.serverUserId, { clientId: p.clientId, state, at: Date.now() }); notify();
  return true;
}
export function pruneVoiceModes(host: string, roster: Record<string, { serverUserId?: string; hasJoinedChannel?: boolean; voiceChannelId?: string }>, room: string): void {
  const entries = hosts.get(host);
  if (!entries) return;
  let changed = false;
  for (const [id, entry] of entries) {
    const peer = roster[entry.clientId];
    if (!peer?.hasJoinedChannel || peer.serverUserId !== id || peer.voiceChannelId !== room) { entries.delete(id); changed = true; }
  }
  if (changed) notify();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!expiry) expiry = setInterval(() => {
    let changed = false;
    for (const entries of hosts.values()) for (const [id, entry] of entries) {
      if (Date.now() - entry.at > 6000) { entries.delete(id); changed = true; }
    }
    if (changed) notify();
  }, 1000);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && expiry) { clearInterval(expiry); expiry = null; }
  };
}
export function useRemoteVoiceMode(host?: string, member?: string): VoiceModeState | null {
  const get = () => host && member ? hosts.get(host)?.get(member)?.state ?? null : null;
  return useSyncExternalStore(subscribe, get, () => null);
}
export function useLocalVoiceMode(): VoiceModeState | null {
  return useSyncExternalStore(subscribe, () => local, () => null);
}
