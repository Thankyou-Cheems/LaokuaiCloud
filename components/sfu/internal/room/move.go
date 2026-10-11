package room

import (
	"crypto/subtle"
	"errors"
	"github.com/pion/webrtc/v4"
	"io"
	"sfu-v2/pkg/types"
	"time"
)

type preparedMove struct {
	request     types.MoveRequest
	status      string
	sourceID    string
	sourcePC    *webrtc.PeerConnection
	pendingID   string
	pendingPC   *webrtc.PeerConnection
	pendingConn JSONWriter
	removed     bool
}

func moveKey(r types.MoveRequest) string { return r.ServerID + "|" + r.RequestID }
func (m *Manager) BindPeerSession(peerID, socketID string) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	if m.peerSessions == nil {
		m.peerSessions = map[string]string{}
	}
	m.peerSessions[peerID] = socketID
}
func (p *preparedMove) result() types.MoveResult {
	return types.MoveResult{PeerID: p.pendingID, Removed: p.removed, RequestID: p.request.RequestID, Status: p.status, SourceRoomID: p.request.SourceRoomID, DestinationRoomID: p.request.DestinationRoomID, UserID: p.request.UserID}
}
func (m *Manager) moveAuthorized(r types.MoveRequest) bool {
	a, aok := m.rooms[r.SourceRoomID]
	b, bok := m.rooms[r.DestinationRoomID]
	return m.moveCredentialsValid(r) && aok && bok && a.ServerID == r.ServerID && b.ServerID == r.ServerID
}
func (m *Manager) moveCredentialsValid(r types.MoveRequest) bool {
	secret, ok := m.registeredServers[r.ServerID]
	return ok && secret != "" && subtle.ConstantTimeCompare([]byte(secret), []byte(r.ServerPassword)) == 1
}
func sameMove(a, b types.MoveRequest) bool {
	return a.RequestID == b.RequestID && a.ServerID == b.ServerID && a.UserID == b.UserID && a.SourceRoomID == b.SourceRoomID && a.DestinationRoomID == b.DestinationRoomID && a.SocketID == b.SocketID && a.Nonce == b.Nonce
}

// PrepareMove reserves a replacement connection, never removing the source.
func (m *Manager) PrepareMove(r types.MoveRequest) (types.MoveResult, error) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	if !m.moveAuthorized(r) || r.RequestID == "" || len(r.RequestID) > 128 || r.SourceRoomID == r.DestinationRoomID || r.SocketID == "" || len(r.Nonce) < 16 || r.ExpiresAtMs <= time.Now().UnixMilli() || r.ExpiresAtMs > time.Now().Add(time.Minute).UnixMilli() {
		return types.MoveResult{}, errors.New("invalid_move")
	}
	if m.moves == nil {
		m.moves = map[string]*preparedMove{}
	}
	if p := m.moves[moveKey(r)]; p != nil {
		if !sameMove(p.request, r) {
			return types.MoveResult{}, errors.New("request_conflict")
		}
		return p.result(), nil
	}
	for key, p := range m.moves {
		if p.request.ExpiresAtMs+300000 < time.Now().UnixMilli() {
			delete(m.moves, key)
			continue
		}
		if p.request.ServerID == r.ServerID && p.request.UserID == r.UserID && (p.status == "prepared" || p.status == "ready") {
			return types.MoveResult{}, errors.New("move_busy")
		}
	}
	if len(m.moves) >= 1024 {
		return types.MoveResult{}, errors.New("move_capacity")
	}
	source, dest := m.rooms[r.SourceRoomID], m.rooms[r.DestinationRoomID]
	source.mutex.RLock()
	defer source.mutex.RUnlock()
	dest.mutex.RLock()
	defer dest.mutex.RUnlock()
	p := &preparedMove{request: r, status: "prepared"}
	for id, user := range source.UserIDs {
		if user == r.UserID {
			if p.sourceID != "" {
				return types.MoveResult{}, errors.New("ambiguous_source")
			}
			p.sourceID = id
			p.sourcePC = source.PeerConnections[id]
		}
	}
	if p.sourceID == "" || p.sourcePC == nil || m.peerSessions[p.sourceID] != r.SocketID {
		return types.MoveResult{}, errors.New("source_generation_changed")
	}
	for _, user := range dest.UserIDs {
		if user == r.UserID {
			return types.MoveResult{}, errors.New("destination_duplicate")
		}
	}
	m.moves[moveKey(r)] = p
	time.AfterFunc(time.Until(time.UnixMilli(r.ExpiresAtMs)), func() { m.AbortMove(r) })
	return p.result(), nil
}

// AttachMove accepts only a signed transfer nonce and socket binding. Pending peers
// are deliberately absent from every live room and seat/sync query.
func (m *Manager) AttachMove(r types.MoveRequest, id string, pc *webrtc.PeerConnection, conn JSONWriter) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	p := m.moves[moveKey(r)]
	if p == nil || !sameMove(p.request, r) || p.status != "prepared" || p.pendingID != "" || pc == nil || conn == nil || time.Now().UnixMilli() >= p.request.ExpiresAtMs {
		return errors.New("invalid_staged_join")
	}
	p.pendingID = id
	p.pendingPC = pc
	p.pendingConn = conn
	return nil
}

// PreparedForJoin only returns transfer metadata after the normal join token was
// verified; the caller additionally checks the nonce and app_socket capabilities.
func (m *Manager) PreparedForJoin(serverID, requestID string) (types.MoveRequest, bool) {
	m.mutex.RLock()
	defer m.mutex.RUnlock()
	p := m.moves[serverID+"|"+requestID]
	if p == nil || p.status != "prepared" {
		return types.MoveRequest{}, false
	}
	return p.request, true
}
func (m *Manager) ReadyMove(peerID string) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	for _, p := range m.moves {
		if p.pendingID == peerID && p.status == "prepared" {
			p.status = "ready"
		}
	}
}
func (m *Manager) QueryMove(r types.MoveRequest) (types.MoveResult, error) {
	m.mutex.RLock()
	defer m.mutex.RUnlock()
	p := m.moves[moveKey(r)]
	if !m.moveCredentialsValid(r) || p == nil || !sameMove(p.request, r) {
		return types.MoveResult{}, errors.New("unknown_move")
	}
	return p.result(), nil
}
func closeMovePeer(pc *webrtc.PeerConnection, conn JSONWriter) {
	if c, ok := conn.(io.Closer); ok {
		_ = c.Close()
	}
	if pc != nil {
		_ = pc.Close()
	}
}

// CommitMove swaps both live membership maps under the same lock used by sync.
// quiesce is infallible: it permanently fences source publishing/receiving before
// the swap. No fallible operation follows it inside the commit critical section.
func (m *Manager) CommitMove(r types.MoveRequest, quiesce func(*webrtc.PeerConnection, string, string)) (types.MoveResult, error) {
	m.mutex.Lock()
	p := m.moves[moveKey(r)]
	if !m.moveAuthorized(r) || p == nil || !sameMove(p.request, r) {
		m.mutex.Unlock()
		return types.MoveResult{}, errors.New("unknown_move")
	}
	if p.status == "committed" {
		out := p.result()
		m.mutex.Unlock()
		return out, nil
	}
	if p.status != "ready" || time.Now().UnixMilli() >= p.request.ExpiresAtMs {
		out := p.result()
		m.mutex.Unlock()
		return out, errors.New("move_not_ready")
	}
	source, dest := m.rooms[r.SourceRoomID], m.rooms[r.DestinationRoomID]
	source.mutex.Lock()
	dest.mutex.Lock()
	valid := source.UserIDs[p.sourceID] == r.UserID && source.PeerConnections[p.sourceID] == p.sourcePC && m.peerSessions[p.sourceID] == r.SocketID
	if p.sourcePC.ConnectionState() == webrtc.PeerConnectionStateClosed || p.sourcePC.ConnectionState() == webrtc.PeerConnectionStateFailed {
		valid = false
	}
	for _, user := range dest.UserIDs {
		if user == r.UserID {
			valid = false
		}
	}
	if p.pendingPC.ConnectionState() == webrtc.PeerConnectionStateClosed || p.pendingPC.ConnectionState() == webrtc.PeerConnectionStateFailed {
		valid = false
	}
	if !valid {
		out := p.result()
		dest.mutex.Unlock()
		source.mutex.Unlock()
		m.mutex.Unlock()
		return out, errors.New("source_or_pending_changed")
	}
	quiesce(p.sourcePC, p.sourceID, r.SourceRoomID)
	oldConn := source.Connections[p.sourceID]
	oldPC := p.sourcePC
	delete(source.UserIDs, p.sourceID)
	delete(m.peerSessions, p.sourceID)
	delete(source.PeerConnections, p.sourceID)
	delete(source.Connections, p.sourceID)
	delete(source.DeafenedUsers, r.UserID)
	dest.UserIDs[p.pendingID] = r.UserID
	dest.PeerConnections[p.pendingID] = p.pendingPC
	dest.Connections[p.pendingID] = p.pendingConn
	dest.DeafenedUsers[r.UserID] = r.IsDeafened
	m.peerSessions[p.pendingID] = r.SocketID
	p.status = "committed"
	p.sourcePC = nil
	p.pendingPC = nil
	p.pendingConn = nil
	p.request.Capabilities = r.Capabilities
	p.request.IsMuted = r.IsMuted
	p.request.IsDeafened = r.IsDeafened
	out := p.result()
	dest.mutex.Unlock()
	source.mutex.Unlock()
	m.mutex.Unlock()
	closeMovePeer(oldPC, oldConn)
	return out, nil
}
func (m *Manager) AbortMove(r types.MoveRequest) (types.MoveResult, error) {
	m.mutex.Lock()
	p := m.moves[moveKey(r)]
	if !m.moveCredentialsValid(r) || p == nil || !sameMove(p.request, r) {
		m.mutex.Unlock()
		return types.MoveResult{}, errors.New("unknown_move")
	}
	if p.status == "committed" || p.status == "aborted" {
		out := p.result()
		m.mutex.Unlock()
		return out, nil
	}
	p.status = "aborted"
	out := p.result()
	pc, conn := p.pendingPC, p.pendingConn
	p.sourcePC = nil
	p.pendingPC = nil
	p.pendingConn = nil
	m.mutex.Unlock()
	closeMovePeer(pc, conn)
	return out, nil
}
func (m *Manager) PendingDisconnected(peerID string) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	for _, p := range m.moves {
		if p.pendingID == peerID && (p.status == "ready" || p.status == "prepared") {
			p.status = "aborted"
			p.sourcePC = nil
			p.pendingPC = nil
			p.pendingConn = nil
		}
	}
}

// RemoveMove invalidates a transfer without changing a historical committed
// outcome. A replacement generation is never selected by room/user lookup.
func (m *Manager) RemoveMove(r types.MoveRequest, fence func(*webrtc.PeerConnection, string, string)) (types.MoveResult, error) {
	m.mutex.Lock()
	p := m.moves[moveKey(r)]
	if !m.moveCredentialsValid(r) || p == nil || !sameMove(p.request, r) {
		m.mutex.Unlock()
		return types.MoveResult{}, errors.New("unknown_move")
	}
	var pc *webrtc.PeerConnection
	var conn JSONWriter
	if p.status == "committed" {
		if dest := m.rooms[p.request.DestinationRoomID]; dest != nil {
			dest.mutex.Lock()
			if dest.UserIDs[p.pendingID] == p.request.UserID && m.peerSessions[p.pendingID] == p.request.SocketID {
				pc, conn = dest.PeerConnections[p.pendingID], dest.Connections[p.pendingID]
				fence(pc, p.pendingID, p.request.DestinationRoomID)
				delete(dest.UserIDs, p.pendingID)
				delete(dest.PeerConnections, p.pendingID)
				delete(dest.Connections, p.pendingID)
				delete(dest.DeafenedUsers, p.request.UserID)
				delete(m.peerSessions, p.pendingID)
			}
			dest.mutex.Unlock()
		}
		p.removed = true
	} else if p.status != "aborted" {
		p.status = "aborted"
		pc, conn = p.pendingPC, p.pendingConn
		p.pendingPC, p.sourcePC, p.pendingConn = nil, nil, nil
	}
	out := p.result()
	m.mutex.Unlock()
	closeMovePeer(pc, conn)
	return out, nil
}

// RefreshMove acknowledges current grants and moderation on this exact committed
// destination connection, repairing live controls sent to the old room during ACK.
func (m *Manager) RefreshMove(r types.MoveRequest, apply func(string) bool) (types.MoveResult, error) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	p := m.moves[moveKey(r)]
	if !m.moveCredentialsValid(r) || p == nil || !sameMove(p.request, r) || p.status != "committed" || p.removed {
		return types.MoveResult{}, errors.New("not_active_committed_move")
	}
	dest := m.rooms[p.request.DestinationRoomID]
	if dest == nil {
		return types.MoveResult{}, errors.New("destination_gone")
	}
	dest.mutex.Lock()
	defer dest.mutex.Unlock()
	if dest.UserIDs[p.pendingID] != p.request.UserID || m.peerSessions[p.pendingID] != p.request.SocketID {
		return types.MoveResult{}, errors.New("destination_generation_changed")
	}
	pc := dest.PeerConnections[p.pendingID]
	if pc == nil || pc.ConnectionState() == webrtc.PeerConnectionStateClosed || pc.ConnectionState() == webrtc.PeerConnectionStateFailed || !apply(p.pendingID) {
		return types.MoveResult{}, errors.New("destination_transport_changed")
	}
	dest.DeafenedUsers[p.request.UserID] = r.IsDeafened
	p.request.Capabilities = append([]string(nil), r.Capabilities...)
	p.request.IsMuted, p.request.IsDeafened = r.IsMuted, r.IsDeafened
	return p.result(), nil
}
