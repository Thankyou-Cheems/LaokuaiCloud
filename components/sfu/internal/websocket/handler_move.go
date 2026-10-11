package websocket

import (
	"encoding/json"
	"fmt"
	"github.com/pion/webrtc/v4"
	"sfu-v2/internal/auth"
	peerManager "sfu-v2/internal/webrtc"
	"sfu-v2/pkg/types"
	"strings"
)

func socketBinding(claims auth.Claims) string {
	for _, cap := range claims.Capabilities {
		if strings.HasPrefix(cap, "app_socket:") {
			return strings.TrimPrefix(cap, "app_socket:")
		}
	}
	return ""
}
func (p *livePeers) stage(id string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	v := p.peers[id]
	v.pending = true
	p.peers[id] = v
}
func (p *livePeers) retire(id string) {
	p.mu.Lock()
	v, ok := p.peers[id]
	if ok {
		v.pending = true
		v.retired = true
		p.peers[id] = v
	}
	p.mu.Unlock()
	if ok {
		v.claims.Set(auth.Claims{Capabilities: []string{auth.CapVideoChecked}})
	}
}
func (p *livePeers) activate(peerID string, caps []string, muted bool) {
	p.mu.Lock()
	if v, ok := p.peers[peerID]; ok && v.pending && !v.retired {
		v.pending = false
		v.moveManaged = true
		v.muted = muted
		v.granted = auth.Claims{Capabilities: caps}
		p.peers[peerID] = v
		v.claims.Set(mutedClaims(v.granted, muted))
	}
	p.mu.Unlock()
}
func (p *livePeers) refresh(peerID string, caps []string, muted bool) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if v, ok := p.peers[peerID]; ok && !v.pending && !v.retired && v.moveManaged {
		v.muted = muted
		v.granted = auth.Claims{Capabilities: caps}
		p.peers[peerID] = v
		v.claims.Set(mutedClaims(v.granted, muted))
		return true
	}
	return false
}
func (h *Handler) handleMoveCommand(conn *ThreadSafeWriter, event, data string) error {
	var req types.MoveRequest
	if err := json.Unmarshal([]byte(data), &req); err != nil {
		return err
	}
	var out types.MoveResult
	var err error
	if event == "move_probe" {
		if !h.roomManager.ValidateServerCredentials(req.ServerID, req.ServerPassword) {
			return fmt.Errorf("invalid_move_credentials")
		}
		out = types.MoveResult{RequestID: req.RequestID, Status: "supported"}
	} else {
		switch event {
		case types.EventMovePrepare:
			out, err = h.roomManager.PrepareMove(req)
		case types.EventMoveStatus:
			out, err = h.roomManager.QueryMove(req)
		case types.EventMoveAbort:
			out, err = h.roomManager.AbortMove(req)
		case types.EventMoveRemove:
			out, err = h.roomManager.RemoveMove(req, func(pc *webrtc.PeerConnection, id, roomID string) {
				h.live.retire(id)
				h.trackManager.FencePeer(roomID, id, pc)
			})
		case types.EventMoveRefresh:
			out, err = h.roomManager.RefreshMove(req, func(id string) bool { return h.live.refresh(id, req.Capabilities, req.IsMuted) })
			if err == nil {
				go h.coordinator.SignalPeerConnectionsInRoom(req.DestinationRoomID)
			}
		case types.EventMoveCommit:
			out, err = h.roomManager.CommitMove(req, func(pc *webrtc.PeerConnection, id, roomID string) {
				h.live.retire(id)
				h.trackManager.FencePeer(roomID, id, pc)
			})
			if err == nil && out.Status == "committed" && !out.Removed {
				caps := append([]string(nil), req.Capabilities...)
				h.live.activate(out.PeerID, caps, req.IsMuted)
				go h.coordinator.SignalPeerConnectionsInRoom(req.SourceRoomID)
				go h.coordinator.SignalPeerConnectionsInRoom(req.DestinationRoomID)
			}
		}
	}
	if err != nil {
		out = types.MoveResult{RequestID: req.RequestID, Status: "failed", Error: err.Error()}
	}
	out.CommandID = req.CommandID
	encoded, _ := json.Marshal(out)
	return conn.WriteJSON(&types.WebSocketMessage{Event: types.EventMoveResult, Data: string(encoded)})
}

// negotiateStagedPeer establishes transport with no room tracks or membership.
func (h *Handler) negotiateStagedPeer(pc *webrtc.PeerConnection, conn *ThreadSafeWriter) error {
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		return err
	}
	if err = pc.SetLocalDescription(offer); err != nil {
		return err
	}
	offer, err = peerManager.PreferMicrophoneOpus20(offer, h.config.AudioOnly && h.config.MicrophoneOpus20)
	if err != nil {
		return err
	}
	data, err := json.Marshal(offer)
	if err != nil {
		return err
	}
	return conn.WriteJSON(&types.WebSocketMessage{Event: types.EventOffer, Data: string(data)})
}
