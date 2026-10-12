import type { LanCommunitySnapshot } from "./memberLanStatus";

/** Renderer contract. Network credentials and physical endpoints stay in main. */
export type EasyTierRoute = "physical-direct" | "relay" | "unknown";
export type EasyTierPhase = "disabled" | "activation-required" | "connecting" | "connected" | "disconnecting" | "error";
export type EasyTierReason = "activation-required" | "needs-permission" | "configuration-required" | "runtime-required" | "unsupported-target" | "multi-community-unavailable" | "connect-failed" | "operation-timeout" | "cleanup-failed" | "status-unavailable" | "runtime-exited" | null;

/** Reported facts of our local instance; never a member binding or voice path proof. */
export interface EasyTierLocalNetworkDetails {
  source: "owned-cli-route-list";
  serverId: string;
  instanceId: string;
  generation: number;
  acquisitionStartedAtUnixMs: number;
  acquiredAtUnixMs: number;
  maxAgeMs: number;
  running: true;
  localPeerId: number;
  virtualIp: string | null;
  latencyFirst: boolean | null;
  routes: Array<{ peerId: number; virtualIp: string | null; nextHopPeerId: number | null; latencyFirstNextHopPeerId: number | null; cost: number | null; latencyFirstCost: number | null }>;
  peers: Array<{ peerId: number; defaultConnectionId: string | null; connections: Array<{ connectionId: string; closed: boolean | null; tunnelType: string | null; reportedDirect: boolean }> }>;
  memberBinding: "unavailable";
  rttMs: null;
  missingEvidence: Array<"authenticated-user-peer-binding" | "latency-first-setting" | "selected-forwarding-decision" | "rtt-measurement-time" | "trusted-next-hop-role" | "full-physical-path">;
}

export interface EasyTierCommunityState {
  serverId: string;
  generation: number;
  phase: EasyTierPhase;
  reason: EasyTierReason;
  virtualIp: string | null;
  /** UI worker's v1 contract; LAN evidence never proves a voice media path. */
  lanSnapshot: LanCommunitySnapshot | null;
  /** Optional for older consumers/fixtures; current main always supplies value or null. */
  localDetails?: EasyTierLocalNetworkDetails | null;
}

export interface EasyTierCommunityLease {
  serverId: string;
  /** Stable community consumer reference. Never a voice room identifier. */
  leaseId: string;
}

export interface EasyTierCommunityAPI {
  getRuntimeMode?(): Promise<"normal" | "preview-disabled">;
  connect(lease: EasyTierCommunityLease): Promise<EasyTierCommunityState>;
  disconnect(lease: EasyTierCommunityLease): Promise<EasyTierCommunityState>;
  disconnectCommunity(serverId: string): Promise<EasyTierCommunityState>;
  setEnabled(enabled: boolean): Promise<EasyTierCommunityState[]>;
  getState(serverId: string): Promise<EasyTierCommunityState>;
  onState(listener: (state: EasyTierCommunityState) => void): () => void;
  /** Download/verify fixed official assets only; never start core or install drivers. */
  prepareRuntime(): Promise<{ ready: boolean }>;
  /** Complete renderer membership set, also reconciles leases retained through reload. */
  syncMemberships(serverIds: readonly string[]): Promise<EasyTierCommunityState[]>;
  /** Opaque existing bearer handoff. Main verifies identity at a fixed trusted backend. */
  setAuthenticatedSession?(value: {serverId: string; host: string; accessToken: string | null}): Promise<EasyTierCommunityState>;
}

declare global {
  interface Window { easyTierCommunity?: EasyTierCommunityAPI }
}
