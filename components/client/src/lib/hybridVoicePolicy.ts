import { localHybridDiagnostic } from "./hybridDiagnostics";

/** Stable product opt-in. Authenticated SDK admission still owns every media route.
 * ICE settings are inherited from the current authenticated SFU PC by the bridge.
 * This does not start EasyTier, capture or any native helper.
 */
export const LAOKUAI_HYBRID_VOICE_POLICY = Object.freeze({ enabled: true, allowNetwork: true, onDiagnostic: localHybridDiagnostic });
