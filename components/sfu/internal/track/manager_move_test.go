package track

import (
	"github.com/pion/webrtc/v4"
	"testing"
)

func TestNewForwarderInheritsReceiverFence(t *testing.T) {
	m := NewManager(false)
	oldPC, _ := webrtc.NewPeerConnection(webrtc.Configuration{})
	defer oldPC.Close()
	senderPC, _ := webrtc.NewPeerConnection(webrtc.Configuration{})
	defer senderPC.Close()
	m.FencePeer("source", "old-receiver", oldPC)
	local := m.AddTrackToRoom("source", &webrtc.TrackRemote{}, senderPC)
	if local == nil {
		t.Fatal("new source-room forwarder not created")
	}
	lf, ok := m.GetForwarder("source", local.ID())
	if !ok {
		t.Fatal("forwarder missing")
	}
	if lf.AddReceiver("old-receiver", 0) != nil {
		t.Fatal("new forwarder admitted retired receiver")
	}
}
