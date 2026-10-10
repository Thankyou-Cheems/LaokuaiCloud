export interface VoicePacketSample { windowMs: number; packetsReceived: number; packetsLost: number }
export interface VoiceQualityReport {
  schemaVersion: 1; connectionGeneration: number; seq: number; iceRttMs: number | null;
  uplink: { rttMs: number | null; sample: VoicePacketSample | null } | null;
  receive: { jitterMaxMs: number | null; sample: VoicePacketSample | null } | null;
}
type Stat = Record<string, unknown> & { id: string; type: string };
type Counter = { timestamp: number; received: number; lost: number };
function milliseconds(seconds: unknown): number | null {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0 && seconds <= 60 ? seconds * 1000 : null;
}
function counter(row: Stat): Counter | undefined {
  const { timestamp, packetsReceived, packetsLost } = row;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp < 0 ||
      !Number.isSafeInteger(packetsReceived) || !Number.isSafeInteger(packetsLost) ||
      (packetsReceived as number) < 0 || (packetsLost as number) < 0) return undefined;
  return { timestamp, received: packetsReceived as number, lost: packetsLost as number };
}
function audio(row: Stat): boolean { return row.kind === "audio" || row.mediaType === "audio"; }

/** Raw reports stay local. Each instance belongs to one actual PC generation. */
export class VoiceQualitySampler {
  private seq = 0;
  private previous = new Map<string, Counter>();
  constructor(private readonly generation: number) {
    if (!Number.isSafeInteger(generation) || generation <= 0) throw new Error("invalid_connection_generation");
  }
  sample(values: Iterable<unknown>, microphoneTrackId: string | undefined): VoiceQualityReport {
    const rows = [...values].filter((value): value is Stat => !!value && typeof value === "object" &&
      typeof (value as Stat).id === "string" && typeof (value as Stat).type === "string");
    const byId = new Map(rows.map(row => [row.id, row]));
    const next = new Map<string, Counter>();
    const delta = (row: Stat): VoicePacketSample | null => {
      const current = counter(row); if (!current) return null;
      next.set(row.id, current); const prior = this.previous.get(row.id); if (!prior) return null;
      const windowMs = current.timestamp - prior.timestamp;
      const received = current.received - prior.received; const lost = current.lost - prior.lost;
      const total = received + lost;
      if (windowMs < 500 || windowMs > 10000 || received < 0 || lost < 0 || total <= 0 ||
          !Number.isSafeInteger(total) || total > 20000 * windowMs / 1000) return null;
      return { windowMs, packetsReceived: received, packetsLost: lost };
    };
    const pairs = new Set(rows.filter(row => row.type === "transport").map(row => row.selectedCandidatePairId).filter(id => typeof id === "string"));
    const pair = pairs.size === 1 ? byId.get([...pairs][0] as string) : undefined;
    const iceRttMs = pair?.type === "candidate-pair" && pair.state === "succeeded" ? milliseconds(pair.currentRoundTripTime) : null;
    const outbound = rows.filter(row => {
      if (row.type !== "outbound-rtp" || !audio(row) || !microphoneTrackId) return false;
      const source = typeof row.mediaSourceId === "string" ? byId.get(row.mediaSourceId) : undefined;
      return source?.trackIdentifier === microphoneTrackId || row.trackIdentifier === microphoneTrackId;
    });
    let uplink: VoiceQualityReport["uplink"] = null;
    if (outbound.length === 1) {
      const local = outbound[0];
      const remote = rows.filter(row => row.type === "remote-inbound-rtp" && audio(row) &&
        (row.localId === local.id || local.remoteId === row.id) &&
        (typeof row.localId !== "string" || row.localId === local.id) &&
        (typeof local.remoteId !== "string" || local.remoteId === row.id));
      if (remote.length === 1) uplink = { rttMs: milliseconds(remote[0].roundTripTime), sample: delta(remote[0]) };
    }
    const inbound = rows.filter(row => row.type === "inbound-rtp" && audio(row));
    let receive: VoiceQualityReport["receive"] = null;
    if (inbound.length) {
      const jitters = inbound.map(row => milliseconds(row.jitter));
      const samples = inbound.map(delta);
      let sample: VoicePacketSample | null = null;
      if (samples.every((value): value is VoicePacketSample => value !== null)) {
        const times = samples.map(value => value.windowMs);
        const windowMs = Math.max(...times);
        const packetsReceived = samples.reduce((sum, value) => sum + value.packetsReceived, 0);
        const packetsLost = samples.reduce((sum, value) => sum + value.packetsLost, 0);
        if (Math.max(...times) - Math.min(...times) <= 100 && Number.isSafeInteger(packetsReceived + packetsLost) &&
            packetsReceived + packetsLost <= 20000 * windowMs / 1000) sample = { windowMs, packetsReceived, packetsLost };
      }
      receive = { jitterMaxMs: jitters.every(value => value !== null) ? Math.max(...jitters as number[]) : null, sample };
    }
    this.previous = next;
    return { schemaVersion: 1, connectionGeneration: this.generation, seq: ++this.seq, iceRttMs, uplink, receive };
  }
}
