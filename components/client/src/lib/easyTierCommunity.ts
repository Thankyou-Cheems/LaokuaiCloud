import type { LanCommunitySnapshot } from "./memberLanStatus";

/** Renderer contract. Network credentials and physical endpoints stay in main. */
export type EasyTierRoute = "physical-direct" | "relay" | "unknown";
export type EasyTierPhase = "disabled" | "activation-required" | "connecting" | "connected" | "disconnecting" | "error";
export type EasyTierReason = "activation-required" | "unsupported-target" | "connect-failed" | "operation-timeout" | "cleanup-failed" | "status-unavailable" | "runtime-exited" | null;

export interface EasyTierCommunityState {
  serverId: string;
  generation: number;
  phase: EasyTierPhase;
  reason: EasyTierReason;
  virtualIp: string | null;
  /** UI worker's v1 contract; LAN evidence never proves a voice media path. */
  lanSnapshot: LanCommunitySnapshot | null;
}

export interface EasyTierCommunityLease {
  serverId: string;
  /** Stable community consumer reference. Never a voice room identifier. */
  leaseId: string;
}

export interface EasyTierCommunityAPI {
  connect(lease: EasyTierCommunityLease): Promise<EasyTierCommunityState>;
  disconnect(lease: EasyTierCommunityLease): Promise<EasyTierCommunityState>;
  disconnectCommunity(serverId: string): Promise<EasyTierCommunityState>;
  setEnabled(enabled: boolean): Promise<EasyTierCommunityState[]>;
  getState(serverId: string): Promise<EasyTierCommunityState>;
  onState(listener: (state: EasyTierCommunityState) => void): () => void;
}

declare global {
  interface Window { easyTierCommunity?: EasyTierCommunityAPI }
}
