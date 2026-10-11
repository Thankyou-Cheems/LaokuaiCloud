package svc

import (
	"errors"
	"sync/atomic"
	"time"
)

// audioLease is guarded by the forwarder's mutex. Expiry is checked on the RTP
// thread, so a missing app connection or timer never leaves a receiver paused.
type audioLease struct {
	scope     string
	revision  uint64
	pair      string
	until     time.Time
	forwarded atomic.Uint64
	held      atomic.Uint64
}

type AudioLeaseSnapshot struct {
	RemainingMs      int64  `json:"remaining_ms"`
	ForwardedPackets uint64 `json:"forwarded_packets"`
	HeldPackets      uint64 `json:"held_packets"`
}

func (a *audioLease) apply(scope, pair string, revision uint64, enabled bool, duration time.Duration, now time.Time) error {
	if a.scope == scope && revision <= a.revision {
		return errors.New("stale_audio_lease")
	}
	if a.scope != "" && a.scope != scope && now.Before(a.until) {
		return errors.New("authority_generation_conflict")
	}
	if enabled && a.paused(now) && a.pair != pair {
		return errors.New("pair_generation_conflict")
	}
	a.scope, a.revision, a.pair = scope, revision, pair
	a.until = time.Time{}
	if !enabled {
		a.until = now.Add(duration)
	}
	return nil
}
func (a *audioLease) paused(now time.Time) bool { return !a.until.IsZero() && now.Before(a.until) }
func (a *audioLease) snapshot(now time.Time) AudioLeaseSnapshot {
	remaining := int64(0)
	if a.paused(now) {
		remaining = a.until.Sub(now).Milliseconds()
	}
	return AudioLeaseSnapshot{RemainingMs: remaining, ForwardedPackets: a.forwarded.Load(), HeldPackets: a.held.Load()}
}
