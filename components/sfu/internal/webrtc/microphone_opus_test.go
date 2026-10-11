package webrtc

import (
	"reflect"
	"strings"
	"testing"

	"github.com/pion/sdp/v3"
	"github.com/pion/webrtc/v4"
)

func TestOpus20RealOfferPreservesOtherSlots(t *testing.T) {
	pc, err := CreatePeerConnection(nil, webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer pc.Close()
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	disabled, err := PreferMicrophoneOpus20(offer, false)
	if err != nil || disabled.SDP != offer.SDP {
		t.Fatal("default must remain byte exact", err)
	}
	enabled, err := PreferMicrophoneOpus20(offer, true)
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := PreferMicrophoneOpus20(enabled, true)
	if err != nil || repeated.SDP != enabled.SDP {
		t.Fatal("offer policy not idempotent", err)
	}
	var before, after sdp.SessionDescription
	if err = before.Unmarshal([]byte(offer.SDP)); err != nil {
		t.Fatal(err)
	}
	if err = after.Unmarshal([]byte(enabled.SDP)); err != nil {
		t.Fatal(err)
	}
	if len(before.MediaDescriptions) != len(after.MediaDescriptions) {
		t.Fatal("changed slot count")
	}
	for i := range before.MediaDescriptions {
		if i == 0 {
			for _, expected := range []string{"maxaveragebitrate=24000", "stereo=0", "cbr=0", "usedtx=1", "useinbandfec=1", "a=ptime:20", "a=maxptime:20"} {
				if !strings.Contains(enabled.SDP, expected) {
					t.Fatal("missing", expected)
				}
			}
		} else if !reflect.DeepEqual(before.MediaDescriptions[i], after.MediaDescriptions[i]) {
			t.Fatal("non microphone slot modified", i)
		}
	}
	// Pion caches CreateOffer and forbids modified SetLocalDescription strings.
	// Receiver preferences are sent on the wire after the cached offer is set.
	if err = pc.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	answerer, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer answerer.Close()
	if err = answerer.SetRemoteDescription(enabled); err != nil {
		t.Fatal("remote preference rejected", err)
	}
	answer, err := answerer.CreateAnswer(nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = answerer.SetLocalDescription(answer); err != nil {
		t.Fatal(err)
	}
	if err = pc.SetRemoteDescription(answer); err != nil {
		t.Fatal("Pion answer mismatch", err)
	}
	if pc.SignalingState() != webrtc.SignalingStateStable {
		t.Fatal("offer/answer did not settle")
	}
}

func TestOpus20RejectsNonReceivingOrMissingMicrophone(t *testing.T) {
	pc, err := CreatePeerConnection(nil, webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer pc.Close()
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	bad := offer
	bad.SDP = strings.Replace(bad.SDP, "a=recvonly", "a=sendonly", 1)
	if _, err = PreferMicrophoneOpus20(bad, true); err == nil {
		t.Fatal("must reject send-only mic")
	}
	bad.SDP = "invalid SDP"
	if _, err = PreferMicrophoneOpus20(bad, true); err == nil {
		t.Fatal("must reject malformed SDP")
	}
}
