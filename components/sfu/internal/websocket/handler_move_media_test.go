package websocket

import (
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"sfu-v2/internal/auth"
	"sfu-v2/internal/config"
	"sfu-v2/internal/room"
	"sfu-v2/internal/track"
	peerManager "sfu-v2/internal/webrtc"
	"sfu-v2/pkg/types"
	"testing"
	"time"
)

// Two synthetic loopback publishers use real Pion negotiation and generated RTP.
// No microphone, production endpoint, auth profile or persistent listener is used.
func TestRealStagedTransportHoldsMediaUntilAtomicCommit(t *testing.T) {
	rooms := room.NewManager(false)
	tracks := track.NewManager(false)
	for _, id := range []string{"old", "new"} {
		if err := rooms.RegisterServer("server", "secret", id); err != nil {
			t.Fatal(err)
		}
	}
	h := &Handler{config: &config.Config{}, roomManager: rooms, trackManager: tracks, coordinator: quietCoordinator{}}
	create := func(id, roomID string, live *auth.Live) (*webrtc.PeerConnection, *webrtc.PeerConnection, *ThreadSafeWriter, *webrtc.TrackLocalStaticRTP) {
		pc, err := peerManager.CreatePeerConnection(loopbackAPI(), webrtc.Configuration{})
		if err != nil {
			t.Fatal(err)
		}
		client, err := loopbackAPI().NewPeerConnection(webrtc.Configuration{})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { pc.Close(); client.Close() })
		conn, _ := newTestSocketPair(t)
		h.live.add(id, roomID, "user", live)
		h.setupWebRTCHandlers(pc, conn, id, roomID, live)
		local, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2}, "mic", id)
		if err != nil {
			t.Fatal(err)
		}
		return pc, client, conn, local
	}
	granted := []string{auth.CapSpeak, auth.CapVideoChecked}
	oldPC, oldClient, oldConn, oldMic := create("old-peer", "old", auth.NewLive(claimsOf(granted...)))
	if err := rooms.AddPeerToRoom("old", "old-peer", "user", oldPC, oldConn); err != nil {
		t.Fatal(err)
	}
	rooms.BindPeerSession("old-peer", "generation")
	connectForTest(t, oldPC, oldClient, func() {
		if _, err := oldClient.AddTrack(oldMic); err != nil {
			t.Fatal(err)
		}
	})
	request := types.MoveRequest{RequestID: "transfer", ServerID: "server", ServerPassword: "secret", UserID: "user", SourceRoomID: "old", DestinationRoomID: "new", SocketID: "generation", Nonce: "synthetic-long-nonce", ExpiresAtMs: time.Now().Add(30 * time.Second).UnixMilli(), Capabilities: granted}
	if _, err := rooms.PrepareMove(request); err != nil {
		t.Fatal(err)
	}
	newPC, newClient, newConn, newMic := create("pending", "new", auth.NewLive(claimsOf(auth.CapVideoChecked)))
	h.live.stage("pending")
	if err := rooms.AttachMove(request, "pending", newPC, newConn); err != nil {
		t.Fatal(err)
	}
	connectForTest(t, newPC, newClient, func() {
		if _, err := newClient.AddTrack(newMic); err != nil {
			t.Fatal(err)
		}
	})
	stop, done := make(chan struct{}), make(chan struct{})
	t.Cleanup(func() { close(stop); <-done })
	go func() {
		defer close(done)
		ticker := time.NewTicker(20 * time.Millisecond)
		defer ticker.Stop()
		for seq := uint16(0); ; seq++ {
			select {
			case <-stop:
				return
			case <-ticker.C:
			}
			for _, mic := range []*webrtc.TrackLocalStaticRTP{oldMic, newMic} {
				_ = mic.WriteRTP(&rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: seq, Timestamp: uint32(seq) * 960}, Payload: []byte{0x10, 0, 0, 0}})
			}
		}
	}()
	wait := func(description string, predicate func() bool) {
		t.Helper()
		for end := time.Now().Add(3 * time.Second); time.Now().Before(end); time.Sleep(10 * time.Millisecond) {
			if predicate() {
				return
			}
		}
		t.Fatal(description)
	}
	wait("source audio never appeared", func() bool { return len(tracks.GetTracksInRoom("old")) == 1 })
	wait("real staged PC never became ready", func() bool { result, _ := rooms.QueryMove(request); return result.Status == "ready" })
	time.Sleep(100 * time.Millisecond)
	if len(tracks.GetTracksInRoom("new")) != 0 || rooms.TotalPeers() != 1 {
		t.Fatal("pending media/membership leaked")
	}
	result, err := rooms.CommitMove(request, func(pc *webrtc.PeerConnection, id, roomID string) {
		h.live.retire(id)
		tracks.FencePeer(roomID, id, pc)
	})
	if err != nil || result.Status != "committed" {
		t.Fatalf("%+v %v", result, err)
	}
	if len(tracks.GetTracksInRoom("old")) != 0 {
		t.Fatal("source publication survived commit acknowledgement")
	}
	h.live.activate(result.PeerID, granted, false)
	wait("committed destination audio never appeared", func() bool { return len(tracks.GetTracksInRoom("new")) == 1 })
	if oldPC.ConnectionState() != webrtc.PeerConnectionStateClosed || rooms.TotalPeers() != 1 {
		t.Fatal("old peer survived or seat duplicated")
	}
}
