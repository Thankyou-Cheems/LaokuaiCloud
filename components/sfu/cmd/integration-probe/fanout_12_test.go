package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"sfu-v2/internal/config"
	"sfu-v2/internal/room"
	"sfu-v2/internal/signaling"
	"sfu-v2/internal/track"
	pm "sfu-v2/internal/webrtc"
	ws "sfu-v2/internal/websocket"
	"sfu-v2/pkg/types"
)

// TestTwelveSyntheticPublishersProduceDirectedRtp is a loopback-only media
// fixture. It uses the real Pion peer connections, SFU track forwarders and
// configured 16/60 policy, then waits for the 12*11 directed egress streams.
// The payload is synthetic (see syntheticOpusPayload), so this proves
// packetization/fan-out accounting rather than browser encoder quality.
func TestTwelveSyntheticPublishersProduceDirectedRtp(t *testing.T) {
	previousLogWriter := log.Writer()
	log.SetOutput(io.Discard)
	defer log.SetOutput(previousLogWriter)
	observations.Lock()
	observations.Values = map[string]*rtpSummary{}
	observations.Unlock()

	rooms := room.NewManager(false)
	rooms.SetRequireClientToken(false)
	if err := rooms.RegisterServer("synthetic-server", "synthetic-password", "synthetic-room"); err != nil {
		t.Fatal(err)
	}
	tracks := track.NewManager(false)
	peers := pm.NewManager(false)
	policy := pm.MicrophoneOpusReceivePolicy{MaxAverageBitrateBps: 16_000, PacketTimeMs: 60}
	cfg := &config.Config{
		MaxPeers:                           12,
		PingInterval:                       20 * time.Second,
		PongTimeout:                        60 * time.Second,
		ICEAdvertiseIPs:                    []string{"127.0.0.1"},
		RequireClientToken:                 false,
		AudioOnly:                          true,
		MicrophoneOpus20:                   true,
		MicrophoneOpusMaxAverageBitrateBps: policy.MaxAverageBitrateBps,
		MicrophoneOpusPacketTimeMs:         policy.PacketTimeMs,
	}
	coordinator := signaling.NewCoordinator(tracks, peers, rooms, false)
	if err := coordinator.SetMicrophoneOpusPolicy(true, policy); err != nil {
		t.Fatal(err)
	}
	handler := ws.NewHandler(cfg, api(), tracks, peers, rooms, coordinator)
	mux := http.NewServeMux()
	mux.HandleFunc("/client", handler.HandleWebSocket)
	server := httptest.NewServer(mux)
	defer server.Close()
	defer handler.Shutdown(context.Background())
	defer tracks.Shutdown(context.Background())
	defer peers.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/client"
	clients := make([]*syntheticPeer, 0, 12)
	for i := 0; i < 12; i++ {
		userID := fmt.Sprintf("synthetic-user-%02d", i)
		client, err := joinClient(wsURL, types.ClientJoinData{
			RoomID:         "synthetic-room",
			ServerID:       "synthetic-server",
			ServerPassword: "synthetic-password",
			UserID:         userID,
		}, true, policy)
		if err != nil {
			t.Fatalf("join %s: %v", userID, err)
		}
		clients = append(clients, client)
	}
	defer func() {
		for _, client := range clients {
			client.close()
		}
	}()

	deadline := time.Now().Add(35 * time.Second)
	for time.Now().Before(deadline) {
		observations.Lock()
		egress := 0
		egressPackets := uint64(0)
		egressRtpBytes := uint64(0)
		egressPayloadBytes := uint64(0)
		egressPacketTime60 := uint64(0)
		invalidToc := uint64(0)
		for key, summary := range observations.Values {
			if strings.Contains(key, "/egress/") && summary.Packets > 0 {
				egress++
				egressPackets += summary.Packets
				egressRtpBytes += summary.RTPBytes
				egressPayloadBytes += summary.PayloadBytes
				egressPacketTime60 += summary.Durations["60"]
				invalidToc += summary.InvalidToc
			}
		}
		observations.Unlock()
		if egress >= 12*11 && egressPackets > 12*11 && egressRtpBytes > 0 && egressPacketTime60 == egressPackets && invalidToc == 0 {
			if egress != 12*11 {
				t.Logf("observed %d egress streams (at least the expected 132)", egress)
			}
			t.Logf("12-seat synthetic fan-out: streams=%d packets=%d payloadBytes=%d rtpBytes=%d packetTime60=%d invalidToc=%d", egress, egressPackets, egressPayloadBytes, egressRtpBytes, egressPacketTime60, invalidToc)
			return
		}
		time.Sleep(100 * time.Millisecond)
	}

	observations.Lock()
	defer observations.Unlock()
	egress := 0
	byPeer := map[string]int{}
	for key, summary := range observations.Values {
		if strings.Contains(key, "/egress/") && summary.Packets > 0 {
			egress++
			byPeer[strings.SplitN(key, "/egress/", 2)[0]]++
		}
	}
	t.Fatalf("only %d directed egress streams observed; want at least 132 (by SFU peer: %v)", egress, byPeer)
}
