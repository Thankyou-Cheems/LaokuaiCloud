package websocket

import (
	"github.com/pion/webrtc/v4"
	"sfu-v2/internal/auth"
	"sfu-v2/internal/config"
	"testing"
)

func TestAudioOnlyRejectsLegacyAndAllGrantedVideoAndShareSlots(t *testing.T) {
	pc := newSFUPeer(t)
	tr := pc.GetTransceivers()
	h := &Handler{config: &config.Config{AudioOnly: true}}
	for _, claims := range []auth.Claims{claimsOf(auth.CapSpeak), claimsOf(auth.CapSpeak, auth.CapVideoChecked, auth.CapShareVideo, auth.CapShareScreen)} {
		if got := h.trackRefusal(claims, pc, tr[0].Receiver(), webrtc.RTPCodecTypeAudio); got != "" {
			t.Fatalf("microphone refused: %s", got)
		}
		for _, index := range []int{1, 2, 3} {
			if got := h.trackRefusal(claims, pc, tr[index].Receiver(), tr[index].Kind()); got != "audio_only" {
				t.Fatalf("slot %d allowed: %s", index, got)
			}
		}
		for _, kind := range []webrtc.RTPCodecType{webrtc.RTPCodecTypeAudio, webrtc.RTPCodecTypeVideo} {
			if got := h.trackRefusal(claims, pc, nil, kind); got != "audio_only" {
				t.Fatalf("unknown slot allowed: %s", got)
			}
		}
	}
}
func TestAudioOnlyDoesNotForwardCameraEvenWithLegacyGrant(t *testing.T) {
	kinds := publishMicAndCameraPolicy(t, claimsOf(auth.CapSpeak), true)
	if len(kinds) != 1 || kinds[0] != webrtc.RTPCodecTypeAudio {
		t.Fatalf("audio-only carried %v", kinds)
	}
}
