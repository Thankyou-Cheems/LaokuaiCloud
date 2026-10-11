package svc

import (
	"errors"
	"github.com/pion/webrtc/v4"
	"time"
)

// ApplyAudioLease takes the exclusive lock also covering every Track.Write.
// A successful ACK therefore follows all writes begun before the pause.
func (lf *LayerForwarder) ApplyAudioLease(receiver, scope, pair string, revision uint64, enabled bool, duration time.Duration) (AudioLeaseSnapshot, error) {
	lf.mu.Lock()
	defer lf.mu.Unlock()
	if lf.remoteTrack == nil || lf.remoteTrack.Kind() != webrtc.RTPCodecTypeAudio || scope == "" || revision == 0 {
		return AudioLeaseSnapshot{}, errors.New("invalid_audio_lease")
	}
	select {
	case <-lf.stopped:
		return AudioLeaseSnapshot{}, errors.New("source_retired")
	default:
	}
	rs := lf.receivers[receiver]
	if rs == nil || rs.Track == nil || !rs.active || lf.retired[receiver] {
		return AudioLeaseSnapshot{}, errors.New("receiver_unavailable")
	}
	if !enabled && (pair == "" || duration < time.Millisecond*100 || duration > time.Second*10) {
		return AudioLeaseSnapshot{}, errors.New("invalid_pause_duration")
	}
	now := time.Now()
	if err := rs.audio.apply(scope, pair, revision, enabled, duration, now); err != nil {
		return AudioLeaseSnapshot{}, err
	}
	return rs.audio.snapshot(now), nil
}

func (lf *LayerForwarder) AudioLeaseStats(receiver string) (AudioLeaseSnapshot, bool) {
	lf.mu.RLock()
	defer lf.mu.RUnlock()
	rs := lf.receivers[receiver]
	if rs == nil {
		return AudioLeaseSnapshot{}, false
	}
	return rs.audio.snapshot(time.Now()), true
}
