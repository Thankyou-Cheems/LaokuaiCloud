package svc

import (
	"testing"
	"time"
)

// Pure state test: no API, PeerConnection, sockets, DNS or listener is created.
func TestHybridAudioLeaseStateOnly(t *testing.T) {
	now := time.Unix(1000, 0)
	var a audioLease
	if a.paused(now) {
		t.Fatal("default route paused")
	}
	if err := a.apply("authority", "pair", 1, false, time.Second, now); err != nil {
		t.Fatal(err)
	}
	if !a.paused(now) || a.snapshot(now).RemainingMs != 1000 {
		t.Fatal("pause not established")
	}
	if a.apply("authority", "pair", 1, true, 0, now) == nil {
		t.Fatal("old operation accepted")
	}
	if a.apply("other", "pair", 2, false, time.Second, now) == nil {
		t.Fatal("active authority replaced")
	}
	if a.paused(now.Add(time.Second)) {
		t.Fatal("server-owned expiry did not restore")
	}
	if a.apply("authority", "pair", 1, false, time.Second, now.Add(time.Second)) == nil {
		t.Fatal("expired operation reopened")
	}
	if err := a.apply("authority", "pair", 2, true, 0, now); err != nil {
		t.Fatal(err)
	}
	if a.paused(now) {
		t.Fatal("restore did not open")
	}
	if err := a.apply("new", "new-pair", 1, false, time.Second, now); err != nil {
		t.Fatal(err)
	}
	if a.apply("authority", "old-pair", 3, true, 0, now) == nil {
		t.Fatal("old authority cleanup cleared new pause")
	}
	if a.apply("new", "old-pair", 99, true, 0, now) == nil {
		t.Fatal("old pair cleanup cleared new pause")
	}
	if a.apply("new", "", 100, true, 0, now) == nil {
		t.Fatal("unbound cleanup cleared an active pair")
	}
	a.forwarded.Add(5)
	a.held.Add(7)
	snapshot := a.snapshot(now)
	if snapshot.ForwardedPackets != 5 || snapshot.HeldPackets != 7 {
		t.Fatal("metadata counters wrong")
	}
}
