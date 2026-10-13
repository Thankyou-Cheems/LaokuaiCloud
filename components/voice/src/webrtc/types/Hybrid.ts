export interface HybridScope {
  serverInstanceId: string;
  roomId: string;
  roomGeneration: string;
  localParticipantId: string;
  localSessionId: string;
  canPublish: boolean;
  canReceive: boolean;
}
export interface HybridParticipant {
  participantId: string;
  sessionId: string;
  publicationId: string;
  canSendAudio: boolean;
  canReceiveAudio: boolean;
}
/** Borrow only the SDK's final, protected publication; never acquire or stop capture. */
export interface HybridPublication {
  stream: MediaStream;
  track: MediaStreamTrack;
  /** Physical publication generation; mute/PTT/Squad ACK revisions are not media identity. */
  generation: number;
  publicationAcknowledged: boolean;
  publicationRevision: number;
}
export interface HybridPairLease {
  connectionId: string;
  scope: HybridScope;
  remoteSessionId: string;
  initiator: boolean;
}
export type HybridSignalBody = { kind: "offer" | "answer"; sdp: string } |
  { kind: "candidate"; candidate: RTCIceCandidateInit | null };
export interface HybridSignal {
  serverInstanceId: string;
  roomId: string;
  roomGeneration: string;
  sourceSessionId: string;
  destinationSessionId: string;
  connectionId: string;
  sequence: number;
  body: HybridSignalBody;
}
export interface HybridForwardingRequest {
  scope: HybridScope;
  /** Server-minted pair ID for pause; null is permitted only for authorized restore cleanup. */
  pairConnectionId: string | null;
  sourceParticipantId: string;
  sourceSessionId: string;
  sourcePublicationId: string;
  destinationSessionId: string;
  routeGeneration: number;
  operationId: string;
  enabled: boolean;
  /** Disabled forwarding is a server-owned lease; expiry restores forwarding. */
  pauseLeaseMs: number;
}
export interface HybridForwardingAck extends HybridForwardingRequest {
  applied: true;
  leaseRemainingMs: number;
}
/** Adapter must authenticate and authorize before delivering any of these values. */
export interface HybridAuthority {
  readonly environment: "simulation" | "network";
  readonly capabilities: { protocolVersion: 1; authenticatedRoomSignals: true; pairForwardingLeases: true } | null;
  isCurrent(scope: HybridScope): boolean;
  leasePair(scope: HybridScope, participant: HybridParticipant): Promise<HybridPairLease>;
  relay(signal: HybridSignal): Promise<void>;
  setForwarding(request: HybridForwardingRequest): Promise<HybridForwardingAck>;
  releasePair(lease: HybridPairLease): void | Promise<void>;
  subscribeSignals(listener: (signal: HybridSignal) => void): () => void;
  subscribeInvalidation(listener: () => void): () => void;
  /** A revoked pair closes its old peer before attempting fresh SFU fallback. */
  subscribePairInvalidation?(listener: (connectionId: string) => void): () => void;
}
export interface HybridMediaCandidate {
  stream: MediaStream;
  track: MediaStreamTrack;
  /** Local decoded-audio evidence, not a remote claim or ICE-connected event. */
  decodedFrames: number;
  mediaSequence: number;
  observedAtMs: number;
  /** Passive read of exact-track evidence; never starts another peer or capture. */
  getReceiveObservation?(): import("./ReceivePath").ReceiveTrackObservation | null;
}
export interface HybridReceivePort {
  isCurrent(): boolean;
  getSelectionRevision?(): number;
  /** Snapshot of the one edge actually selected by its owner, not decoded/ICE guesses. */
  getSelection?(): { kind: "sfu" | "p2p" | "none"; trackId: string | null; revision: number };
  /** Must disconnect the old input before connecting one new input, preserving the DSP/manual nodes. */
  select(kind: "sfu" | "p2p" | "none", candidate: HybridMediaCandidate | undefined, selectionRevision: number): void;
  waitForSfuMedia(afterSequence: number): Promise<HybridMediaCandidate>;
  getSfuMediaSequence(): number;
}
export interface HybridPeerMetrics {
  source: "simulation" | "rtc-stats";
  observedAtMs: number;
  packetsSent: number;
  payloadBytesSent: number;
  headerBytesSent: number | null;
  /** Null on browsers/roles that do not provide encoder CPU timing. */
  totalEncodeTimeSeconds: number | null;
}
export interface HybridPeerSession {
  start(): Promise<void>;
  acceptSignal(body: HybridSignalBody): Promise<void>;
  waitForMedia(): Promise<HybridMediaCandidate>;
  isReceiving(candidate: HybridMediaCandidate): boolean;
  readMetrics(): Promise<HybridPeerMetrics>;
  /** Remove senders/handlers and close the PC; do not stop the borrowed publication. */
  dispose(): void;
}
export interface HybridPeerFactoryOptions {
  lease: HybridPairLease;
  publication: HybridPublication;
  participant: HybridParticipant;
  onSignal(body: HybridSignalBody): void;
  onFailure(reason: string): void;
}
export interface HybridClock {
  now(): number;
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}
export interface HybridOptions {
  enabled?: boolean;
  /** Network adapters are unsupported until this separate opt-in is provided. */
  allowNetwork?: boolean;
  /** A candidate path must remain resolver-approved for this long before SFU is paused. */
  pathStableMs?: number;
  /** How often an active peer route rechecks the same candidate/underlay evidence. */
  pathMonitorMs?: number;
  maxPeerConnections?: number;
  maxConcurrentProbes?: number;
  minProbeIntervalMs?: number;
  probeTimeoutMs?: number;
  switchTimeoutMs?: number;
  pauseLeaseMs?: number;
  leaseRenewMs?: number;
}
export interface HybridRouteState {
  participantId: string;
  sessionId: string;
  publicationId: string;
  routeGeneration: number;
  selectionRevision: number;
  status: "sfu" | "queued" | "probing" | "switching" | "p2p" | "recovering" | "failed";
  selected: "sfu" | "p2p" | "none";
  selectedTrackId: string | null;
  reason: string | null;
  /** True only after an exact, nonexpired server pause ACK. */
  forwardingPaused: boolean;
}
export interface HybridState {
  kind: "hybrid-prototype";
  status: "disabled" | "unsupported" | "active" | "disposed";
  reason: string | null;
  environment: "simulation" | "network" | "unavailable";
  peerConnections: number;
  concurrentProbes: number;
  queuedProbes: number;
  probeAdmissionAllowed: boolean;
  rejectedSignals: number;
  routes: readonly HybridRouteState[];
}
export interface HybridMetrics {
  environment: HybridState["environment"];
  peerConnections: number;
  reportingPeers: number;
  complete: boolean;
  knownPayloadUplinkBps: number | null;
  knownHeaderUplinkBps: number | null;
  knownPacketsPerSecond: number | null;
  knownEncoderCpuSecondsPerSecond: number | null;
  measuredPeers: readonly HybridPeerMetrics[];
}
export interface HybridDependencies {
  onDiagnostic?: (event: import("../hybrid/hybridDiagnostic").BrowserHybridDiagnostic) => void;
  authority: HybridAuthority | null;
  getPublication(): HybridPublication | null;
  getReceivePort(participant: HybridParticipant): HybridReceivePort | null;
  createPeer(options: HybridPeerFactoryOptions): HybridPeerSession;
  clock?: HybridClock;
  /** Host-owned, fenced ACK + fresh-media recovery after the controller loses authority. */
  recoverRetiredSfu?(request: HybridForwardingRequest, port: HybridReceivePort, selectionRevision: number): void;
  /** Keep a fenced restore obligation when an owner retires its still-live SFU source. */
  rememberRetiredSfu?(request: HybridForwardingRequest, port: HybridReceivePort): void;
}
