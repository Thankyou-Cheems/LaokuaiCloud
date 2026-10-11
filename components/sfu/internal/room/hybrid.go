package room

import (
	"errors"
	"github.com/pion/webrtc/v4"
)

// HybridPeer resolves a current admitted peer by the token-signed app_socket.
// Pending moves, old socket generations and ambiguous users are never admitted.
func (m *Manager) HybridPeer(roomID, userID, sessionID string) (string, *webrtc.PeerConnection, bool) {
	m.mutex.RLock()
	defer m.mutex.RUnlock()
	r := m.rooms[roomID]
	if r == nil || sessionID == "" {
		return "", nil, false
	}
	r.mutex.RLock()
	defer r.mutex.RUnlock()
	var result string
	var pc *webrtc.PeerConnection
	for id, user := range r.UserIDs {
		if user != userID || m.peerSessions[id] != sessionID {
			continue
		}
		candidate := r.PeerConnections[id]
		if candidate == nil || candidate.ConnectionState() != webrtc.PeerConnectionStateConnected || result != "" {
			return "", nil, false
		}
		result, pc = id, candidate
	}
	return result, pc, result != ""
}
func (m *Manager) IsServerConnection(serverID string, conn JSONWriter) bool {
	m.mutex.RLock()
	defer m.mutex.RUnlock()
	return m.serverConns[serverID] == conn
}

// Membership stays locked through the physical-track lease mutation.
func (m *Manager) WithHybridPeers(serverID, roomID, sourceUser, sourceSession, receiverUser, receiverSession string,
	work func(string, string, *webrtc.PeerConnection, *webrtc.PeerConnection) error) error {
	m.mutex.RLock()
	defer m.mutex.RUnlock()
	r := m.rooms[roomID]
	if r == nil || r.ServerID != serverID || sourceSession == receiverSession {
		return errors.New("invalid_hybrid_room")
	}
	r.mutex.RLock()
	defer r.mutex.RUnlock()
	find := func(user, session string) (string, *webrtc.PeerConnection) {
		var id string
		var pc *webrtc.PeerConnection
		for key, value := range r.UserIDs {
			if value != user || m.peerSessions[key] != session {
				continue
			}
			candidate := r.PeerConnections[key]
			if id != "" || candidate == nil || candidate.ConnectionState() != webrtc.PeerConnectionStateConnected {
				return "", nil
			}
			id, pc = key, candidate
		}
		return id, pc
	}
	sourceID, sourcePC := find(sourceUser, sourceSession)
	receiverID, receiverPC := find(receiverUser, receiverSession)
	if sourceID == "" || receiverID == "" {
		return errors.New("peer_generation_changed")
	}
	return work(sourceID, receiverID, sourcePC, receiverPC)
}
