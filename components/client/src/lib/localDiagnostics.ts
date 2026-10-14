export const HYBRID_PROTOCOL_DIAGNOSTIC_REASONS = ["hybrid_disabled", "hybrid_unsupported", "hybrid_unauthenticated", "hybrid_permission_denied", "hybrid_protocol_invalid",
  "hybrid_authority_failed", "hybrid_scope_stale", "hybrid_pair_stale", "hybrid_release_failed", "hybrid_sfu_ack_failed",
  "hybrid_sfu_unavailable", "hybrid_sfu_ack_timeout", "hybrid_sfu_disconnected", "hybrid_operation_stale", "hybrid_cleanup_conflict",
  "hybrid_sfu_unauthorized_server", "hybrid_sfu_invalid_hybrid_command", "hybrid_sfu_invalid_hybrid_room", "hybrid_sfu_source_permission_revoked",
  "hybrid_sfu_peer_generation_changed", "hybrid_sfu_ambiguous_publication", "hybrid_sfu_publication_unavailable", "hybrid_sfu_invalid_audio_lease",
  "hybrid_sfu_source_retired", "hybrid_sfu_receiver_unavailable", "hybrid_sfu_invalid_pause_duration", "hybrid_sfu_stale_audio_lease",
  "hybrid_sfu_authority_generation_conflict", "hybrid_sfu_pair_generation_conflict", "operation_timeout", "route_cancelled"] as const;

/** Fixed local diagnostics schema. Never pass payloads, identities or free text. */
export const DIAGNOSTIC_OPERATIONS = ["app-bootstrap", "app-quit", "server:join", "server:verify", "server:joined", "server:details", "server:error", "token:refresh", "token:refreshed", "token:error", "token:revoked", "voice-state", "voice:room:granted", "voice:room:leave", "voice:kicked", "voice:device:disconnect", "server:kicked", "server:session:replaced", "voice:room:request", "voice:room:error", "voice:channel:joined", "connect", "connect_error", "disconnect", "credential-session", "credential-acquire", "credential-renew", "credential-revoke", "credential-binding", "core-start", "core-stop", "other"] as const;
export const DIAGNOSTIC_CODES = ["ok", "other", "token_invalid", "unidentified", "requesting_access", "connecting", "connected", "reconnecting", "failed", "disconnected", "media-policy-changed", "connection-lost", "reconnect-failed", "rate_limited", "join_required", "invalid_token", "invalid_access_token", "refresh_token_invalid", "refresh_token_expired", "token_version_mismatch", "user_token_version_mismatch", "forbidden", "membership_required", "banned", "auth-unavailable", "provider-unavailable", "configuration-required", "needs-permission", "cleanup-failed", "connect_error", "transport-close", "http-400", "http-401", "http-403", "http-429", "http-500", "http-503"] as const;
export const NETWORK_DIAGNOSTIC_OPERATIONS = ["lan-state", "lan-telemetry", "credential-policy", "credential-directory", "credential-relay-status", "hybrid-scope", "hybrid-route", "hybrid-path", "hybrid-forwarding", "hybrid-handoff"] as const;
export const NETWORK_DIAGNOSTIC_CODES = ["activation-required", "runtime-required", "unsupported-target", "multi-community-unavailable", "connect-failed", "operation-timeout", "status-unavailable", "runtime-exited", "invalid-response", "request-cancelled", "directory-extension-unsupported"] as const;
export const DIAGNOSTIC_REASONS = [...HYBRID_PROTOCOL_DIAGNOSTIC_REASONS, "other", "network_disabled", "identity_unavailable", "socket_unavailable", "sfu_media_unavailable", "codec_unavailable", "roster_unavailable", "epoch_unavailable", "scope_retired", "reconfigure_restore_pending", "hybrid_unavailable", "hybrid_scope_stale", "hybrid_command_timeout", "hybrid_command_rejected", "hybrid_authority_unavailable", "fresh_sfu_restore_required", "sfu_restore_incomplete", "authenticated_pair_protocol_unavailable", "network_not_authorized", "permission_unavailable", "protected_publication_unavailable", "peer_limit", "auth_recovery_cleanup", "probe_budget_closed", "peer_path_not_admitted", "peer_media_stale", "peer_path_unstable", "peer_path_unavailable", "peer_path_inconsistent", "invalid_receive_candidate", "invalid_receive_node", "decoded_media_unavailable", "media_stale_before_switch", "operation_timeout", "invalid_pair_lease", "forwarding_ack_mismatch", "probe_failed", "restore_failed", "peer_failed", "peer_path_changed", "p2p_media_lost", "sfu_restore_retry", "receive_selection_failed", "invalid_sfu_media_sequence", "fresh_sfu_media_unavailable", "lease_renew_failed", "pause_lease_expired", "signal_relay_failed", "signal_accept_failed", "controller_stopping", "pair_invalidated", "authority_invalidated", "binding_restore_required", "binding_stale", "binding_changed", "receive_binding_retired", "stale_receive_selection", "sfu_binding_retired", "scope_changed", "invalid_scope", "route_cancelled"] as const;
const statuses = ["waiting", "created", "retired", "disabled", "unsupported", "active", "recovering", "disposed", "sfu", "queued", "probing", "switching", "p2p", "failed", "activation-required", "connecting", "connected", "disconnecting", "error"] as const;
export const ET_OBSERVATION_REASONS = ["cli-error", "cli-timeout", "parse-failed", "invalid-owned-network-status", "credential-node-ip-mismatch", "credential-node-key-conflict", "issuer-connection-unverified", "timeout", "cancelled", "other"] as const;
const forwardingReasons = ["validated_ack", "request_failed", "forwarding_ack_mismatch", "verified_media", "local_handoff_before_pause", "fresh_sfu_restored"] as const;
const evidenceEnums = {
  pathClass:["turn-relay", "non-turn-candidate", "unknown"],
  pathReason:["selected-pair", "turn-relay", "candidate-type-unknown", "candidate-unavailable", "pair-unavailable", "track-stats-unavailable", "track-stats-ambiguous"],
  localCandidateType:["host", "srflx", "prflx", "relay", "unknown"],
  remoteCandidateType:["host", "srflx", "prflx", "relay", "unknown"],
  underlayClass:["not-easytier", "easytier-direct", "easytier-relay", "unknown"],
  decodeProof:["fresh", "missing"],
  decodeReason:["track_stats_ambiguous", "track_stats_unavailable", "baseline_required", "counter_reset", "measurement_gap", "no_decode_increment", "remote_track_missing", "fresh_decode"],
  failureReason:[...HYBRID_PROTOCOL_DIAGNOSTIC_REASONS, null, "peer_publication_mismatch", "peer_decoder_unavailable", "peer_connection_lost", "peer_track_ended", "peer_codec_unavailable", "peer_decoded_media_stale", "peer_stats_reset", "peer_stats_unavailable", "peer_failure"],
  forwardingAction:["pause", "restore"], result:["acknowledged", "failed"],
  handoffStage:["peer_media_ready", "local_handoff_started", "local_handoff_completed", "sfu_restore_completed", "recovery_failed"],
} as const;
type EvidenceFields = { [K in keyof typeof evidenceEnums]?: typeof evidenceEnums[K][number] };
export const QUIT_DIAGNOSTIC_STAGES = ["tray-click", "lifecycle", "ui-retire", "owned-shutdown", "owned-core", "grant-revoke", "dns-stop", "firewall-wait", "firewall-cleanup", "user-store-flush", "global-store-flush", "final-cleanup"] as const;
export const ET_DIAGNOSTIC_REASONS = ["binding-pending", "binding-unproven", "provider-sample-conflict", "provider-observation-mismatch", "route-binding-mismatch", "duplicate-key-owner", "connection-evidence-conflict", "grant-operation-busy", "grant-operation-retired", "operation-retired", "unknown-grant", "inactive-binding-grant", "expired-grant", "reconciliation-required", "revocation-unconfirmed", "renewal-not-extended", "community-et-unavailable", "community-et-disabled", "provider-incompatible", "issuer-store-unavailable"] as const;
export interface LocalDiagnostic extends EvidenceFields {
  phase: "app" | "socket" | "api" | "lan" | "cleanup" | "voice";
  operation: typeof DIAGNOSTIC_OPERATIONS[number] | typeof NETWORK_DIAGNOSTIC_OPERATIONS[number];
  action: "start" | "send" | "receive" | "suppress" | "finish";
  code: typeof DIAGNOSTIC_CODES[number] | typeof NETWORK_DIAGNOSTIC_CODES[number];
  hostSlot?: number; retryAfterMs?: number; nextRetryMs?: number;
  elapsedMs?: number; sent?: number; suppressed?: number;
  cleanup?: "confirmed" | "pending" | "not-started";
  quitStage?: typeof QUIT_DIAGNOSTIC_STAGES[number];
  generation?: number; httpStatus?: number; scopeGeneration?: number; routeOrdinal?: number;
  routeGeneration?: number; selectionRevision?: number;
  status?: typeof statuses[number]; selected?: "sfu" | "p2p" | "none";
  reason?: typeof DIAGNOSTIC_REASONS[number] | typeof ET_DIAGNOSTIC_REASONS[number] | typeof ET_OBSERVATION_REASONS[number] | typeof forwardingReasons[number] | null;
  forwardingPaused?: boolean; connected?: boolean; rosterReady?: boolean; epochReady?: boolean;
}
const numeric = ["hostSlot", "retryAfterMs", "nextRetryMs", "elapsedMs", "sent", "suppressed", "generation", "httpStatus", "scopeGeneration", "routeOrdinal", "routeGeneration", "selectionRevision"] as const;
const booleans = ["forwardingPaused", "connected", "rosterReady", "epochReady"] as const;
const fields = new Set(["phase", "operation", "action", "code", "cleanup", "quitStage", "status", "selected", "reason", ...numeric, ...booleans, ...Object.keys(evidenceEnums)]);
export function safeDiagnostic(value: unknown): LocalDiagnostic | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !fields.has(k)) || !["app", "socket", "api", "lan", "cleanup", "voice"].includes(String(v.phase)) ||
      ![...DIAGNOSTIC_OPERATIONS, ...NETWORK_DIAGNOSTIC_OPERATIONS].includes(v.operation as LocalDiagnostic["operation"]) ||
      !["start", "send", "receive", "suppress", "finish"].includes(String(v.action)) ||
      ![...DIAGNOSTIC_CODES, ...NETWORK_DIAGNOSTIC_CODES].includes(v.code as LocalDiagnostic["code"])) return null;
  const result: LocalDiagnostic = {phase: v.phase as LocalDiagnostic["phase"], operation: v.operation as LocalDiagnostic["operation"], action: v.action as LocalDiagnostic["action"], code: v.code as LocalDiagnostic["code"]};
  for (const k of numeric) if (v[k] !== undefined) {
    if (typeof v[k] !== "number" || !Number.isFinite(v[k]) || v[k] < 0 || v[k] > (k === "hostSlot" ? 63 : k === "httpStatus" ? 599 : 3_600_000)) return null;
    result[k] = Math.floor(v[k]);
  }
  for (const k of booleans) if (v[k] !== undefined) {
    if (typeof v[k] !== "boolean") return null;
    result[k] = v[k];
  }
  if (v.status !== undefined) {
    if (!statuses.includes(v.status as NonNullable<LocalDiagnostic["status"]>)) return null;
    result.status = v.status as LocalDiagnostic["status"];
  }
  if (v.selected !== undefined) {
    if (!["sfu", "p2p", "none"].includes(String(v.selected))) return null;
    result.selected = v.selected as LocalDiagnostic["selected"];
  }
  if (v.reason !== undefined) {
    if (v.reason !== null && ![...DIAGNOSTIC_REASONS, ...ET_DIAGNOSTIC_REASONS, ...ET_OBSERVATION_REASONS, ...forwardingReasons].includes(v.reason as NonNullable<LocalDiagnostic["reason"]>)) return null;
    result.reason = v.reason as LocalDiagnostic["reason"];
  }
  for (const key of Object.keys(evidenceEnums) as Array<keyof typeof evidenceEnums>) if (v[key] !== undefined) {
    if (!(evidenceEnums[key] as readonly unknown[]).includes(v[key])) return null;
    Object.assign(result, { [key]:v[key] });
  }
  if (v.cleanup !== undefined) {
    if (!["confirmed", "pending", "not-started"].includes(String(v.cleanup))) return null;
    result.cleanup = v.cleanup as LocalDiagnostic["cleanup"];
  }
  if (v.quitStage !== undefined) {
    if (!QUIT_DIAGNOSTIC_STAGES.includes(v.quitStage as NonNullable<LocalDiagnostic["quitStage"]>) ||
        v.phase !== "cleanup" || v.operation !== "app-quit") return null;
    result.quitStage = v.quitStage as LocalDiagnostic["quitStage"];
  }
  return result;
}
export function diagnosticCode(value: unknown): LocalDiagnostic["code"] {
  return [...DIAGNOSTIC_CODES, ...NETWORK_DIAGNOSTIC_CODES].includes(value as LocalDiagnostic["code"]) ? value as LocalDiagnostic["code"] : "other";
}
export function diagnosticOperation(value: unknown): LocalDiagnostic["operation"] {
  return [...DIAGNOSTIC_OPERATIONS, ...NETWORK_DIAGNOSTIC_OPERATIONS].includes(value as LocalDiagnostic["operation"]) ? value as LocalDiagnostic["operation"] : "other";
}
const hostSlots = new Map<string, number>();
export function diagnosticHostSlot(host: string): number {
  const existing = hostSlots.get(host); if (existing !== undefined) return existing;
  if (hostSlots.size >= 63) return 63;
  const slot = hostSlots.size; hostSlots.set(host, slot); return slot;
}
export function localDiagnostic(value: LocalDiagnostic): void {
  const api = (window as unknown as {laokuaiDiagnostics?: {record(value: LocalDiagnostic): void}}).laokuaiDiagnostics;
  const clean = safeDiagnostic(value); if (clean) api?.record(clean);
}
