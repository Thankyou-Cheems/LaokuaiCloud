package room

import (
	"github.com/pion/webrtc/v4"
	"sfu-v2/pkg/types"
	"sync"
	"testing"
	"time"
)

type moveWriter struct{ closed bool }

func (w *moveWriter) WriteJSON(any) error { return nil }
func (w *moveWriter) Close() error        { w.closed = true; return nil }

func TestPreparedMovePreservesSourceUntilCommit(t *testing.T) {
	m := NewManager(false)
	if err := m.RegisterServer("server", "secret", "old"); err != nil {
		t.Fatal(err)
	}
	if err := m.RegisterServer("server", "secret", "new"); err != nil {
		t.Fatal(err)
	}
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer pc.Close()
	old := &moveWriter{}
	if err = m.AddPeerToRoom("old", "old-peer", "user", pc, old); err != nil {
		t.Fatal(err)
	}
	m.BindPeerSession("old-peer", "socket-generation-1")
	req := types.MoveRequest{RequestID: "move-1", ServerID: "server", ServerPassword: "secret", UserID: "user", SourceRoomID: "old", DestinationRoomID: "new", SocketID: "socket-generation-1", Nonce: "synthetic-nonce-long", ExpiresAtMs: time.Now().Add(30 * time.Second).UnixMilli()}
	reply, err := m.PrepareMove(req)
	if err != nil || reply.Status != "prepared" {
		t.Fatalf("%+v %v", reply, err)
	}
	staged, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer staged.Close()
	pending := &moveWriter{}
	if err = m.AttachMove(req, "new-peer", staged, pending); err != nil {
		t.Fatal(err)
	}
	rooms := m.GetRoomPeersForServer("server")
	if len(rooms) != 1 || rooms[0].RoomID != "old" {
		t.Fatalf("pending leaked: %+v", rooms)
	}
	if old.closed {
		t.Fatal("source closed during prepare")
	}
	m.ReadyMove("new-peer")
	reply, err = m.CommitMove(req, func(*webrtc.PeerConnection, string, string) {})
	if err != nil || reply.Status != "committed" {
		t.Fatalf("%+v %v", reply, err)
	}
	rooms = m.GetRoomPeersForServer("server")
	if len(rooms) != 1 || rooms[0].RoomID != "new" {
		t.Fatalf("non-atomic outcome: %+v", rooms)
	}
	again, err := m.CommitMove(req, func(*webrtc.PeerConnection, string, string) { t.Fatal("commit executed twice") })
	if err != nil || again.Status != "committed" {
		t.Fatalf("retry %+v %v", again, err)
	}
}

func moveFixture(t *testing.T) (*Manager, types.MoveRequest, *webrtc.PeerConnection, *webrtc.PeerConnection, *moveWriter, *moveWriter) {
	t.Helper()
	m := NewManager(false)
	for _, id := range []string{"old", "new"} {
		if err := m.RegisterServer("server", "secret", id); err != nil {
			t.Fatal(err)
		}
	}
	oldPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	newPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { oldPC.Close(); newPC.Close() })
	old, pending := &moveWriter{}, &moveWriter{}
	if err = m.AddPeerToRoom("old", "old-peer", "user", oldPC, old); err != nil {
		t.Fatal(err)
	}
	m.BindPeerSession("old-peer", "generation")
	req := types.MoveRequest{RequestID: "move", ServerID: "server", ServerPassword: "secret", UserID: "user", SourceRoomID: "old", DestinationRoomID: "new", SocketID: "generation", Nonce: "synthetic-long-nonce", ExpiresAtMs: time.Now().Add(30 * time.Second).UnixMilli()}
	return m, req, oldPC, newPC, old, pending
}

func TestRemoveMoveFencesCommittedPeerAndPreservesHistoricalOutcome(t *testing.T) {
	m, req, _, pc, _, writer := moveFixture(t)
	prepareAttached(t, m, req, pc, writer)
	m.ReadyMove("pending")
	committed, err := m.CommitMove(req, func(*webrtc.PeerConnection, string, string) {})
	if err != nil || committed.PeerID != "pending" {
		t.Fatalf("%+v %v", committed, err)
	}
	fenced := false
	removed, err := m.RemoveMove(req, func(actual *webrtc.PeerConnection, id, roomID string) {
		if actual != pc || id != "pending" || roomID != "new" {
			t.Fatal("wrong peer fenced")
		}
		fenced = true
	})
	if err != nil || !fenced || !removed.Removed || removed.Status != "committed" || m.TotalPeers() != 0 || !writer.closed {
		t.Fatalf("%+v %v", removed, err)
	}
	query, err := m.QueryMove(req)
	if err != nil || query.Status != "committed" || !query.Removed {
		t.Fatalf("historical result changed: %+v %v", query, err)
	}
	replacement, _ := webrtc.NewPeerConnection(webrtc.Configuration{})
	defer replacement.Close()
	m.AddPeerToRoom("new", "replacement", "user", replacement, &moveWriter{})
	m.BindPeerSession("replacement", "new-generation")
	m.RemoveMove(req, func(*webrtc.PeerConnection, string, string) { t.Fatal("replacement fenced by old request") })
	if m.TotalPeers() != 1 {
		t.Fatal("replacement generation removed")
	}
}

func TestRefreshMoveAppliesOnlyExactCommittedGeneration(t *testing.T) {
	m, req, _, pc, _, writer := moveFixture(t)
	prepareAttached(t, m, req, pc, writer)
	if _, err := m.RefreshMove(req, func(string) bool { t.Fatal("pending refreshed"); return false }); err == nil {
		t.Fatal("pending refresh accepted")
	}
	m.ReadyMove("pending")
	m.CommitMove(req, func(*webrtc.PeerConnection, string, string) {})
	req.IsDeafened, req.IsMuted, req.Capabilities = true, true, []string{"video_checked"}
	applied := false
	result, err := m.RefreshMove(req, func(id string) bool {
		if id != "pending" {
			t.Fatal("wrong peer")
		}
		applied = true
		return true
	})
	if err != nil || !applied || result.Status != "committed" || !m.IsUserDeafened("new", "pending") {
		t.Fatalf("%+v %v", result, err)
	}
	m.RemoveMove(req, func(*webrtc.PeerConnection, string, string) {})
	if _, err = m.RefreshMove(req, func(string) bool { t.Fatal("removed refreshed"); return false }); err == nil {
		t.Fatal("removed refresh accepted")
	}
}
func prepareAttached(t *testing.T, m *Manager, r types.MoveRequest, pc *webrtc.PeerConnection, w JSONWriter) {
	t.Helper()
	if _, err := m.PrepareMove(r); err != nil {
		t.Fatal(err)
	}
	if err := m.AttachMove(r, "pending", pc, w); err != nil {
		t.Fatal(err)
	}
}
func assertSource(t *testing.T, m *Manager, old *moveWriter) {
	t.Helper()
	rooms := m.GetRoomPeersForServer("server")
	if len(rooms) != 1 || rooms[0].RoomID != "old" || old.closed {
		t.Fatalf("source lost: %+v closed=%v", rooms, old.closed)
	}
}
func TestAbortAndUnreadyCommitKeepSource(t *testing.T) {
	m, r, _, pending, old, w := moveFixture(t)
	prepareAttached(t, m, r, pending, w)
	if _, err := m.CommitMove(r, func(*webrtc.PeerConnection, string, string) { t.Fatal("unready media fenced") }); err == nil {
		t.Fatal("unready committed")
	}
	assertSource(t, m, old)
	result, err := m.AbortMove(r)
	if err != nil || result.Status != "aborted" {
		t.Fatalf("%+v %v", result, err)
	}
	assertSource(t, m, old)
	if !w.closed || pending.ConnectionState() != webrtc.PeerConnectionStateClosed {
		t.Fatal("pending leaked after abort")
	}
	if again, err := m.AbortMove(r); err != nil || again.Status != "aborted" {
		t.Fatalf("retry %+v %v", again, err)
	}
}
func TestSourceGenerationAndPendingFailureCannotCommit(t *testing.T) {
	for _, mode := range []string{"source-generation", "source-left", "pending-closed"} {
		t.Run(mode, func(t *testing.T) {
			m, r, _, pending, old, w := moveFixture(t)
			prepareAttached(t, m, r, pending, w)
			m.ReadyMove("pending")
			switch mode {
			case "source-generation":
				m.BindPeerSession("old-peer", "replacement")
			case "source-left":
				m.RemovePeerFromRoom("old", "old-peer")
			case "pending-closed":
				pending.Close()
			}
			if _, err := m.CommitMove(r, func(*webrtc.PeerConnection, string, string) { t.Fatal("invalid source fenced") }); err == nil {
				t.Fatal("invalid state committed")
			}
			dest, _ := m.GetPeersInRoom("new")
			if len(dest) != 0 {
				t.Fatal("ghost destination")
			}
			if old.closed {
				t.Fatal("failed commit closed source")
			}
			if _, err := m.AbortMove(r); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestMoveCredentialsIdentityAndPerUserReservation(t *testing.T) {
	m, r, _, pending, old, w := moveFixture(t)
	bad := r
	bad.SocketID = "old-generation"
	if _, err := m.PrepareMove(bad); err == nil {
		t.Fatal("old generation accepted")
	}
	prepareAttached(t, m, r, pending, w)
	bad = r
	bad.RequestID = "competing"
	if _, err := m.PrepareMove(bad); err == nil {
		t.Fatal("two transfers reserved same user")
	}
	bad = r
	bad.ServerPassword = "wrong"
	if _, err := m.QueryMove(bad); err == nil {
		t.Fatal("unauthenticated query")
	}
	bad = r
	bad.Nonce = "different-long-nonce"
	if _, err := m.AbortMove(bad); err == nil {
		t.Fatal("wrong identity aborted")
	}
	assertSource(t, m, old)
	m.AbortMove(r)
}
func TestConcurrentCommitAbortAndSyncNeverSeeDuplicateOrEmptyMembership(t *testing.T) {
	for i := 0; i < 20; i++ {
		m, r, _, pending, _, w := moveFixture(t)
		prepareAttached(t, m, r, pending, w)
		m.ReadyMove("pending")
		var workers sync.WaitGroup
		workers.Add(3)
		go func() { defer workers.Done(); m.CommitMove(r, func(*webrtc.PeerConnection, string, string) {}) }()
		go func() { defer workers.Done(); m.AbortMove(r) }()
		go func() {
			defer workers.Done()
			for j := 0; j < 50; j++ {
				rooms := m.GetRoomPeersForServer("server")
				if len(rooms) != 1 || len(rooms[0].UserIDs) != 1 {
					t.Errorf("non-atomic sync %+v", rooms)
				}
			}
		}()
		workers.Wait()
		result, err := m.QueryMove(r)
		if err != nil || (result.Status != "committed" && result.Status != "aborted") {
			t.Fatalf("%+v %v", result, err)
		}
	}
}
func TestExpiryClosesOnlyPendingAndReleasesReservation(t *testing.T) {
	m, r, _, pending, old, w := moveFixture(t)
	r.ExpiresAtMs = time.Now().Add(100 * time.Millisecond).UnixMilli()
	prepareAttached(t, m, r, pending, w)
	deadline := time.Now().Add(time.Second)
	for {
		out, err := m.QueryMove(r)
		if err != nil {
			t.Fatal(err)
		}
		if out.Status == "aborted" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("expiry did not abort")
		}
		time.Sleep(time.Millisecond)
	}
	assertSource(t, m, old)
	next := r
	next.RequestID = "next"
	next.ExpiresAtMs = time.Now().Add(time.Second).UnixMilli()
	if _, err := m.PrepareMove(next); err != nil {
		t.Fatalf("expired reservation retained: %v", err)
	}
	m.AbortMove(next)
}
