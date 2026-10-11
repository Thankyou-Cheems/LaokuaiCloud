import type { Server } from "socket.io";
const watchers = new WeakMap<Server, (sid?: string, userId?: string) => void>();
export function watchVoiceHybrid(io: Server, listener: (sid?: string, userId?: string) => void): () => void {
  watchers.set(io, listener); return () => { if (watchers.get(io) === listener) watchers.delete(io); };
}
export function reconcileVoiceHybrid(io: Server): void { watchers.get(io)?.(); }
export function invalidateHybridSession(io: Server, sid: string): void { watchers.get(io)?.(sid); }
export function invalidateHybridUser(io: Server, userId: string): void { watchers.get(io)?.(undefined, userId); }
