/** Fixed local diagnostics schema. Never pass payloads, identities or free text. */
export const DIAGNOSTIC_OPERATIONS = ["app-bootstrap", "app-quit", "server:join", "server:verify", "server:joined", "server:details", "server:error", "token:refresh", "token:refreshed", "token:error", "token:revoked", "voice-state", "voice:room:granted", "voice:room:leave", "voice:kicked", "voice:device:disconnect", "server:kicked", "server:session:replaced", "voice:room:request", "voice:room:error", "voice:channel:joined", "connect", "connect_error", "disconnect", "credential-session", "credential-acquire", "credential-renew", "credential-revoke", "credential-binding", "core-start", "core-stop", "other"] as const;
export const DIAGNOSTIC_CODES = ["ok", "other", "token_invalid", "unidentified", "requesting_access", "connecting", "connected", "reconnecting", "failed", "disconnected", "media-policy-changed", "connection-lost", "reconnect-failed", "rate_limited", "join_required", "invalid_token", "invalid_access_token", "refresh_token_invalid", "refresh_token_expired", "token_version_mismatch", "user_token_version_mismatch", "forbidden", "membership_required", "banned", "auth-unavailable", "provider-unavailable", "configuration-required", "needs-permission", "cleanup-failed", "connect_error", "transport-close", "http-400", "http-401", "http-403", "http-429", "http-500", "http-503"] as const;
export interface LocalDiagnostic {
  phase: "app" | "socket" | "api" | "lan" | "cleanup";
  operation: typeof DIAGNOSTIC_OPERATIONS[number];
  action: "start" | "send" | "receive" | "suppress" | "finish";
  code: typeof DIAGNOSTIC_CODES[number];
  hostSlot?: number; retryAfterMs?: number; nextRetryMs?: number;
  elapsedMs?: number; sent?: number; suppressed?: number;
  cleanup?: "confirmed" | "pending" | "not-started";
}
const fields = new Set(["phase", "operation", "action", "code", "hostSlot", "retryAfterMs", "nextRetryMs", "elapsedMs", "sent", "suppressed", "cleanup"]);
const numeric = ["hostSlot", "retryAfterMs", "nextRetryMs", "elapsedMs", "sent", "suppressed"] as const;
export function safeDiagnostic(value: unknown): LocalDiagnostic | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !fields.has(k)) || !["app", "socket", "api", "lan", "cleanup"].includes(String(v.phase)) ||
      !DIAGNOSTIC_OPERATIONS.includes(v.operation as LocalDiagnostic["operation"]) ||
      !["start", "send", "receive", "suppress", "finish"].includes(String(v.action)) ||
      !DIAGNOSTIC_CODES.includes(v.code as LocalDiagnostic["code"])) return null;
  const result: LocalDiagnostic = {phase: v.phase as LocalDiagnostic["phase"], operation: v.operation as LocalDiagnostic["operation"], action: v.action as LocalDiagnostic["action"], code: v.code as LocalDiagnostic["code"]};
  for (const k of numeric) if (v[k] !== undefined) {
    if (typeof v[k] !== "number" || !Number.isFinite(v[k]) || v[k] < 0 || v[k] > (k === "hostSlot" ? 63 : 3_600_000)) return null;
    result[k] = Math.floor(v[k]);
  }
  if (v.cleanup !== undefined) {
    if (!["confirmed", "pending", "not-started"].includes(String(v.cleanup))) return null;
    result.cleanup = v.cleanup as LocalDiagnostic["cleanup"];
  }
  return result;
}
export function diagnosticCode(value: unknown): LocalDiagnostic["code"] {
  return DIAGNOSTIC_CODES.includes(value as LocalDiagnostic["code"]) ? value as LocalDiagnostic["code"] : "other";
}
export function diagnosticOperation(value: unknown): LocalDiagnostic["operation"] {
  return DIAGNOSTIC_OPERATIONS.includes(value as LocalDiagnostic["operation"]) ? value as LocalDiagnostic["operation"] : "other";
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
