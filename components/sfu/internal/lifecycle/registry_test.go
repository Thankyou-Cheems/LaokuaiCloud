package lifecycle

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func TestShutdownRegistryClosesOnceAndSealsLateUpgrade(t *testing.T) {
	var registry Registry
	var calls atomic.Int32
	var release func()
	release, _ = registry.Track(func(context.Context) error { calls.Add(1); release(); return nil })
	if err := registry.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := registry.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	release()
	if calls.Load() != 1 {
		t.Fatal("owned connection closed twice")
	}
	if _, accepted := registry.Track(func(context.Context) error { return nil }); accepted {
		t.Fatal("late upgraded connection admitted")
	}
}
func TestShutdownRegistryWaitsForRealHandler(t *testing.T) {
	var registry Registry
	release, _ := registry.Track(func(context.Context) error { return nil })
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if !errors.Is(registry.Shutdown(ctx), context.DeadlineExceeded) {
		t.Fatal("handler cleanup falsely completed")
	}
	release()
	if err := registry.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
}
func TestShutdownRegistryPreservesCloseFailure(t *testing.T) {
	var registry Registry
	failure := errors.New("connection-close-failed")
	var release func()
	release, _ = registry.Track(func(context.Context) error { release(); return failure })
	if err := registry.Shutdown(context.Background()); !errors.Is(err, failure) {
		t.Fatal("close failure hidden")
	}
}
func TestShutdownRegistryEmptyIsIdempotent(t *testing.T) {
	var registry Registry
	for range 2 {
		if err := registry.Shutdown(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
}
