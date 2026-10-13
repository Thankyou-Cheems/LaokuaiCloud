import { useEffect, useState, useSyncExternalStore } from "react";

import type { EasyTierCommunityState } from "./easyTierCommunity";

const states = new Map<string, EasyTierCommunityState>();
const listeners = new Set<() => void>();
export const publishCommunityLanState = (state: EasyTierCommunityState) => {
  const prior = states.get(state.serverId);
  if (prior && prior.generation > state.generation) return;
  states.set(state.serverId, state);
  for (const listener of listeners) listener();
};
/** Shared snapshot for the member-list integration; authentication remains independently required. */
export function useEasyTierCommunityState(serverId: string | undefined) {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => serverId ? states.get(serverId) : undefined, () => undefined);
}

/** Advance the Unix clock even when telemetry stalls, so member evidence expires. */
export function useEasyTierMemberSnapshot(serverId: string | undefined) {
  const state = useEasyTierCommunityState(serverId);
  const [, setClockTick] = useState(0);
  const hasSnapshot = Boolean(state?.lanSnapshot);
  useEffect(() => {
    if (!hasSnapshot) return;
    // The timer only causes a render. Read the wall clock in that render so a
    // newly published snapshot is evaluated against the current local time
    // immediately, without advancing the clock from remote telemetry.
    const timer = setInterval(() => setClockTick(tick => tick + 1), 1000);
    return () => clearInterval(timer);
  }, [hasSnapshot]);
  return { snapshot: state?.lanSnapshot ?? undefined, nowMs: Date.now() };
}
