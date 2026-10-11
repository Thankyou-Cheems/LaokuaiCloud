package types

// MoveRequest is authenticated on every phase, including read-only status.
type MoveRequest struct {
	CommandID         string   `json:"command_id"`
	RequestID         string   `json:"request_id"`
	ServerID          string   `json:"server_id"`
	ServerPassword    string   `json:"server_password"`
	UserID            string   `json:"user_id"`
	SourceRoomID      string   `json:"source_room_id"`
	DestinationRoomID string   `json:"destination_room_id"`
	SocketID          string   `json:"socket_id"`
	Nonce             string   `json:"nonce"`
	ExpiresAtMs       int64    `json:"expires_at_ms"`
	Capabilities      []string `json:"capabilities"`
	IsMuted           bool     `json:"is_muted"`
	IsDeafened        bool     `json:"is_deafened"`
}
type MoveResult struct {
	PeerID            string `json:"-"` // Exact staged connection; never exposed on the wire.
	CommandID         string `json:"command_id"`
	RequestID         string `json:"request_id"`
	Status            string `json:"status"`
	Error             string `json:"error,omitempty"`
	SourceRoomID      string `json:"source_room_id"`
	DestinationRoomID string `json:"destination_room_id"`
	UserID            string `json:"user_id"`
	Removed           bool   `json:"removed,omitempty"`
}

const EventMovePrepare = "move_prepare"
const EventMoveCommit = "move_commit"
const EventMoveAbort = "move_abort"
const EventMoveStatus = "move_status"
const EventMoveResult = "move_result"
const EventMoveRemove = "move_remove"
const EventMoveRefresh = "move_refresh"
