import type { BrowserHybridDiagnostic, BrowserHybridVoiceState } from "@gryt/voice";

import { localDiagnostic } from "./localDiagnostics";

/** Fixed enum: SDK errors and observer input never become free text in local logs. */
export const HYBRID_DIAGNOSTIC_REASONS = ["other", "network_disabled", "identity_unavailable", "socket_unavailable", "sfu_media_unavailable", "codec_unavailable", "roster_unavailable", "epoch_unavailable", "scope_retired", "reconfigure_restore_pending", "hybrid_unavailable", "hybrid_scope_stale", "hybrid_command_timeout", "hybrid_command_rejected", "hybrid_authority_unavailable", "fresh_sfu_restore_required", "sfu_restore_incomplete", "authenticated_pair_protocol_unavailable", "network_not_authorized", "permission_unavailable", "protected_publication_unavailable", "peer_limit", "auth_recovery_cleanup", "probe_budget_closed", "peer_path_not_admitted", "peer_media_stale", "peer_path_unstable", "peer_path_unavailable", "decoded_media_unavailable", "media_stale_before_switch", "operation_timeout", "invalid_pair_lease", "forwarding_ack_mismatch", "probe_failed", "restore_failed", "peer_failed", "peer_path_changed", "p2p_media_lost", "sfu_restore_retry", "receive_selection_failed", "invalid_sfu_media_sequence", "fresh_sfu_media_unavailable", "lease_renew_failed", "pause_lease_expired", "signal_relay_failed", "signal_accept_failed", "controller_stopping", "pair_invalidated", "authority_invalidated", "binding_restore_required", "binding_stale", "binding_changed", "receive_binding_retired", "stale_receive_selection", "sfu_binding_retired", "scope_changed", "invalid_scope", "route_cancelled"] as const;
type Reason = typeof HYBRID_DIAGNOSTIC_REASONS[number] | "validated_ack" | "request_failed";
type PeerDiagnostic = Extract<BrowserHybridDiagnostic, { kind: "peer-media" }>;
type ForwardingDiagnostic = Extract<BrowserHybridDiagnostic, { kind: "forwarding" }>;
export interface HybridDiagnostic {
  operation: "hybrid-scope" | "hybrid-route" | "hybrid-path" | "hybrid-forwarding";
  scopeGeneration: number;
  status: "waiting" | "created" | "retired" | BrowserHybridVoiceState["status"] | "sfu" | "queued" | "probing" | "switching" | "p2p" | "failed";
  reason: Reason | null;
  connected?: boolean;
  rosterReady?: boolean;
  epochReady?: boolean;
  routeOrdinal?: number;
  routeGeneration?: number;
  selectionRevision?: number;
  selected?: "sfu" | "p2p" | "none";
  forwardingPaused?: boolean;
  pathClass?: PeerDiagnostic["pathClass"];
  pathReason?: PeerDiagnostic["pathReason"];
  localCandidateType?: PeerDiagnostic["localCandidateType"];
  remoteCandidateType?: PeerDiagnostic["remoteCandidateType"];
  underlayClass?: PeerDiagnostic["underlayClass"];
  decodeProof?: PeerDiagnostic["decodeProof"];
  decodeReason?: PeerDiagnostic["decodeReason"];
  failureReason?: PeerDiagnostic["failureReason"];
  forwardingAction?: ForwardingDiagnostic["action"];
  result?: ForwardingDiagnostic["result"];
}
const safeReason = (value: string | null): Reason | null => value === null ? null : HYBRID_DIAGNOSTIC_REASONS.find(reason => reason === value) ?? "other";
const bounded = (value: number) => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 3_600_000) : 0;
let nextScopeGeneration = 0;

/** IDs live only inside this observer and never cross the diagnostic boundary. */
export function createHybridDiagnosticObserver(callback: (diagnostic: HybridDiagnostic) => void) {
  const scopeGeneration = nextScopeGeneration = nextScopeGeneration % 3_600_000 + 1;
  const ordinals = new Map<string, number>(), previous = new Map<number, string>(), previousSdk = new Map<string, string>();
  let nextRouteOrdinal = 0;
  let previousScope = "";
  const emit = (value: HybridDiagnostic) => { try { callback(value); } catch { /* Diagnostics never own media. */ } };
  const scope = (status: HybridDiagnostic["status"], reason: string | null, readiness?: Pick<HybridDiagnostic, "connected" | "rosterReady" | "epochReady">) => {
    const value: HybridDiagnostic = { operation: "hybrid-scope", scopeGeneration, status, reason: safeReason(reason), ...readiness };
    const signature = JSON.stringify(value); if (signature === previousScope) return;
    previousScope = signature; emit(value);
  };
  return { scope, sdk(event: BrowserHybridDiagnostic) {
    // Explicit fields prevent future SDK metadata from crossing the logging boundary.
    const value: HybridDiagnostic = event.kind === "peer-media" ? {
      operation: "hybrid-path", scopeGeneration, status: event.failureReason ? "failed" : "active", reason: null,
      pathClass: event.pathClass, pathReason: event.pathReason, localCandidateType: event.localCandidateType,
      remoteCandidateType: event.remoteCandidateType, underlayClass: event.underlayClass, decodeProof: event.decodeProof,
      decodeReason: event.decodeReason, failureReason: event.failureReason,
    } : { operation: "hybrid-forwarding", scopeGeneration, status: event.result === "failed" ? "recovering" : "active",
      forwardingAction: event.action, result: event.result, reason: event.reason };
    const key = event.kind === "peer-media" ? event.kind : `${event.kind}:${event.action}`;
    const signature = JSON.stringify(value); if (previousSdk.get(key) === signature) return;
    previousSdk.set(key, signature); emit(value);
  }, state(state: BrowserHybridVoiceState) {
    scope(state.status, state.reason);
    const currentKeys = new Set((state.routing?.routes ?? []).map(route => JSON.stringify([route.participantId, route.sessionId, route.publicationId])));
    for (const [key, ordinal] of ordinals) if (!currentKeys.has(key)) { ordinals.delete(key); previous.delete(ordinal); }
    for (const route of state.routing?.routes ?? []) {
      const key = JSON.stringify([route.participantId, route.sessionId, route.publicationId]);
      if (!ordinals.has(key)) { if (ordinals.size >= 64) continue; ordinals.set(key, nextRouteOrdinal++ % 3_600_000); }
      const routeOrdinal = ordinals.get(key)!;
      const value: HybridDiagnostic = { operation: "hybrid-route", scopeGeneration, routeOrdinal,
        status: route.status, reason: safeReason(route.reason), selected: route.selected,
        routeGeneration: bounded(route.routeGeneration), selectionRevision: bounded(route.selectionRevision), forwardingPaused: route.forwardingPaused };
      const signature = JSON.stringify(value); if (previous.get(routeOrdinal) === signature) continue;
      previous.set(routeOrdinal, signature); emit(value);
    }
  } };
}

export function localHybridDiagnostic(value: HybridDiagnostic): void {
  localDiagnostic({ phase: "voice", action: "finish", code: "ok", ...value });
}
