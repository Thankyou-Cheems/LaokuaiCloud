import type { ReceiveCandidateType, ReceiveTrackObservation, ReceiveTransportPathClass, ReceiveTransportPathReason, ReceiveUnderlayClass } from "../types/ReceivePath";

const failures = ["peer_publication_mismatch", "peer_decoder_unavailable", "peer_connection_lost", "peer_track_ended",
  "peer_codec_unavailable", "peer_decoded_media_stale", "peer_stats_reset", "peer_stats_unavailable"] as const;
type PeerFailure = typeof failures[number] | "peer_failure";
const decodeReasons = ["track_stats_ambiguous", "track_stats_unavailable", "baseline_required", "counter_reset",
  "measurement_gap", "no_decode_increment"] as const;
type DecodeReason = typeof decodeReasons[number] | "remote_track_missing" | "fresh_decode";

/** Only fixed classifications; no identities, endpoints, SDP, tokens or raw errors. */
export type BrowserHybridDiagnostic = {
  kind: "peer-media";
  pathClass: ReceiveTransportPathClass;
  pathReason: ReceiveTransportPathReason;
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
};

export function peerMediaDiagnostic(observation: ReceiveTrackObservation | null, failure?: string): BrowserHybridDiagnostic {
  const path = observation?.transportPath;
  const candidate = (value: unknown): ReceiveCandidateType => ["host", "srflx", "prflx", "relay"].includes(value as string)
    ? value as ReceiveCandidateType : "unknown";
  const pathClass: ReceiveTransportPathClass = path?.classification === "turn-relay" || path?.classification === "non-turn-candidate" ? path.classification : "unknown";
  const reasons: ReceiveTransportPathReason[] = ["selected-pair", "turn-relay", "candidate-type-unknown", "candidate-unavailable", "pair-unavailable", "track-stats-unavailable", "track-stats-ambiguous"];
  const underlay = path?.underlay?.classification;
  const fresh = observation?.decode?.fresh === true && !failure;
  return { kind: "peer-media", pathClass, pathReason: path && reasons.includes(path.reason) ? path.reason : "pair-unavailable",
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
      : event.failureReason ? "peer-media:failure" : event.kind;
    const key = JSON.stringify(event), prior = last.get(kind);
    if (prior && (prior.key === key || at - prior.at < 1000)) return;
    last.set(kind, { key, at }); ++count;
    try { observer({ ...event }); } catch { /* Diagnostic observers do not own media. */ }
  };
}
