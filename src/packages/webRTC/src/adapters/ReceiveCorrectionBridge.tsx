import { useSpeakers } from "@gryt/voice";
import { type ReactNode, useLayoutEffect, useState, useSyncExternalStore } from "react";

import { ReceiveCorrectionRegistry } from "../../../../lib/receiveCorrectionRegistry";
import { ReceiveCorrectionProvider } from "../components/ReceiveCorrectionAdapter";
import { useReceiveAudioRoles } from "./useReceiveAudioRoles";

/** SDK batches are authoritative; no client RMS estimator or sampling timer. */
export function ReceiveCorrectionBridge({ children }: { children?: ReactNode }) {
  const [registry] = useState(() => new ReceiveCorrectionRegistry());
  const { receiveAutoLevels } = useSpeakers();
  useReceiveAudioRoles(registry);
  useLayoutEffect(() => { registry.acceptBatch(receiveAutoLevels); }, [registry, receiveAutoLevels]);
  useLayoutEffect(() => () => registry.clear(), [registry]);
  const readings = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  return <ReceiveCorrectionProvider value={readings}>{children}</ReceiveCorrectionProvider>;
}
