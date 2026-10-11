import type { Server } from "socket.io";
const watchers = new WeakMap<Server, Set<() => void>>();
export function watchVoiceMoves(io: Server, watcher: () => void): void {
  let entries = watchers.get(io);
  if (!entries) { entries = new Set(); watchers.set(io, entries); }
  entries.add(watcher);
}
/** Synchronous invalidation precedes any queued SFU reconciliation. */
export function reconcileVoiceMoves(io: Server): void {
  for (const watcher of watchers.get(io) ?? []) watcher();
}
