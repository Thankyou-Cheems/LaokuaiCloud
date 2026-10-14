import type { BrowserHybridDiagnostic, BrowserHybridVoiceState } from "@gryt/voice";

import { DIAGNOSTIC_REASONS as HYBRID_DIAGNOSTIC_REASONS, HYBRID_PROTOCOL_DIAGNOSTIC_REASONS, localDiagnostic } from "./localDiagnostics";

export { HYBRID_PROTOCOL_DIAGNOSTIC_REASONS } from "./localDiagnostics";

/** Fixed enum: SDK errors and observer input never become free text in local logs. */
export { HYBRID_DIAGNOSTIC_REASONS };
type Reason = typeof HYBRID_DIAGNOSTIC_REASONS[number] | "validated_ack" | "request_failed";
type PeerDiagnostic = Extract<BrowserHybridDiagnostic, { kind: "peer-media" }>;
type ForwardingDiagnostic = Extract<BrowserHybridDiagnostic, { kind: "forwarding" }>;
type HandoffDiagnostic = Extract<BrowserHybridDiagnostic, { kind: "handoff" }>;
export interface HybridDiagnostic {
  operation: "hybrid-scope" | "hybrid-route" | "hybrid-path" | "hybrid-forwarding" | "hybrid-handoff";
  scopeGeneration: number;
  status: "waiting" | "created" | "retired" | BrowserHybridVoiceState["status"] | "sfu" | "queued" | "probing" | "switching" | "p2p" | "failed";
  reason: Reason | HandoffDiagnostic["reason"] | null;
  handoffStage?: HandoffDiagnostic["stage"];
  elapsedMs?: number;
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
  failureReason?: PeerDiagnostic["failureReason"] | ForwardingDiagnostic["failureReason"];
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
    } : event.kind === "handoff" ? {
      operation: "hybrid-handoff", scopeGeneration, status: event.stage === "recovery_failed" ? "recovering" : "active",
      handoffStage: event.stage, elapsedMs: Math.min(bounded(event.elapsedMs), 60_000), reason: event.reason,
    } : { operation: "hybrid-forwarding", scopeGeneration, status: event.result === "failed" ? "recovering" : "active",
      forwardingAction: event.action, result: event.result, reason: event.reason,
      ...("failureReason" in event && HYBRID_PROTOCOL_DIAGNOSTIC_REASONS.includes(event.failureReason as typeof HYBRID_PROTOCOL_DIAGNOSTIC_REASONS[number]) ?
        { failureReason: event.failureReason as ForwardingDiagnostic["failureReason"] } : {}),
      ...(event.elapsedMs === undefined ? {} : { elapsedMs: Math.min(bounded(event.elapsedMs), 60_000) }) };
    // Media snapshots repeat on every stats poll. Command/handoff events are finite
    // attempts; retain their timings even when a retry has the same outcome.
    if (event.kind === "peer-media") {
      const signature = JSON.stringify(value); if (previousSdk.get(event.kind) === signature) return;
      previousSdk.set(event.kind, signature);
    }
    emit(value);
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
