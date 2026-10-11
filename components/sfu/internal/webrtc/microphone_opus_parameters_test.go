package webrtc

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestMicrophoneOpus20ReceiveCaps(t *testing.T) {
	cases := []struct {
		name  string
		input []string
		want  string
	}{
		{"standard48", nil, "48000"},
		{"retain16", []string{"maxaveragebitrate=16000"}, "16000"},
		{"retain24", []string{"maxaveragebitrate=24000"}, "24000"},
		{"retain32", []string{"maxaveragebitrate=32000"}, "32000"},
		{"minimum6", []string{"maxaveragebitrate=6000"}, "6000"},
		{"peer64DoesNotChangeSfuCeiling", []string{"maxaveragebitrate=64000"}, "48000"},
		{"custom96LimitedBySfuReceiveCeiling", []string{"maxaveragebitrate=96000"}, "48000"},
		{"codecMaximum", []string{"maxaveragebitrate=510000"}, "48000"},
		{"duplicateLowerFirst", []string{"maxaveragebitrate=16000", "maxaveragebitrate=48000"}, "16000"},
		{"duplicateLowerLast", []string{"maxaveragebitrate=48000", "maxaveragebitrate=16000"}, "16000"},
		{"caseAndWhitespace", []string{" MAXAVERAGEBITRATE = 32000 "}, "32000"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			parameters, err := microphoneOpus20Parameters(c.input)
			if err != nil {
				t.Fatal(err)
			}
			joined := strings.Join(parameters, ";")
			if !strings.Contains(joined, "maxaveragebitrate="+c.want) || strings.Count(joined, "maxaveragebitrate=") != 1 {
				t.Fatalf("wrong receive cap: %s", joined)
			}
			repeated, err := microphoneOpus20Parameters(parameters)
			if err != nil || !reflect.DeepEqual(repeated, parameters) {
				t.Fatal("not idempotent", err)
			}
			// Exact production-helper output for the SDK fake-sender cap regression.
			fixture, err := json.Marshal(map[string]string{"case": c.name, "fmtp": joined})
			if err != nil {
				t.Fatal(err)
			}
			fmt.Println("MICROPHONE_CAP_FIXTURE " + string(fixture))
		})
	}
}

func TestMicrophoneOpus20InvalidCapsFailClosed(t *testing.T) {
	for _, cap := range []string{"", "0", "-1", "5999", "510001", "NaN", "Infinity", "16000.5", "999999999999999999999999"} {
		if _, err := microphoneOpus20Parameters([]string{"maxaveragebitrate=" + cap}); err == nil {
			t.Fatal("accepted invalid explicit cap", cap)
		}
	}
	if _, err := microphoneOpus20Parameters([]string{"maxaveragebitrate"}); err == nil {
		t.Fatal("accepted cap without value")
	}
}

func TestMicrophoneOpus20OtherParametersPreserved(t *testing.T) {
	parameters, err := microphoneOpus20Parameters([]string{"vendor=x", "sprop-stereo=0", "minptime=5", "stereo=1", "cbr=1", "usedtx=0", "useinbandfec=0", ""})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"vendor=x", "sprop-stereo=0", "minptime=10", "maxaveragebitrate=48000", "stereo=0", "cbr=0", "usedtx=1", "useinbandfec=1"}
	if !reflect.DeepEqual(parameters, want) {
		t.Fatalf("unexpected params: %v", parameters)
	}
}
