package main

import (
	"context"
	"errors"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

func TestShutdownAllOwnersRunWhenOneFails(t *testing.T) {
	var calls atomic.Int32
	failure := errors.New("close-failed")
	owners := []ownedClose{{"one", func(context.Context) error { calls.Add(1); return failure }}, {"two", func(context.Context) error { calls.Add(1); return nil }}}
	if err := shutdownOwned(context.Background(), owners); !errors.Is(err, failure) {
		t.Fatalf("close failure hidden: %v", err)
	}
	if calls.Load() != 2 {
		t.Fatal("another owner was skipped")
	}
}
func TestShutdownDeadlineDoesNotPretendSuccess(t *testing.T) {
	blocked := make(chan struct{})
	defer close(blocked)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	var other atomic.Bool
	err := shutdownOwned(ctx, []ownedClose{{"blocked", func(context.Context) error { <-blocked; return nil }}, {"other", func(context.Context) error { other.Store(true); return nil }}})
	if !errors.Is(err, context.DeadlineExceeded) || !other.Load() {
		t.Fatalf("deadline/other owner: %v", err)
	}
}
func TestShutdownServeClosedExpectedButBindFailureRetained(t *testing.T) {
	failures := make(chan error, 2)
	reportServeError("control", http.ErrServerClosed, failures)
	if len(failures) != 0 {
		t.Fatal("normal shutdown became listener failure")
	}
	bind := errors.New("bind-failed")
	reportServeError("public", bind, failures)
	if !errors.Is(<-failures, bind) {
		t.Fatal("real bind failure hidden")
	}
}
func TestShutdownCanceledPeriodicWorkerEndsWithoutWork(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var calls atomic.Int32
	done := periodicWork(ctx, time.Hour, func() { calls.Add(1) })
	if err := waitStopped(context.Background(), done); err != nil || calls.Load() != 0 {
		t.Fatal("canceled worker still ran")
	}
}
func TestShutdownWaitUsesDeadline(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if !errors.Is(waitStopped(ctx, make(chan struct{})), context.Canceled) {
		t.Fatal("wait ignored cancel")
	}
}

func TestShutdownRetainsServeFailureRacingSignal(t *testing.T) {
	first, second := errors.New("control-bind"), errors.New("public-bind")
	failures := make(chan error, 2)
	failures <- second
	err := drainServeErrors(failures, first)
	if !errors.Is(err, first) || !errors.Is(err, second) {
		t.Fatal("signal race hid listener failure")
	}
	if len(failures) != 0 {
		t.Fatal("reported failure not consumed")
	}
}
