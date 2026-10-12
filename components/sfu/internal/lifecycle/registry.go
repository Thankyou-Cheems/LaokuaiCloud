// Package lifecycle owns connection shutdown without changing admission contracts.
package lifecycle

import (
	"context"
	"errors"
	"sync"
)

type entry struct {
	close   func(context.Context) error
	release sync.Once
}

// Registry seals before waiting: a late upgraded connection cannot race WaitGroup.Add.
type Registry struct {
	mu       sync.Mutex
	entries  map[*entry]struct{}
	stopping bool
	handlers sync.WaitGroup
	once     sync.Once
	done     chan struct{}
	err      error
}

func (r *Registry) Track(close func(context.Context) error) (func(), bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.stopping {
		return nil, false
	}
	if r.entries == nil {
		r.entries = make(map[*entry]struct{})
	}
	e := &entry{close: close}
	r.entries[e] = struct{}{}
	r.handlers.Add(1)
	return func() { e.release.Do(func() { r.mu.Lock(); delete(r.entries, e); r.mu.Unlock(); r.handlers.Done() }) }, true
}

func (r *Registry) Stopping() bool { r.mu.Lock(); defer r.mu.Unlock(); return r.stopping }

// Shutdown closes each owned connection once and waits for its real handler cleanup.
func (r *Registry) Shutdown(ctx context.Context) error {
	r.once.Do(func() {
		r.mu.Lock()
		r.stopping = true
		r.done = make(chan struct{})
		entries := make([]*entry, 0, len(r.entries))
		for e := range r.entries {
			entries = append(entries, e)
		}
		r.mu.Unlock()
		go func() {
			results := make(chan error, len(entries))
			for _, e := range entries {
				go func(e *entry) { results <- e.close(ctx) }(e)
			}
			var failures []error
			for range entries {
				if err := <-results; err != nil {
					failures = append(failures, err)
				}
			}
			r.handlers.Wait()
			r.err = errors.Join(failures...)
			close(r.done)
		}()
	})
	select {
	case <-r.done:
		return r.err
	case <-ctx.Done():
		return ctx.Err()
	}
}
