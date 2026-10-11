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
export interface ReceiveTransportMetrics {
  /** Local opaque stats ID only; no address, candidate or SDP is returned. */
  selectedPairId: string | null;
  rttMs: number | null;
  rttWindow: { startAtMs: number; endAtMs: number } | null;
  rttSource: "rtc-selected-candidate-pair";
  lossFraction: number | null;
  lossWindow: { startAtMs: number; endAtMs: number; received: number; lost: number } | null;
  lossSource: "exact-audio-track-inbound-rtp";
}
export interface ReceiveTrackObservation {
  trackId: string;
  observedAtMs: number;
  reason: string | null;
  decode: ReceiveDecodeWindow | null;
  metrics: ReceiveTransportMetrics;
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
