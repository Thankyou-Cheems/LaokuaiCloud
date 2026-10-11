export interface SfuMoveCommand {
  request_id: string;
  user_id: string;
  source_room_id: string;
  destination_room_id: string;
  socket_id: string;
  nonce: string;
  expires_at_ms: number;
  capabilities: string[];
  is_muted: boolean;
  is_deafened: boolean;
}
export interface SfuMoveResult {
  command_id?: string;
  request_id: string;
  status: "supported" | "prepared" | "ready" | "committed" | "aborted" | "failed";
  error?: string;

  removed?: boolean;
  user_id?: string;
  source_room_id?: string;
  destination_room_id?: string;
}
export type SfuMovePhase = "probe" | "prepare" | "status" | "commit" | "abort" | "remove" | "refresh";
