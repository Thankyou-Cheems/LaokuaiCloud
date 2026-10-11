package websocket

import (
	"sync"

	"sfu-v2/internal/auth"
	"sfu-v2/internal/recovery"
	"sfu-v2/pkg/types"
)

// livePeers finds a connected peer's claims by room and user, for user_capabilities. The
// zero value is ready to use.
type livePeers struct {
	mu    sync.Mutex
	peers map[string]livePeer // clientID ->
}

type livePeer struct {
	roomID, userID string
	claims         *auth.Live
	pending        bool
	retired        bool
	moveManaged    bool
	granted        auth.Claims
	muted          bool
}

func (p *livePeers) add(clientID, roomID, userID string, claims *auth.Live) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.peers == nil {
		p.peers = make(map[string]livePeer)
	}
	initial, _ := claims.Snapshot()
	p.peers[clientID] = livePeer{roomID: roomID, userID: userID, claims: claims, granted: initial}
}

func (p *livePeers) remove(clientID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.peers, clientID)
}

// set gives every peer of this user in this room new claims, and says how many it found.
func (p *livePeers) set(roomID, userID string, claims auth.Claims) int {
	p.mu.Lock()
	var count int
	for id, peer := range p.peers {
		if peer.roomID == roomID && peer.userID == userID && !peer.pending && !peer.retired {
			peer.granted = claims
			p.peers[id] = peer
			peer.claims.Set(mutedClaims(claims, peer.muted))
			count++
		}
	}
	p.mu.Unlock()
	return count
}

func mutedClaims(claims auth.Claims, muted bool) auth.Claims {
	if !muted {
		return claims
	}
	caps := make([]string, 0, len(claims.Capabilities))
	for _, cap := range claims.Capabilities {
		if cap != auth.CapSpeak {
			caps = append(caps, cap)
		}
	}
	return auth.Claims{Capabilities: caps}
}
func (p *livePeers) audio(roomID, userID string, muted bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for id, peer := range p.peers {
		if peer.roomID == roomID && peer.userID == userID && !peer.pending && !peer.retired && peer.moveManaged {
			peer.muted = muted
			p.peers[id] = peer
			peer.claims.Set(mutedClaims(peer.granted, muted))
		}
	}
}

// handleUserCapabilities replaces a connected member's capabilities, so a permission changed
// mid-call reaches the gate in OnTrack. Only the server that owns the room may send it.
func (h *Handler) handleUserCapabilities(data string) error {
	var req types.UserCapabilitiesData
	if err := recovery.SafeJSONUnmarshal([]byte(data), &req); err != nil {
		h.debugLog("❌ Error unmarshalling user_capabilities data: %v", err)
		return err
	}

	if !h.roomManager.ServerOwnsRoom(req.ServerID, req.ServerPassword, req.RoomID) {
		h.debugLog("❌ user_capabilities: server '%s' failed credentials or does not own room '%s'", req.ServerID, req.RoomID)
		return nil
	}

	n := h.live.set(req.RoomID, req.UserID, auth.Claims{Capabilities: req.Capabilities})
	h.debugLog("🎛️  user_capabilities: room=%s user=%s caps=%v peers=%d", req.RoomID, req.UserID, req.Capabilities, n)
	return nil
}
