package websocket

import (
	"encoding/json"
	"net/http"
	"sfu-v2/internal/auth"
	"sfu-v2/internal/config"
	"sfu-v2/internal/room"
	"sfu-v2/pkg/types"
	"testing"
	"time"
)

func TestStagedCapabilitiesCannotBeActivatedByGenericPush(t *testing.T) {
	var peers livePeers
	live := auth.NewLive(claimsOf(auth.CapVideoChecked))
	peers.add("pending", "new", "user", live)
	peers.stage("pending")
	all := claimsOf(auth.CapSpeak, auth.CapVideoChecked, auth.CapShareVideo)
	if peers.set("new", "user", all) != 0 {
		t.Fatal("staged claims pushed")
	}
	held, _ := live.Snapshot()
	if held.Can(auth.CapSpeak) {
		t.Fatal("pending publishing unheld")
	}
	peers.activate("pending", all.Capabilities, true)
	muted, _ := live.Snapshot()
	if muted.Can(auth.CapSpeak) {
		t.Fatal("muted move started speaking")
	}
	peers.audio("new", "user", false)
	active, _ := live.Snapshot()
	if !active.Can(auth.CapSpeak) {
		t.Fatal("unmute did not restore granted speak")
	}
	if !peers.refresh("pending", []string{auth.CapVideoChecked}, false) {
		t.Fatal("live move refresh refused")
	}
	refreshed, _ := live.Snapshot()
	if refreshed.Can(auth.CapSpeak) {
		t.Fatal("refresh kept revoked destination speak")
	}
	peers.retire("pending")
	if peers.refresh("pending", all.Capabilities, false) {
		t.Fatal("retired refresh accepted")
	}
	peers.activate("pending", all.Capabilities, false)
	peers.set("new", "user", all)
	retired, _ := live.Snapshot()
	if retired.Can(auth.CapSpeak) {
		t.Fatal("retired source reactivated")
	}
}

func TestHistoricalCommitCannotActivateLaterStagedPeer(t *testing.T) {
	var peers livePeers
	old := auth.NewLive(claimsOf(auth.CapVideoChecked))
	next := auth.NewLive(claimsOf(auth.CapVideoChecked))
	peers.add("first-request-peer", "destination", "user", old)
	peers.stage("first-request-peer")
	peers.activate("first-request-peer", []string{auth.CapVideoChecked, auth.CapSpeak}, false)
	peers.retire("first-request-peer")
	peers.add("next-request-peer", "destination", "user", next)
	peers.stage("next-request-peer")
	peers.activate("first-request-peer", []string{auth.CapVideoChecked, auth.CapSpeak}, false)
	for _, live := range []*auth.Live{old, next} {
		claims, _ := live.Snapshot()
		if claims.Can(auth.CapSpeak) {
			t.Fatal("historical commit activated retired or later staged peer")
		}
	}
}

func TestMoveControlEchoesCommandCorrelationWithoutSecrets(t *testing.T) {
	rooms := room.NewManager(false)
	if err := rooms.RegisterServer("server", "secret", "room"); err != nil {
		t.Fatal(err)
	}
	h := &Handler{roomManager: rooms, config: &config.Config{}}
	server, client := newTestSocketPair(t)
	request := types.MoveRequest{CommandID: "command", RequestID: "request", ServerID: "server", ServerPassword: "secret"}
	data, _ := json.Marshal(request)
	if err := h.handleMoveCommand(server, "move_probe", string(data)); err != nil {
		t.Fatal(err)
	}
	message, ok := readNextMessage(t, client, time.Second)
	if !ok || message.Event != types.EventMoveResult {
		t.Fatal("missing ack")
	}
	var result types.MoveResult
	if err := json.Unmarshal([]byte(message.Data), &result); err != nil {
		t.Fatal(err)
	}
	if result.CommandID != "command" || result.RequestID != "request" || result.Status != "supported" {
		t.Fatalf("wrong ack %+v", result)
	}
	var fields map[string]any
	json.Unmarshal([]byte(message.Data), &fields)
	for _, key := range []string{"server_password", "nonce", "user_token"} {
		if _, exists := fields[key]; exists {
			t.Fatalf("secret field %s returned", key)
		}
	}
}

func TestStagedTokenCannotBypassPreparationByOmittingMoveID(t *testing.T) {
	rooms := room.NewManager(false)
	rooms.SetRequireClientToken(true)
	if err := rooms.RegisterServer("server", "secret", "new"); err != nil {
		t.Fatal(err)
	}
	h := &Handler{roomManager: rooms, config: &config.Config{}}
	server, client := newTestSocketPair(t)
	token := auth.SignV2("secret", "user", "new", "nonce", time.Now().Add(time.Minute), []string{auth.CapSpeak, "app_socket:generation", "move:request:long-nonce"})
	join := types.ClientJoinData{ServerID: "server", RoomID: "new", UserID: "user", UserToken: token}
	data, _ := json.Marshal(join)
	if err := client.WriteJSON(&types.WebSocketMessage{Event: types.EventClientJoin, Data: string(data)}); err != nil {
		t.Fatal(err)
	}
	if err := h.handleClientConnection(server, "pending", &http.Request{}); err == nil {
		t.Fatal("staged token entered normal room")
	}
	if rooms.TotalPeers() != 0 {
		t.Fatal("bypass created live membership")
	}
}
