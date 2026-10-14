import type { StreamSources, SFUInterface } from "./SFU";
import type { HybridScope } from "./Hybrid";

export interface ReceivePathScope {
  source: "host-authenticated-connection";
  /** Host-owned account/server/socket/room binding; not a telemetry-derived identity. */
  bindingId: string;
  serverId: string;
  roomId: string;
  localSessionId: string;
  canReceive: boolean;
}
export interface ReceivePathBinding {
  participantId: string;
  sessionId: string | null;
  publicationId: string;
  role: "microphone" | "screen" | "unknown";
  source: StreamSources[string];
}
export interface ReceiveDecodeWindow {
  startAtMs: number;
  endAtMs: number;
  packetsDelta: number;
  samplesDelta: number;
  /** PCM sample frames per channel, including concealed samples; not Opus packet frames. */
  decodedFramesDelta: number;
  fresh: boolean;
  source: "rtc-inbound-rtp-totalSamplesReceived";
}

/** Candidate types exposed by the WebRTC stats object. Unknown stays unknown. */
export type ReceiveCandidateType = "host" | "srflx" | "prflx" | "relay" | "unknown";

/** The exact candidate endpoint referenced by the selected candidate pair. */
export interface ReceiveCandidateEndpoint {
  candidateId: string;
  candidateType: ReceiveCandidateType;
  address: string | null;
  port: number | null;
  protocol: string | null;
}

export type ReceiveTransportPathClass = "turn-relay" | "non-turn-candidate" | "unknown";
export type ReceiveTransportPathReason = "selected-pair" | "turn-relay" | "candidate-type-unknown" |
  "candidate-unavailable" | "pair-unavailable" | "track-stats-unavailable" | "track-stats-ambiguous";
/** Fixed detail for the three distinct selected-pair lookup failures. */
export type ReceivePairUnavailableReason = "transport-unavailable" | "pair-record-unavailable" | "pair-not-succeeded";
export type ReceiveUnderlayClass = "not-easytier" | "easytier-direct" | "easytier-relay" | "unknown";

/** Host supplied underlay evidence. It never upgrades the ICE class by itself. */
export interface ReceiveUnderlayEvidence {
  classification: ReceiveUnderlayClass;
  source: "host-underlay-resolver";
  observedAtMs: number;
}

/** Optional in-memory ET/VPN seam. Implementations must not log the supplied endpoints. */
export interface ReceivePathUnderlayResolver {
  resolve(path: ReceiveTransportPathEvidence): ReceiveUnderlayEvidence | null;
}

/** Exact track-scoped selected transport. Non-TURN is deliberately not physical-direct. */
export interface ReceiveTransportPathEvidence {
  source: "rtc-selected-candidate-pair";
  observedAtMs: number;
  classification: ReceiveTransportPathClass;
  reason: ReceiveTransportPathReason;
  pairUnavailableReason?: ReceivePairUnavailableReason | null;
  pairId: string | null;
  local: ReceiveCandidateEndpoint | null;
  remote: ReceiveCandidateEndpoint | null;
  underlay: ReceiveUnderlayEvidence | null;
}

/** Safe summary used by the existing metrics/UI projection; it contains no endpoint address. */
export interface ReceiveTransportPathSummary {
  classification: ReceiveTransportPathClass;
  pairId: string | null;
  localCandidateType: ReceiveCandidateType | null;
  remoteCandidateType: ReceiveCandidateType | null;
  underlay: ReceiveUnderlayClass | null;
}

export interface ReceiveTransportMetrics {
  /** Local opaque stats ID; the safe path summary below contains no endpoint address. */
  selectedPairId: string | null;
  rttMs: number | null;
  rttWindow: { startAtMs: number; endAtMs: number } | null;
  rttSource: "rtc-selected-candidate-pair";
  lossFraction: number | null;
  lossWindow: { startAtMs: number; endAtMs: number; received: number; lost: number } | null;
  lossSource: "exact-audio-track-inbound-rtp";
  /** Exact selected-pair classification, without raw endpoint addresses. */
  path: ReceiveTransportPathSummary;
}
export interface ReceiveTrackObservation {
  trackId: string;
  observedAtMs: number;
  reason: string | null;
  decode: ReceiveDecodeWindow | null;
  metrics: ReceiveTransportMetrics;
  /** Full endpoint evidence remains in memory for the selection owner. */
  transportPath: ReceiveTransportPathEvidence;
}
export interface ReceiveSourceSelection {
  current: boolean;
  kind: "sfu" | "p2p" | "none";
  track: MediaStreamTrack | null;
  revision: number;
  routeGeneration: number | null;
  status: string;
  reason: string | null;
  hybridScope: HybridScope | null;
  remoteIdentity: { participantId: string; sessionId: string; publicationId: string } | null;
}
export interface ReceivePathSelectionPort {
  getSelection(): ReceiveSourceSelection;
  getObservation(): ReceiveTrackObservation | null;
  subscribe(listener: () => void): () => void;
}
export interface ReceivePathRow {
  participantId: string;
  remoteSessionId: string | null;
  publicationId: string;
  sourceId: string;
  trackId: string | null;
  selectionRevision: number;
  /** Positive local observer lifetime fence; raw Hybrid revision above may initially be -1. */
  selectionEpoch: number;
  receiveGeneration: number;
  routeGeneration: number | null;
  selected: "sfu" | "p2p" | "none" | null;
  selectionSource: "sdk-sfu-source" | "sdk-hybrid-selected-edge";
  status: string;
  availability: "fresh" | "unavailable";
  reason: string | null;
  observedAtMs: number | null;
  decode: ReceiveDecodeWindow | null;
  metrics: ReceiveTransportMetrics | null;
  /** Safe selected-pair summary; full endpoints remain in the SDK observation. */
  transportPath?: ReceiveTransportPathSummary | null;
  metricLeg: "sfu-to-local" | "peer-to-local" | null;
  hybridScope: HybridScope | null;
  physicalPath: "unverified";
  /** There is no authenticated remote decoded/selected receipt in the current protocol. */
  sentToRemote: null;
}
export interface ReceivePathSnapshot {
  connectionEpoch: number | null;
  scope: ReceivePathScope | null;
  sampledAtMs: number | null;
  readAtMs: number;
  clockDomain: "performance.now" | "injected-local";
  rows: readonly ReceivePathRow[];
}
export interface ReceivePathObserverOptions {
  getSfu(): Pick<SFUInterface, "getPeerConnection" | "getConnectionEpoch" | "isConnected" | "currentServerConnected" | "currentChannelConnected" | "streamSources">;
  getScope(): ReceivePathScope | null;
  getBindings(): readonly ReceivePathBinding[];
  clock?: { now(): number; schedule(callback: () => void, delayMs: number): unknown; cancel(handle: unknown): void };
}
