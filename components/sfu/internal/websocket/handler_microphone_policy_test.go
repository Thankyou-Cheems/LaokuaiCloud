package websocket

import (
	"encoding/json"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/pion/ice/v4"
	"github.com/pion/sdp/v3"
	"github.com/pion/webrtc/v4"

	"sfu-v2/internal/config"
	peerManager "sfu-v2/internal/webrtc"
	"sfu-v2/pkg/types"
)

// These tests inspect signaling offers only; they do not need ICE candidates.
// Reject every interface before address enumeration/binding, disable multicast
// DNS, and provide no STUN/TURN servers. The WebSocket fixture stays on loopback.
func newMicrophonePolicyOfferPeer(t *testing.T) *webrtc.PeerConnection {
	t.Helper()
	se := webrtc.SettingEngine{}
	se.SetInterfaceFilter(func(string) bool { return false })
	se.SetIncludeLoopbackCandidate(true)
	se.SetIPFilter(func(ip net.IP) bool { return ip.IsLoopback() })
	se.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
	se.SetICEMulticastDNSMode(ice.MulticastDNSModeDisabled)
	api := webrtc.NewAPI(webrtc.WithSettingEngine(se))
	pc, err := peerManager.CreatePeerConnection(api, webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = pc.Close() })
	return pc
}

func assertConfiguredMicrophoneWireOffer(t *testing.T, message *types.WebSocketMessage, pc *webrtc.PeerConnection) {
	t.Helper()
	if message.Event != types.EventOffer {
		t.Fatalf("event = %q, want offer", message.Event)
	}
	var offer webrtc.SessionDescription
	if err := json.Unmarshal([]byte(message.Data), &offer); err != nil {
		t.Fatal(err)
	}
	var wire, original sdp.SessionDescription
	if err := wire.Unmarshal([]byte(offer.SDP)); err != nil {
		t.Fatal(err)
	}
	if err := original.Unmarshal([]byte(pc.LocalDescription().SDP)); err != nil {
		t.Fatal(err)
	}
	microphone := wire.MediaDescriptions[0]
	if microphone.MediaName.Media != "audio" {
		t.Fatal("reserved microphone slot is not audio")
	}
	for _, expected := range []string{"maxaveragebitrate=16000", "stereo=0", "cbr=0", "usedtx=1", "useinbandfec=1"} {
		found := false
		for _, attribute := range microphone.Attributes {
			if attribute.Key == "fmtp" && strings.Contains(attribute.Value, expected) {
				found = true
			}
		}
		if !found {
			t.Errorf("microphone wire offer missing %s", expected)
		}
	}
	for _, key := range []string{"ptime", "maxptime"} {
		value, ok := microphone.Attribute(key)
		if !ok || value != "60" {
			t.Errorf("microphone %s = %q, want 60", key, value)
		}
	}
	if len(wire.MediaDescriptions) != len(original.MediaDescriptions) {
		t.Fatal("offer changed the number of media slots")
	}
	for index := 1; index < len(wire.MediaDescriptions); index++ {
		// Compare the SDP sections, not an independently reconstructed codec profile.
		wireSection := sdp.SessionDescription{MediaDescriptions: []*sdp.MediaDescription{wire.MediaDescriptions[index]}}
		originalSection := sdp.SessionDescription{MediaDescriptions: []*sdp.MediaDescription{original.MediaDescriptions[index]}}
		wireBytes, _ := wireSection.Marshal()
		originalBytes, _ := originalSection.Marshal()
		if string(wireBytes) != string(originalBytes) {
			t.Errorf("non-microphone media slot %d changed", index)
		}
	}
}

func TestRenegotiatedOfferUsesConfiguredMicrophoneOpusPolicy(t *testing.T) {
	h := &Handler{config: &config.Config{AudioOnly: true, MicrophoneOpus20: true,
		MicrophoneOpusMaxAverageBitrateBps: 16000, MicrophoneOpusPacketTimeMs: 60}}
	pc := newMicrophonePolicyOfferPeer(t)
	serverConn, clientConn := newTestSocketPair(t)
	if pending := h.renegotiateOrDefer(pc, serverConn, "synthetic-client", "synthetic-room"); pending {
		t.Fatal("configured renegotiation left pending")
	}
	message, ok := readNextMessage(t, clientConn, time.Second)
	if !ok {
		t.Fatal("no renegotiated offer reached the client")
	}
	assertConfiguredMicrophoneWireOffer(t, message, pc)
}

func TestStagedOfferUsesConfiguredMicrophoneOpusPolicy(t *testing.T) {
	h := &Handler{config: &config.Config{AudioOnly: true, MicrophoneOpus20: true,
		MicrophoneOpusMaxAverageBitrateBps: 16000, MicrophoneOpusPacketTimeMs: 60}}
	pc := newMicrophonePolicyOfferPeer(t)
	serverConn, clientConn := newTestSocketPair(t)
	if err := h.negotiateStagedPeer(pc, serverConn); err != nil {
		t.Fatal(err)
	}
	message, ok := readNextMessage(t, clientConn, time.Second)
	if !ok {
		t.Fatal("no staged offer reached the client")
	}
	assertConfiguredMicrophoneWireOffer(t, message, pc)
}
