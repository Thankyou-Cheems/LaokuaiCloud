export interface SfuHybridCommand {
  phase: "probe" | "forwarding";
  room_id?: string;
  authority_generation?: string;
  pair_connection_id?: string;
  source_user_id?: string;
  source_session_id?: string;
  source_publication_id?: string;
  receiver_user_id?: string;
  receiver_session_id?: string;
  revision?: number;
  enabled?: boolean;
  pause_ms?: number;
}
export interface SfuHybridResult {
  command_id: string;
  status: "supported" | "applied" | "failed";
  error?: string;
  snapshot?: { remaining_ms: number; forwarded_packets: number; held_packets: number };
}

/** Only protocol-defined failure codes may cross the authenticated client boundary. */
export const SFU_HYBRID_FAILURE_CODES = ["hybrid_unsupported", "unauthorized_server", "invalid_hybrid_command", "invalid_hybrid_room",
  "source_permission_revoked", "peer_generation_changed", "ambiguous_publication", "publication_unavailable", "invalid_audio_lease",
  "source_retired", "receiver_unavailable", "invalid_pause_duration", "stale_audio_lease", "authority_generation_conflict", "pair_generation_conflict"] as const;
export function hybridSfuFailure(error: unknown): string {
  return SFU_HYBRID_FAILURE_CODES.includes(error as typeof SFU_HYBRID_FAILURE_CODES[number]) ?
    error === "hybrid_unsupported" ? error : `hybrid_sfu_${error}` : "hybrid_sfu_ack_failed";
}
