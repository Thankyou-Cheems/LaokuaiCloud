package track

import (
	"errors"
	"github.com/pion/webrtc/v4"
	"sfu-v2/internal/svc"
	"time"
)

// The track-manager lock prevents a source replacement/retirement between the
// physical publication lookup and the synchronous forwarding ACK.
func (m *Manager) ApplyHybridLease(room, publication, receiver, scope, pair string, sourcePC, receiverPC *webrtc.PeerConnection, revision uint64, enabled bool, duration time.Duration) (svc.AudioLeaseSnapshot, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.fenced[sourcePC] || m.fenced[receiverPC] || sourcePC == receiverPC ||
		sourcePC.ConnectionState() != webrtc.PeerConnectionStateConnected || receiverPC.ConnectionState() != webrtc.PeerConnectionStateConnected {
		return svc.AudioLeaseSnapshot{}, errors.New("peer_generation_changed")
	}
	var found *svc.LayerForwarder
	for _, lf := range m.roomForwarders[room] {
		if lf.GetSenderPC() == sourcePC && lf.StreamID() == publication && lf.Kind() == webrtc.RTPCodecTypeAudio {
			if found != nil {
				return svc.AudioLeaseSnapshot{}, errors.New("ambiguous_publication")
			}
			found = lf
		}
	}
	if found == nil {
		return svc.AudioLeaseSnapshot{}, errors.New("publication_unavailable")
	}
	return found.ApplyAudioLease(receiver, scope, pair, revision, enabled, duration)
}
