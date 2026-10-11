package signaling

import (
	"fmt"
	"github.com/pion/ice/v4"
	"github.com/pion/webrtc/v4"
	"net"
	"os"
	"sfu-v2/internal/room"
	"sfu-v2/internal/testtransport"
	"sfu-v2/internal/track"
	peerManager "sfu-v2/internal/webrtc"
	"sync"
	"testing"
)

type discardOffer struct{}

func (discardOffer) WriteJSON(interface{}) error { return nil }

func TestConcurrentPeerReconciliation(t *testing.T) {
	if os.Getenv("GRYT_ALLOW_NETWORK_TESTS") != "1" {
		t.Skip("network test disabled; requires explicitly authorized safe transport")
	}
	for attempt := 0; attempt < 12; attempt++ {
		se := webrtc.SettingEngine{}
		guarded, err := testtransport.New()
		if err != nil {
			t.Fatal(err)
		}
		se.SetNet(guarded)
		se.SetICEMulticastDNSMode(ice.MulticastDNSModeDisabled)
		se.SetIncludeLoopbackCandidate(true)
		se.SetIPFilter(func(ip net.IP) bool { return ip.IsLoopback() })
		se.SetRemoteIPFilter(func(ip net.IP) bool { return ip.IsLoopback() })
		se.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
		pc, err := webrtc.NewAPI(webrtc.WithSettingEngine(se)).NewPeerConnection(webrtc.Configuration{})
		if err != nil {
			t.Fatal(err)
		}
		c := NewCoordinator(track.NewManager(false), peerManager.NewManager(false), room.NewManager(false), false)
		tracks := map[string]*webrtc.TrackLocalStaticRTP{}
		for i := 0; i < 6; i++ {
			id := fmt.Sprintf("synthetic-track-%d", i)
			tr, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus}, id, "synthetic-stream-"+id)
			if err != nil {
				t.Fatal(err)
			}
			tracks[id] = tr
		}
		start := make(chan struct{})
		var wg sync.WaitGroup
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				_ = c.serializePeer(pc, func() error { return c.processPeerConnection("receiver", pc, discardOffer{}, tracks, "synthetic-room") })
			}()
		}
		close(start)
		wg.Wait()
		counts := map[string]int{}
		for _, s := range pc.GetSenders() {
			if s.Track() != nil {
				counts[s.Track().ID()]++
			}
		}
		offer, offerErr := pc.CreateOffer(nil)
		duplicates := 0
		for _, n := range counts {
			if n > 1 {
				duplicates += n - 1
			}
		}
		t.Logf("attempt=%d senders=%v duplicateSenders=%d offerBytes=%d offerError=%v", attempt, counts, duplicates, len(offer.SDP), offerErr)
		if len(c.peerLocks) != 0 {
			t.Fatal("idle connection lock retained")
		}
		_ = pc.Close()
		if duplicates > 0 {
			t.Fatalf("concurrent reconciliation published duplicate physical track senders: %v", counts)
		}
	}
}
