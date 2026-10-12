package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"
)

const shutdownBudget = 5 * time.Second

type ownedClose struct {
	name  string
	close func(context.Context) error
}

// Every owner starts closing even if another blocks; success requires all completions.
func shutdownOwned(ctx context.Context, owners []ownedClose) error {
	results := make(chan error, len(owners))
	for _, owner := range owners {
		go func(owner ownedClose) {
			err := owner.close(ctx)
			if err != nil {
				err = fmt.Errorf("%s: %w", owner.name, err)
			}
			results <- err
		}(owner)
	}
	var failures []error
	for range owners {
		select {
		case err := <-results:
			if err != nil {
				failures = append(failures, err)
			}
		case <-ctx.Done():
			return errors.Join(append(failures, ctx.Err())...)
		}
	}
	return errors.Join(failures...)
}

func waitStopped(ctx context.Context, done <-chan struct{}) error {
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func periodicWork(ctx context.Context, interval time.Duration, work func()) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if ctx.Err() != nil {
					return
				}
				work()
			}
		}
	}()
	return done
}

// Serve closes normally after Shutdown; genuine bind/read errors stay actionable.
func reportServeError(name string, err error, failures chan<- error) {
	if err == nil || errors.Is(err, http.ErrServerClosed) {
		return
	}
	select {
	case failures <- fmt.Errorf("%s listener: %w", name, err):
	default:
	}
}

// Called only after all Serve goroutines have finished reporting their result.
func drainServeErrors(failures <-chan error, prior error) error {
	for {
		select {
		case err := <-failures:
			prior = errors.Join(prior, err)
		default:
			return prior
		}
	}
}
