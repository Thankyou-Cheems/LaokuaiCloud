package main

import "testing"

func TestOpusTocDuration(t *testing.T) {
	for _, fixture := range []struct {
		payload []byte
		ms      float64
		valid   bool
	}{
		{[]byte{0xf8}, 20, true}, {[]byte{0x08}, 20, true}, {[]byte{0x10}, 40, true},
		{[]byte{0xf9}, 40, true}, {[]byte{0xfb, 3}, 60, true}, {[]byte{0x80}, 2.5, true},
		{nil, 0, false}, {[]byte{0xfb}, 0, false}, {[]byte{0xfb, 0}, 0, false}, {[]byte{0xfb, 7}, 140, false},
	} {
		ms, valid := opusPacketDuration(fixture.payload)
		if ms != fixture.ms || valid != fixture.valid {
			t.Fatalf("%v -> %g/%v", fixture.payload, ms, valid)
		}
	}
}
