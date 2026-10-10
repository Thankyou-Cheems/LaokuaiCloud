/* eslint-disable react-refresh/only-export-components -- Shared provider/factory and its consuming hook form one adapter. */
import { createContext, type ReactNode, useContext } from "react";

/** Runtime facts must come from the DSP engine, never inferred from the toggle. */
export type ReceiveLevelingRuntime = "active" | "loading" | "degraded" | "disabled" | "suspended" | "unknown";
export type ReceiveLevelingAdapter = {
  available: false;
  enabled: null;
  runtime: "unknown";
} | {
  available: true;
  enabled: boolean;
  runtime: ReceiveLevelingRuntime;
  reason?: string;
  latencyMs?: number;
  setEnabled: (enabled: boolean) => void;
  /** Omit until the engine exposes a real bounded parameter. Never map to outputVolume. */
  parameter?: {
    kind: "target-level" | "strength";
    /** Already localized by the engine adapter; names the actual measured quantity. */
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    unit: string;
    setValue: (value: number) => void;
  };
};

const unavailable: ReceiveLevelingAdapter = { available: false, enabled: null, runtime: "unknown" };
const Context = createContext<ReceiveLevelingAdapter>(unavailable);

/** Mount once above both call surfaces and feed actual shared engine state. */
export function ReceiveLevelingProvider({ value, children }: {
  value: ReceiveLevelingAdapter;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useReceiveLeveling() { return useContext(Context); }
