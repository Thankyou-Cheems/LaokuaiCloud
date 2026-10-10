import { useSyncExternalStore } from "react";

import type { SquadSnapshot } from "./squadMode";

let snapshot: SquadSnapshot = { status: "standby", gateEnabled: false, suppressed: false, heldCount: 0, global: false };
let gateEnabled = false;
const listeners = new Set<() => void>();
export function publishSquadSnapshot(next: SquadSnapshot): void {
  if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
  snapshot = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useSquadSnapshot(): SquadSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
export function publishSquadGate(enabled: boolean): void {
  if (enabled === gateEnabled) return;
  gateEnabled = enabled;
  for (const listener of listeners) listener();
}
export function useSquadGateEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => gateEnabled, () => gateEnabled);
}
