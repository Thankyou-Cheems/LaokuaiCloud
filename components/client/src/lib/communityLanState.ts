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
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    if (!state?.lanSnapshot) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state?.lanSnapshot]);
  return { snapshot: state?.lanSnapshot ?? undefined, nowMs };
}
