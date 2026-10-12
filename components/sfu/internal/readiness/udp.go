package readiness

import (
	"context"
	"crypto/rand"
	"log"
	"net"
	"strings"
	"sync/atomic"
	"time"
)

var udpVerified atomic.Bool

// IsUDPReady reports whether the outbound UDP connectivity check has passed.
func IsUDPReady() bool { return udpVerified.Load() }

// VerifyUDP sends STUN Binding Requests in the background so /health can gate on
// IsUDPReady(): Docker Desktop's UDP forwarding can lag the container process.
func VerifyUDP(stunServers []string, disableSTUN bool) {
	VerifyUDPContext(context.Background(), stunServers, disableSTUN)
}

func VerifyUDPContext(ctx context.Context, stunServers []string, disableSTUN bool) <-chan struct{} {
	done := make(chan struct{})
	if disableSTUN || len(stunServers) == 0 {
		log.Printf("🧊 UDP readiness: STUN disabled or no servers configured — ready immediately")
		udpVerified.Store(true)
		close(done)
		return done
	}

	go func() { defer close(done); verifyLoopContext(ctx, stunServers) }()
	return done
}

func verifyLoop(stunServers []string) {
	verifyLoopContext(context.Background(), stunServers)
}

func verifyLoopContext(ctx context.Context, stunServers []string) {
	const maxAttempts = 8
	delay := 1 * time.Second

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if ctx.Err() != nil {
			return
		}
		for _, raw := range stunServers {
			addr := strings.TrimPrefix(raw, "stun:")
			if sendSTUNBindingContext(ctx, addr) {
				log.Printf("✅ UDP readiness verified via STUN (%s) on attempt %d", raw, attempt)
				udpVerified.Store(true)
				return
			}
		}

		if attempt < maxAttempts {
			log.Printf("⚠️  UDP readiness: STUN probe failed (attempt %d/%d), retrying in %v", attempt, maxAttempts, delay)
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
			if delay < 5*time.Second {
				delay *= 2
			}
		}
	}

	if ctx.Err() != nil {
		return
	}
	log.Printf("⚠️  UDP readiness: could not verify after %d attempts — proceeding anyway", maxAttempts)
	udpVerified.Store(true)
}

// sendSTUNBinding sends a minimal RFC 5389 Binding Request and checks for a
// Binding Success Response. Uses raw UDP so there is no extra dependency.
func sendSTUNBinding(serverAddr string) bool {
	return sendSTUNBindingContext(context.Background(), serverAddr)
}

func sendSTUNBindingContext(ctx context.Context, serverAddr string) bool {
	if ctx.Err() != nil {
		return false
	}
	conn, err := (&net.Dialer{Timeout: 3 * time.Second}).DialContext(ctx, "udp", serverAddr)
	if err != nil {
		return false
	}
	defer conn.Close()
	stopClose := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stopClose()
	if err := conn.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
		return false
	}

	// STUN Binding Request, 20 bytes: type 0x0001, length 0x0000, cookie 0x2112A442,
	// and twelve random transaction bytes.
	var req [20]byte
	req[0], req[1] = 0x00, 0x01
	req[4], req[5], req[6], req[7] = 0x21, 0x12, 0xA4, 0x42
	if _, err := rand.Read(req[8:20]); err != nil {
		return false
	}

	if _, err := conn.Write(req[:]); err != nil {
		return false
	}

	buf := make([]byte, 256)
	n, err := conn.Read(buf)
	if err != nil || n < 20 {
		return false
	}

	// Binding Success Response type = 0x0101
	return buf[0] == 0x01 && buf[1] == 0x01
}
