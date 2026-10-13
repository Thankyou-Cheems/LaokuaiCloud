package webrtc

import (
	"fmt"
	"strconv"
	"strings"
)

// MicrophoneOpusReceivePolicy is the SFU's receive-side preference for the
// reserved microphone track. It is a cap advertised in the receive offer, not
// a forced sender bitrate. The sender still takes min(requested profile, real
// channel cap, remote cap).
//
// PacketTimeMs is deliberately restricted to the values browsers and the SDK
// support. A policy is validated before it reaches SDP so a typo cannot make
// the SFU advertise a profile that clients cannot use.
type MicrophoneOpusReceivePolicy struct {
	MaxAverageBitrateBps int
	PacketTimeMs         int
}

const (
	DefaultMicrophoneOpusMaxAverageBitrateBps = 48_000
	DefaultMicrophoneOpusPacketTimeMs         = 20
	minimumMicrophoneOpusBitrateBps           = 6_000
	maximumMicrophoneOpusBitrateBps           = 510_000
)

// DefaultMicrophoneOpusReceivePolicy keeps the original SFU profile for
// existing deployments. The constrained 16 kbps/60 ms profile is selected by
// deployment configuration rather than silently changing this default.
func DefaultMicrophoneOpusReceivePolicy() MicrophoneOpusReceivePolicy {
	return MicrophoneOpusReceivePolicy{
		MaxAverageBitrateBps: DefaultMicrophoneOpusMaxAverageBitrateBps,
		PacketTimeMs:         DefaultMicrophoneOpusPacketTimeMs,
	}
}

func (p MicrophoneOpusReceivePolicy) validate() error {
	if p.MaxAverageBitrateBps < minimumMicrophoneOpusBitrateBps || p.MaxAverageBitrateBps > maximumMicrophoneOpusBitrateBps {
		return fmt.Errorf("microphone_opus: invalid receive bitrate limit %d", p.MaxAverageBitrateBps)
	}
	switch p.PacketTimeMs {
	case 10, 20, 40, 60:
		return nil
	default:
		return fmt.Errorf("microphone_opus: unsupported packet time %dms", p.PacketTimeMs)
	}
}

// Validate exposes the same fail-closed validation used by SDP generation to
// startup/configuration callers without exposing the parameter parser.
func (p MicrophoneOpusReceivePolicy) Validate() error { return p.validate() }

// Build only the reserved microphone's Opus receive parameters. Never raise an
// existing lower receive cap, even when duplicate fmtp lines advertise limits.
// Keep unrelated parameters and fail closed on malformed explicit limits.
// This helper is stdlib-only so its cap tests cannot create PCs or sockets.
func microphoneOpusParameters(existing []string, policy MicrophoneOpusReceivePolicy) ([]string, error) {
	if err := policy.validate(); err != nil {
		return nil, err
	}
	maxAverageBitrate := policy.MaxAverageBitrateBps
	extras := []string{}
	for _, parameter := range existing {
		parameter = strings.TrimSpace(parameter)
		if parameter == "" {
			continue
		}
		pair := strings.SplitN(parameter, "=", 2)
		key := strings.ToLower(strings.TrimSpace(pair[0]))
		if key == "maxaveragebitrate" {
			if len(pair) != 2 {
				return nil, fmt.Errorf("microphone_opus20: invalid receive bitrate limit")
			}
			cap, err := strconv.Atoi(strings.TrimSpace(pair[1]))
			if err != nil || cap < minimumMicrophoneOpusBitrateBps || cap > maximumMicrophoneOpusBitrateBps {
				return nil, fmt.Errorf("microphone_opus20: invalid receive bitrate limit")
			}
			if cap < maxAverageBitrate {
				maxAverageBitrate = cap
			}
			continue
		}
		switch key {
		case "minptime", "stereo", "cbr", "usedtx", "useinbandfec":
			// Existing opt-in mono/VBR/DTX/FEC policy remains unchanged.
		default:
			extras = append(extras, parameter)
		}
	}
	return append(extras, "minptime=10", "maxaveragebitrate="+strconv.Itoa(maxAverageBitrate),
		"stereo=0", "cbr=0", "usedtx=1", "useinbandfec=1"), nil
}

// microphoneOpus20Parameters preserves the old helper seam and its original
// 48 kbps/20 ms behavior for callers that have not moved to a configurable
// policy yet.
func microphoneOpus20Parameters(existing []string) ([]string, error) {
	return microphoneOpusParameters(existing, DefaultMicrophoneOpusReceivePolicy())
}
