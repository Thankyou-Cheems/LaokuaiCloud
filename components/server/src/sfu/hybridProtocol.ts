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
