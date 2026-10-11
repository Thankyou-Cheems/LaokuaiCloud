package webrtc

import (
	"fmt"
	"strconv"
	"strings"
)

// This is the SFU microphone receive ceiling, not a forced sender bitrate.
// The sender still takes min(requested profile, real channel cap, remote cap).
const microphoneOpus20DefaultMaxAverageBitrate = 48_000

// Build only the reserved microphone's Opus receive parameters. Never raise an
// existing lower receive cap, even when duplicate fmtp lines advertise limits.
// Keep unrelated parameters and fail closed on malformed explicit limits.
// This helper is stdlib-only so its cap tests cannot create PCs or sockets.
func microphoneOpus20Parameters(existing []string) ([]string, error) {
	maxAverageBitrate := microphoneOpus20DefaultMaxAverageBitrate
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
			if err != nil || cap < 6_000 || cap > 510_000 {
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
