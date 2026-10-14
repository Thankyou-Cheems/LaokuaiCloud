import type {
  ReceiveCandidateEndpoint,
  ReceiveCandidateType,
  ReceivePairUnavailableReason,
  ReceiveTrackObservation,
  ReceiveTransportPathEvidence,
  ReceiveTransportPathReason,
  ReceiveTransportPathSummary,
} from "../types/ReceivePath";

const flights = new WeakMap<RTCPeerConnection, Promise<RTCStatsReport>>();
const latest = new WeakMap<RTCPeerConnection, { report: RTCStatsReport; at: number }>();
const epochs = new WeakMap<RTCPeerConnection, number>();
let epoch = 0;
export function receiveConnectionEpoch(pc: RTCPeerConnection | null): number | null {
  if (!pc) return null;
  let value = epochs.get(pc); if (value === undefined) { value = ++epoch; epochs.set(pc, value); }
  return value;
}
/** Shared flights only; active media monitors still request every required fresh checkpoint. */
export function readReceiveStats(pc: RTCPeerConnection): Promise<RTCStatsReport> {
  const prior = flights.get(pc); if (prior) return prior;
  const result = pc.getStats();
  void result.then(report => { latest.set(pc, { report, at: performance.now() }); }).catch(() => {});
  flights.set(pc, result);
  void result.finally(() => { if (flights.get(pc) === result) flights.delete(pc); }).catch(() => {});
  return result;
}
export function receiveStatsFlight(pc: RTCPeerConnection): Promise<RTCStatsReport> | undefined { return flights.get(pc); }
export function cachedReceiveStats(pc: RTCPeerConnection, maxAgeMs = 1000): { report: RTCStatsReport; at: number } | null {
  const value = latest.get(pc); return value && performance.now() - value.at <= maxAgeMs ? value : null;
}
interface Counters { at: number; rowId: string; packets: number; samples: number; lost: number | null;
  pairId: string | null; responses: number | null }
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

const candidateType = (value: unknown): ReceiveCandidateType =>
  value === "host" || value === "srflx" || value === "prflx" || value === "relay" ? value : "unknown";
const optionalText = (value: unknown): string | null => typeof value === "string" && value.length > 0 ? value : null;
const optionalPort = (value: unknown): number | null => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 65535 ? value as number : null;

function endpoint(report: RTCStatsReport, id: unknown, type: "local-candidate" | "remote-candidate"): ReceiveCandidateEndpoint | null {
  if (typeof id !== "string" || id.length === 0) return null;
  const row: any = report.get(id);
  if (!row || row.type !== type) return null;
  return { candidateId: id, candidateType: candidateType(row.candidateType),
    address: optionalText(row.address) ?? optionalText(row.ip), port: optionalPort(row.port), protocol: optionalText(row.protocol) };
}

const summary = (path: ReceiveTransportPathEvidence): ReceiveTransportPathSummary => ({
  classification: path.classification, pairId: path.pairId,
  localCandidateType: path.local?.candidateType ?? null, remoteCandidateType: path.remote?.candidateType ?? null,
  underlay: path.underlay?.classification ?? null,
});

const unknownPath = (observedAtMs: number, reason: ReceiveTransportPathReason, pairId: string | null = null,
  local: ReceiveCandidateEndpoint | null = null, remote: ReceiveCandidateEndpoint | null = null,
  pairUnavailableReason: ReceivePairUnavailableReason | null = null): ReceiveTransportPathEvidence => ({
  source: "rtc-selected-candidate-pair", observedAtMs, classification: "unknown", reason, pairId, local, remote, underlay: null,
  pairUnavailableReason,
});

/** Resolve this exact inbound track to its selected pair and candidate records.
 * Non-TURN alone never proves physical or EasyTier direct routing. */
export function readReceiveTransportPath(report: RTCStatsReport, trackId: string, at: number): ReceiveTransportPathEvidence {
  const rows: any[] = []; report.forEach(row => {
    if (row.type === "inbound-rtp" && (row.kind ?? row.mediaType) === "audio" && row.trackIdentifier === trackId) rows.push(row);
  });
  if (rows.length !== 1) return unknownPath(at, rows.length > 1 ? "track-stats-ambiguous" : "track-stats-unavailable");
  const transport: any = report.get(rows[0].transportId);
  if (!transport || transport.type !== "transport" || typeof transport.selectedCandidatePairId !== "string" || transport.selectedCandidatePairId.length === 0) {
    return unknownPath(at, "pair-unavailable", null, null, null, "transport-unavailable");
  }
  const pairId = transport.selectedCandidatePairId, pair: any = report.get(pairId);
  if (!pair || pair.type !== "candidate-pair") return unknownPath(at, "pair-unavailable", pairId, null, null, "pair-record-unavailable");
  if (pair.state !== "succeeded") return unknownPath(at, "pair-unavailable", pairId, null, null, "pair-not-succeeded");
  const local = endpoint(report, pair.localCandidateId, "local-candidate"), remote = endpoint(report, pair.remoteCandidateId, "remote-candidate");
  if (!local || !remote) return unknownPath(at, "candidate-unavailable", pairId, local, remote);
  if (local.candidateType === "relay" || remote.candidateType === "relay") {
    return { source: "rtc-selected-candidate-pair", observedAtMs: at, classification: "turn-relay", reason: "turn-relay", pairId, local, remote, underlay: null };
  }
  if (local.candidateType === "unknown" || remote.candidateType === "unknown") {
    return unknownPath(at, "candidate-type-unknown", pairId, local, remote);
  }
  return { source: "rtc-selected-candidate-pair", observedAtMs: at, classification: "non-turn-candidate", reason: "selected-pair", pairId, local, remote, underlay: null };
}

/** Exact track only; the parser never guesses an ICE pair from a candidate list or aggregate RTP. */
export class ReceiveTrackStats {
  private previous?: Counters;
  observe(report: RTCStatsReport, trackId: string, at: number): ReceiveTrackObservation {
    const rows: any[] = []; report.forEach(row => {
      if (row.type === "inbound-rtp" && (row.kind ?? row.mediaType) === "audio" && row.trackIdentifier === trackId) rows.push(row);
    });
    const row = rows.length === 1 ? rows[0] : undefined;
    const transportPath = readReceiveTransportPath(report, trackId, at);
    const empty = { selectedPairId: null, rttMs: null, rttWindow: null, rttSource: "rtc-selected-candidate-pair" as const,
      lossFraction: null, lossWindow: null, lossSource: "exact-audio-track-inbound-rtp" as const,
      path: summary(transportPath) };
    if (!row || !count(row.packetsReceived) || !count(row.totalSamplesReceived)) {
      this.previous = undefined; return { trackId, observedAtMs: at, reason: rows.length > 1 ? "track_stats_ambiguous" : "track_stats_unavailable", decode: null, metrics: empty, transportPath };
    }
    const transport = report.get(row.transportId), pair = transport?.type === "transport" ? report.get(transport.selectedCandidatePairId) : undefined;
    const pairId = pair?.type === "candidate-pair" && pair.state === "succeeded" ? pair.id : null;
    const next: Counters = { at, rowId: row.id, packets: row.packetsReceived, samples: row.totalSamplesReceived,
      lost: Number.isSafeInteger(row.packetsLost) ? row.packetsLost : null, pairId,
      responses: pairId && count(pair.responsesReceived) ? pair.responsesReceived : null };
    const prior = this.previous; this.previous = next;
    const metrics: ReceiveTrackObservation["metrics"] = { ...empty, selectedPairId: pairId };
    if (!prior || prior.rowId !== next.rowId) return { trackId, observedAtMs: at, reason: "baseline_required", decode: null, metrics, transportPath };
    if (at <= prior.at || next.packets < prior.packets || next.samples < prior.samples) {
      return { trackId, observedAtMs: at, reason: "counter_reset", decode: null, metrics, transportPath };
    }
    if (at - prior.at > 3000) return { trackId, observedAtMs: at, reason: "measurement_gap", decode: null, metrics, transportPath };
    const decode = { startAtMs: prior.at, endAtMs: at, packetsDelta: next.packets - prior.packets,
      samplesDelta: next.samples - prior.samples, decodedFramesDelta: next.samples - prior.samples,
      fresh: next.packets > prior.packets && next.samples > prior.samples,
      source: "rtc-inbound-rtp-totalSamplesReceived" as const };
    if (decode.fresh) {
      if (next.lost !== null && prior.lost !== null && next.lost >= prior.lost) {
        const lost = next.lost - prior.lost, received = decode.packetsDelta;
        if (received + lost > 0) { metrics.lossFraction = lost / (received + lost); metrics.lossWindow = { startAtMs: prior.at, endAtMs: at, received, lost }; }
      }
      if (pairId && pairId === prior.pairId && next.responses !== null && prior.responses !== null && next.responses > prior.responses &&
        typeof pair.currentRoundTripTime === "number" && Number.isFinite(pair.currentRoundTripTime) && pair.currentRoundTripTime >= 0) {
        metrics.rttMs = pair.currentRoundTripTime * 1000; metrics.rttWindow = { startAtMs: prior.at, endAtMs: at };
      }
    }
    return { trackId, observedAtMs: at, reason: decode.fresh ? null : "no_decode_increment", decode, metrics, transportPath };
  }
}
