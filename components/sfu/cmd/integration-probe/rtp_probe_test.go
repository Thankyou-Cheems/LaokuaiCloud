package main

import (
	"testing"

	"github.com/pion/rtp"
)

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

func TestRtpObservationAccountsPacketAndHeaderBytes(t *testing.T) {
	observations.Lock()
	observations.Values = map[string]*rtpSummary{}
	observations.Unlock()

	header := &rtp.Header{Version: 2, PayloadType: 111, SequenceNumber: 7, Timestamp: 960, SSRC: 1234}
	payload := []byte{0xf8, 0x01, 0x02}
	packetBytes := rtpPacketSize(header, payload)
	if packetBytes != header.MarshalSize()+len(payload) {
		t.Fatalf("packet size = %d, want header %d + payload %d", packetBytes, header.MarshalSize(), len(payload))
	}
	observeRtp("test/egress/1", packetBytes, payload)

	observations.Lock()
	summary := *observations.Values["test/egress/1"]
	observations.Unlock()
	if summary.Packets != 1 || summary.PayloadBytes != uint64(len(payload)) || summary.RTPBytes != uint64(packetBytes) || summary.RTPHeaderBytes != uint64(header.MarshalSize()) {
		t.Fatalf("unexpected packet accounting: %+v", summary)
	}
}

func TestSyntheticOpusPayloadFollowsConfiguredPacketTime(t *testing.T) {
	for _, packetTimeMs := range []int{10, 20, 40, 60} {
		payload := syntheticOpusPayload(packetTimeMs)
		got, valid := opusPacketDuration(payload)
		if !valid || got != float64(packetTimeMs) {
			t.Fatalf("ptime %d produced %v/%v", packetTimeMs, got, valid)
		}
	}
}
