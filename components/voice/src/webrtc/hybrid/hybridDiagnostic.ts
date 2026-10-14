import type { ReceiveCandidateType, ReceivePairUnavailableReason, ReceiveTrackObservation, ReceiveTransportPathClass, ReceiveTransportPathReason, ReceiveUnderlayClass } from "../types/ReceivePath";

const failures = ["peer_publication_mismatch", "peer_decoder_unavailable", "peer_connection_lost", "peer_track_ended",
  "peer_codec_unavailable", "peer_decoded_media_stale", "peer_stats_reset", "peer_stats_unavailable"] as const;
type PeerFailure = typeof failures[number] | "peer_failure";
const decodeReasons = ["track_stats_ambiguous", "track_stats_unavailable", "baseline_required", "counter_reset",
  "measurement_gap", "no_decode_increment"] as const;
type DecodeReason = typeof decodeReasons[number] | "remote_track_missing" | "fresh_decode";
const protocolFailures = ["hybrid_disabled", "hybrid_unsupported", "hybrid_unauthenticated", "hybrid_permission_denied", "hybrid_protocol_invalid",
  "hybrid_authority_failed", "hybrid_scope_stale", "hybrid_pair_stale", "hybrid_release_failed", "hybrid_sfu_ack_failed",
  "hybrid_sfu_unavailable", "hybrid_sfu_ack_timeout", "hybrid_sfu_disconnected", "hybrid_operation_stale", "hybrid_cleanup_conflict",
  "hybrid_sfu_unauthorized_server", "hybrid_sfu_invalid_hybrid_command", "hybrid_sfu_invalid_hybrid_room", "hybrid_sfu_source_permission_revoked",
  "hybrid_sfu_peer_generation_changed", "hybrid_sfu_ambiguous_publication", "hybrid_sfu_publication_unavailable", "hybrid_sfu_invalid_audio_lease",
  "hybrid_sfu_source_retired", "hybrid_sfu_receiver_unavailable", "hybrid_sfu_invalid_pause_duration", "hybrid_sfu_stale_audio_lease",
  "hybrid_sfu_authority_generation_conflict", "hybrid_sfu_pair_generation_conflict", "operation_timeout", "route_cancelled"] as const;
/** Fixed protocol codes only; arbitrary thrown text never crosses the media observer. */
export function hybridProtocolFailure(error: unknown): typeof protocolFailures[number] | undefined {
  return error instanceof Error ? protocolFailures.find(code => code === error.message) : undefined;
}

/** Only fixed classifications; no identities, endpoints, SDP, tokens or raw errors. */
export type BrowserHybridDiagnostic = {
  kind: "peer-media";
  pathClass: ReceiveTransportPathClass;
  pathReason: ReceiveTransportPathReason;
  pairUnavailableReason?: ReceivePairUnavailableReason | null;
  localCandidateType: ReceiveCandidateType;
  remoteCandidateType: ReceiveCandidateType;
  underlayClass: ReceiveUnderlayClass;
  decodeProof: "fresh" | "missing";
  decodeReason: DecodeReason;
  failureReason: PeerFailure | null;
} | {
  kind: "forwarding";
  action: "pause" | "restore";
  result: "acknowledged" | "failed";
  reason: "validated_ack" | "request_failed" | "forwarding_ack_mismatch";
  failureReason?: typeof protocolFailures[number];
  elapsedMs?: number;
} | {
  kind: "handoff";
  stage: "peer_media_ready" | "local_handoff_started" | "local_handoff_completed" | "sfu_restore_completed" | "recovery_failed";
  elapsedMs: number;
  reason: "verified_media" | "local_handoff_before_pause" | "fresh_sfu_restored" | "restore_failed";
};

export function peerMediaDiagnostic(observation: ReceiveTrackObservation | null, failure?: string): BrowserHybridDiagnostic {
  const path = observation?.transportPath;
  const candidate = (value: unknown): ReceiveCandidateType => ["host", "srflx", "prflx", "relay"].includes(value as string)
    ? value as ReceiveCandidateType : "unknown";
  const pathClass: ReceiveTransportPathClass = path?.classification === "turn-relay" || path?.classification === "non-turn-candidate" ? path.classification : "unknown";
  const reasons: ReceiveTransportPathReason[] = ["selected-pair", "turn-relay", "candidate-type-unknown", "candidate-unavailable", "pair-unavailable", "track-stats-unavailable", "track-stats-ambiguous"];
  const underlay = path?.underlay?.classification;
  const fresh = observation?.decode?.fresh === true && !failure;
  const pairReasons: ReceivePairUnavailableReason[] = ["transport-unavailable", "pair-record-unavailable", "pair-not-succeeded"];
  return { kind: "peer-media", pathClass, pathReason: path && reasons.includes(path.reason) ? path.reason : "pair-unavailable",
    pairUnavailableReason: path?.reason === "pair-unavailable" && pairReasons.includes(path.pairUnavailableReason as ReceivePairUnavailableReason)
      ? path.pairUnavailableReason : null,
    localCandidateType: candidate(path?.local?.candidateType), remoteCandidateType: candidate(path?.remote?.candidateType),
    underlayClass: underlay === "not-easytier" || underlay === "easytier-direct" || underlay === "easytier-relay" ? underlay : "unknown",
    decodeProof: fresh ? "fresh" : "missing", decodeReason: fresh ? "fresh_decode" : !observation ? "remote_track_missing"
      : decodeReasons.includes(observation.reason as typeof decodeReasons[number]) ? observation.reason as typeof decodeReasons[number] : "no_decode_increment",
    failureReason: !failure ? null : failures.includes(failure as typeof failures[number]) ? failure as typeof failures[number] : "peer_failure" };
}

/** Per-minute cap plus per-kind dedup/rate bound. Observers cannot affect routing. */
export function createHybridDiagnosticReporter(observer?: (event: BrowserHybridDiagnostic) => void): (event: BrowserHybridDiagnostic) => void {
  let count = 0;
  let windowStart = performance.now();
  const last = new Map<string, { key: string; at: number }>();
  return event => {
    if (!observer) return;
    const at = performance.now();
    if (at - windowStart >= 60000) { windowStart = at; count = 0; last.clear(); }
    if (count >= 128) return;
    const kind = event.kind === "forwarding" ? `${event.kind}:${event.action}:${event.result}`
      : event.kind === "handoff" ? `${event.kind}:${event.stage}`
      : event.failureReason ? "peer-media:failure" : event.kind;
    const key = JSON.stringify(event), prior = last.get(kind);
    if (prior && (prior.key === key || at - prior.at < 1000)) return;
    last.set(kind, { key, at }); ++count;
    try { observer({ ...event }); } catch { /* Diagnostic observers do not own media. */ }
  };
}
