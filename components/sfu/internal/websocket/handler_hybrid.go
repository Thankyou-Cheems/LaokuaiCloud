package websocket

import (
	"encoding/json"
	"errors"
	"github.com/pion/webrtc/v4"
	"sfu-v2/internal/auth"
	"sfu-v2/internal/svc"
	"sfu-v2/pkg/types"
	"time"
)

type hybridCommand struct {
	CommandID       string `json:"command_id"`
	Phase           string `json:"phase"`
	ServerID        string `json:"server_id"`
	Password        string `json:"server_password"`
	Room            string `json:"room_id"`
	Authority       string `json:"authority_generation"`
	Pair            string `json:"pair_connection_id"`
	SourceUser      string `json:"source_user_id"`
	SourceSession   string `json:"source_session_id"`
	Publication     string `json:"source_publication_id"`
	ReceiverUser    string `json:"receiver_user_id"`
	ReceiverSession string `json:"receiver_session_id"`
	Revision        uint64 `json:"revision"`
	Enabled         bool   `json:"enabled"`
	PauseMs         int64  `json:"pause_ms"`
}
type hybridResult struct {
	CommandID string                  `json:"command_id"`
	Status    string                  `json:"status"`
	Error     string                  `json:"error,omitempty"`
	Snapshot  *svc.AudioLeaseSnapshot `json:"snapshot,omitempty"`
}

func hybridText(value string) bool { return value != "" && len(value) <= 256 }
func (p *livePeers) hybridSource(id, roomID string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	value, ok := p.peers[id]
	if !ok || value.roomID != roomID || value.pending || value.retired {
		return false
	}
	claims, _ := value.claims.Snapshot()
	for _, cap := range claims.Capabilities {
		if cap == auth.CapSpeak {
			return true
		}
	}
	return false
}
func (h *Handler) handleHybridCommand(conn *ThreadSafeWriter, data string) error {
	var req hybridCommand
	if err := json.Unmarshal([]byte(data), &req); err != nil {
		return err
	}
	result := hybridResult{CommandID: req.CommandID, Status: "failed"}
	send := func() error {
		body, _ := json.Marshal(result)
		return conn.WriteJSON(types.WebSocketMessage{Event: "hybrid_result", Data: string(body)})
	}
	if !hybridText(req.CommandID) {
		return nil
	}
	if !h.config.HybridEnabled || !h.config.RequireClientToken || !h.config.AudioOnly {
		result.Error = "hybrid_unsupported"
		return send()
	}
	if !h.roomManager.ValidateServerCredentials(req.ServerID, req.Password) || !h.roomManager.IsServerConnection(req.ServerID, conn) {
		result.Error = "unauthorized_server"
		return send()
	}
	if req.Phase == "probe" {
		result.Status = "supported"
		return send()
	}
	if req.Phase != "forwarding" || !h.roomManager.ServerOwnsRoom(req.ServerID, req.Password, req.Room) ||
		!hybridText(req.Authority) || !hybridText(req.SourceUser) || !hybridText(req.ReceiverUser) ||
		!hybridText(req.SourceSession) || !hybridText(req.ReceiverSession) || !hybridText(req.Publication) ||
		req.Revision == 0 || (!req.Enabled && (!hybridText(req.Pair) || req.PauseMs < 100 || req.PauseMs > 10000)) {
		result.Error = "invalid_hybrid_command"
		return send()
	}
	var snapshot svc.AudioLeaseSnapshot
	err := h.roomManager.WithHybridPeers(req.ServerID, req.Room, req.SourceUser, req.SourceSession, req.ReceiverUser, req.ReceiverSession,
		func(sourceID, receiverID string, sourcePC, receiverPC *webrtc.PeerConnection) error {
			if !req.Enabled && !h.live.hybridSource(sourceID, req.Room) {
				return errors.New("source_permission_revoked")
			}
			var err error
			snapshot, err = h.trackManager.ApplyHybridLease(req.Room, req.Publication, receiverID, req.Authority, req.Pair, sourcePC, receiverPC,
				req.Revision, req.Enabled, time.Duration(req.PauseMs)*time.Millisecond)
			return err
		})
	if err != nil {
		result.Error = err.Error()
	} else {
		result.Status = "applied"
		result.Snapshot = &snapshot
	}
	return send()
}
