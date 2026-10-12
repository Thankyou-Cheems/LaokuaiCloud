package readiness

import (
	"context"
	"testing"
	"time"
)

func TestShutdownReadinessCanceledBeforeDial(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if sendSTUNBindingContext(ctx, "must-not-resolve.invalid:3478") {
		t.Fatal("canceled probe succeeded")
	}
	done := VerifyUDPContext(ctx, []string{"stun:must-not-resolve.invalid:3478"}, false)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("canceled readiness did not finish")
	}
}
func TestShutdownReadinessDisabledCompletes(t *testing.T) {
	done := VerifyUDPContext(context.Background(), nil, true)
	select {
	case <-done:
	default:
		t.Fatal("disabled readiness did not complete")
	}
}
