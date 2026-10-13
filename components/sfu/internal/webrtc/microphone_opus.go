package webrtc

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/pion/sdp/v3"
	"github.com/pion/webrtc/v4"
)

// PreferMicrophoneOpus advertises SFU receive preferences for the reserved
// first audio (microphone) slot. It is opt-in and used only with AudioOnly.
// This is negotiation intent, not evidence that an encoder obeyed it.
// Apply to the wire offer after SetLocalDescription accepts Pion's original
// cached offer; Pion rejects changes to that cached string. ICE/MID/transport
// and every codec payload identity remain unchanged.
func PreferMicrophoneOpus(offer webrtc.SessionDescription, enabled bool, policy MicrophoneOpusReceivePolicy) (webrtc.SessionDescription, error) {
	if !enabled {
		return offer, nil
	}
	if err := policy.validate(); err != nil {
		return offer, err
	}
	var parsed sdp.SessionDescription
	if err := parsed.Unmarshal([]byte(offer.SDP)); err != nil {
		return offer, err
	}
	for _, media := range parsed.MediaDescriptions {
		if media.MediaName.Media != "audio" {
			continue
		}
		receiving := true // SDP's omitted media direction defaults to sendrecv.
		opus := ""
		for _, attr := range media.Attributes {
			if attr.Key == "inactive" || attr.Key == "sendonly" {
				receiving = false
			}
			fields := strings.Fields(attr.Value)
			if attr.Key == "rtpmap" && len(fields) == 2 && strings.EqualFold(fields[1], "opus/48000/2") {
				opus = fields[0]
			}
		}
		if !receiving || opus == "" {
			return offer, fmt.Errorf("microphone_opus20: reserved microphone slot cannot receive Opus")
		}
		kept := make([]sdp.Attribute, 0, len(media.Attributes)+3)
		existing := []string{}
		for _, attr := range media.Attributes {
			if attr.Key == "ptime" || attr.Key == "maxptime" {
				continue
			}
			if attr.Key == "fmtp" && strings.HasPrefix(attr.Value, opus+" ") {
				existing = append(existing, strings.Split(strings.TrimPrefix(attr.Value, opus+" "), ";")...)
				continue
			}
			kept = append(kept, attr)
		}
		// Stable ordering makes repeated offers byte-stable; minptime is a codec
		// decoding constraint, distinct from the requested packet duration.
		parameters, err := microphoneOpusParameters(existing, policy)
		if err != nil {
			return offer, err
		}
		packetTime := strconv.Itoa(policy.PacketTimeMs)
		media.Attributes = append(kept, sdp.NewAttribute("fmtp", opus+" "+strings.Join(parameters, ";")), sdp.NewAttribute("ptime", packetTime), sdp.NewAttribute("maxptime", packetTime))
		result, err := parsed.Marshal()
		if err != nil {
			return offer, err
		}
		offer.SDP = string(result)
		return offer, nil
	}
	return offer, fmt.Errorf("microphone_opus20: missing reserved microphone slot")
}

// PreferMicrophoneOpus20 is the compatibility wrapper for the original
// 48 kbps/20 ms profile. New deployments should call PreferMicrophoneOpus with
// the configured policy.
func PreferMicrophoneOpus20(offer webrtc.SessionDescription, enabled bool) (webrtc.SessionDescription, error) {
	return PreferMicrophoneOpus(offer, enabled, DefaultMicrophoneOpusReceivePolicy())
}
