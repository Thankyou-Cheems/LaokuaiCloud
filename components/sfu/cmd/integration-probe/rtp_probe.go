// Test-only aggregate RTP metadata. No encoded or decoded audio is retained.
package main

import (
	"fmt"
	"strings"
	"sync"

	"github.com/pion/interceptor"
	"github.com/pion/rtp"
)

type rtpSummary struct {
	Packets        uint64            `json:"packets"`
	PayloadBytes   uint64            `json:"payloadBytes"`
	RTPBytes       uint64            `json:"rtpBytes"`
	RTPHeaderBytes uint64            `json:"rtpHeaderBytes"`
	MonoPackets    uint64            `json:"monoPackets"`
	StereoPackets  uint64            `json:"stereoPackets"`
	InvalidToc     uint64            `json:"invalidToc"`
	Durations      map[string]uint64 `json:"packetDurationMs"`
}

var observations = struct {
	sync.Mutex
	Values map[string]*rtpSummary
}{Values: map[string]*rtpSummary{}}

type metadataFactory struct{}
type metadataInterceptor struct {
	interceptor.NoOp
	id string
}

func (metadataFactory) NewInterceptor(id string) (interceptor.Interceptor, error) {
	return &metadataInterceptor{id: id}, nil
}
func opusPacketDuration(payload []byte) (float64, bool) {
	if len(payload) == 0 {
		return 0, false
	}
	config := int(payload[0] >> 3)
	var duration float64
	if config >= 16 {
		duration = []float64{2.5, 5, 10, 20}[config&3]
	} else if config >= 12 {
		duration = []float64{10, 20}[config&1]
	} else {
		duration = []float64{10, 20, 40, 60}[config&3]
	}
	count := 1
	switch payload[0] & 3 {
	case 1, 2:
		count = 2
	case 3:
		if len(payload) < 2 {
			return 0, false
		}
		count = int(payload[1] & 63)
	}
	total := duration * float64(count)
	return total, count > 0 && total <= 120
}
func observeRtp(key string, packetBytes int, payload []byte) {
	observations.Lock()
	defer observations.Unlock()
	summary := observations.Values[key]
	if summary == nil {
		// A 12-seat all-speakers room has 12 ingress plus 132 directed
		// egress streams. Keep the probe bounded, but large enough to retain
		// that fan-out instead of silently truncating at 128 entries.
		if len(observations.Values) >= 1024 {
			return
		}
		summary = &rtpSummary{Durations: map[string]uint64{}}
		observations.Values[key] = summary
	}
	summary.Packets++
	summary.PayloadBytes += uint64(len(payload))
	if packetBytes < len(payload) {
		// A malformed interceptor input must not wrap the unsigned counters.
		packetBytes = len(payload)
	}
	summary.RTPBytes += uint64(packetBytes)
	summary.RTPHeaderBytes += uint64(packetBytes - len(payload))
	duration, valid := opusPacketDuration(payload)
	if !valid {
		summary.InvalidToc++
		return
	}
	summary.Durations[fmt.Sprintf("%g", duration)]++
	if payload[0]&4 == 0 {
		summary.MonoPackets++
	} else {
		summary.StereoPackets++
	}
}
func (m *metadataInterceptor) BindRemoteStream(info *interceptor.StreamInfo, reader interceptor.RTPReader) interceptor.RTPReader {
	if !strings.EqualFold(info.MimeType, "audio/opus") {
		return reader
	}
	key := fmt.Sprintf("%s/ingress/%d", m.id, info.SSRC)
	return interceptor.RTPReaderFunc(func(buf []byte, a interceptor.Attributes) (int, interceptor.Attributes, error) {
		n, attrs, err := reader.Read(buf, a)
		if err == nil {
			var packet rtp.Packet
			if packet.Unmarshal(buf[:n]) == nil {
				observeRtp(key, n, packet.Payload)
			}
		}
		return n, attrs, err
	})
}
func (m *metadataInterceptor) BindLocalStream(info *interceptor.StreamInfo, writer interceptor.RTPWriter) interceptor.RTPWriter {
	if !strings.EqualFold(info.MimeType, "audio/opus") {
		return writer
	}
	key := fmt.Sprintf("%s/egress/%d", m.id, info.SSRC)
	return interceptor.RTPWriterFunc(func(header *rtp.Header, payload []byte, a interceptor.Attributes) (int, error) {
		n, err := writer.Write(header, payload, a)
		if err == nil {
			observeRtp(key, rtpPacketSize(header, payload), payload)
		}
		return n, err
	})
}

func rtpPacketSize(header *rtp.Header, payload []byte) int {
	if header == nil {
		return len(payload)
	}
	return (&rtp.Packet{Header: *header, Payload: payload}).MarshalSize()
}
