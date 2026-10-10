/* eslint-disable react-refresh/only-export-components -- Shared provider and consuming hook form one receiver-local adapter. */
import type { ReceiveAutoLevelSnapshot } from "@gryt/voice";
import { createContext, useContext } from "react";

import { correctionSelector } from "../../../../lib/receiveCorrectionRegistry";

const EMPTY: ReadonlyMap<string, ReceiveAutoLevelSnapshot> = new Map();
const ReceiveCorrectionContext = createContext(EMPTY);
export const ReceiveCorrectionProvider = ReceiveCorrectionContext.Provider;

export function useReceiveCorrection(host?: string, member?: string, streamId?: string): ReceiveAutoLevelSnapshot | undefined {
  const readings = useContext(ReceiveCorrectionContext);
  return host && member && streamId ? readings.get(correctionSelector(host, member, streamId)) : undefined;
}
