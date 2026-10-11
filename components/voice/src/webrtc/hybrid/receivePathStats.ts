import type { ReceiveTrackObservation } from "../types/ReceivePath";

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
/** Exact track only; the parser never guesses an ICE pair from a candidate list or aggregate RTP. */
export class ReceiveTrackStats {
  private previous?: Counters;
  observe(report: RTCStatsReport, trackId: string, at: number): ReceiveTrackObservation {
    const rows: any[] = []; report.forEach(row => {
      if (row.type === "inbound-rtp" && (row.kind ?? row.mediaType) === "audio" && row.trackIdentifier === trackId) rows.push(row);
    });
    const row = rows.length === 1 ? rows[0] : undefined;
    const empty = { selectedPairId: null, rttMs: null, rttWindow: null, rttSource: "rtc-selected-candidate-pair" as const,
      lossFraction: null, lossWindow: null, lossSource: "exact-audio-track-inbound-rtp" as const };
    if (!row || !count(row.packetsReceived) || !count(row.totalSamplesReceived)) {
      this.previous = undefined; return { trackId, observedAtMs: at, reason: rows.length > 1 ? "track_stats_ambiguous" : "track_stats_unavailable", decode: null, metrics: empty };
    }
    const transport = report.get(row.transportId), pair = transport?.type === "transport" ? report.get(transport.selectedCandidatePairId) : undefined;
    const pairId = pair?.type === "candidate-pair" && pair.state === "succeeded" ? pair.id : null;
    const next: Counters = { at, rowId: row.id, packets: row.packetsReceived, samples: row.totalSamplesReceived,
      lost: Number.isSafeInteger(row.packetsLost) ? row.packetsLost : null, pairId,
      responses: pairId && count(pair.responsesReceived) ? pair.responsesReceived : null };
    const prior = this.previous; this.previous = next;
    const metrics: ReceiveTrackObservation["metrics"] = { ...empty, selectedPairId: pairId };
    if (!prior || prior.rowId !== next.rowId) return { trackId, observedAtMs: at, reason: "baseline_required", decode: null, metrics };
    if (at <= prior.at || next.packets < prior.packets || next.samples < prior.samples) {
      return { trackId, observedAtMs: at, reason: "counter_reset", decode: null, metrics };
    }
    if (at - prior.at > 3000) return { trackId, observedAtMs: at, reason: "measurement_gap", decode: null, metrics };
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
    return { trackId, observedAtMs: at, reason: decode.fresh ? null : "no_decode_increment", decode, metrics };
  }
}
