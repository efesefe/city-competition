package db

import (
	"errors"
	"sync"
	"time"
)

// ErrWritePathDegraded is returned when the write-path circuit breaker is open
// (or rejecting further half-open trials). Handlers map this to HTTP 503.
var ErrWritePathDegraded = errors.New("write_path_degraded")

// State is the circuit breaker state exposed to /v1/system/status.
type State string

const (
	StateClosed   State = "closed"
	StateOpen     State = "open"
	StateHalfOpen State = "half_open"
)

// CircuitBreaker trips after consecutive write failures and short-circuits
// further writes during a cooldown, then allows a single half-open trial.
type CircuitBreaker struct {
	threshold int
	cooldown  time.Duration
	now       func() time.Time

	mu            sync.Mutex
	state         State
	failures      int
	openedAt      time.Time
	halfOpenTrial bool
}

// NewCircuitBreaker constructs a breaker. threshold defaults to 5; cooldown to 30s.
func NewCircuitBreaker(threshold int, cooldown time.Duration) *CircuitBreaker {
	if threshold < 1 {
		threshold = 5
	}
	if cooldown <= 0 {
		cooldown = 30 * time.Second
	}
	return &CircuitBreaker{
		threshold: threshold,
		cooldown:  cooldown,
		now:       time.Now,
		state:     StateClosed,
	}
}

// SetClock overrides the time source (tests only).
func (cb *CircuitBreaker) SetClock(now func() time.Time) {
	if cb == nil || now == nil {
		return
	}
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.now = now
}

// Allow returns ErrWritePathDegraded when the breaker is open (before cooldown)
// or when a half-open trial is already in flight.
func (cb *CircuitBreaker) Allow() error {
	if cb == nil {
		return nil
	}
	cb.mu.Lock()
	defer cb.mu.Unlock()

	now := cb.now()
	switch cb.state {
	case StateOpen:
		if now.Sub(cb.openedAt) >= cb.cooldown {
			cb.state = StateHalfOpen
			cb.halfOpenTrial = true
			return nil
		}
		return ErrWritePathDegraded
	case StateHalfOpen:
		if cb.halfOpenTrial {
			return ErrWritePathDegraded
		}
		cb.halfOpenTrial = true
		return nil
	default:
		return nil
	}
}

// RecordSuccess resets the breaker to closed.
func (cb *CircuitBreaker) RecordSuccess() {
	if cb == nil {
		return
	}
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures = 0
	cb.halfOpenTrial = false
	cb.state = StateClosed
}

// RecordFailure increments consecutive failures and opens the breaker at threshold.
func (cb *CircuitBreaker) RecordFailure() {
	if cb == nil {
		return
	}
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.halfOpenTrial = false
	if cb.state == StateHalfOpen {
		cb.state = StateOpen
		cb.openedAt = cb.now()
		cb.failures = cb.threshold
		return
	}

	cb.failures++
	if cb.failures >= cb.threshold {
		cb.state = StateOpen
		cb.openedAt = cb.now()
	}
}

// State returns the current breaker state (advancing open→half_open when cooldown elapsed).
func (cb *CircuitBreaker) State() State {
	if cb == nil {
		return StateClosed
	}
	cb.mu.Lock()
	defer cb.mu.Unlock()

	if cb.state == StateOpen && cb.now().Sub(cb.openedAt) >= cb.cooldown {
		return StateHalfOpen
	}
	return cb.state
}

// Do runs fn if Allow succeeds. On nil error records success; otherwise records failure.
// Callers that need to ignore business errors should use Allow/Record* directly.
func (cb *CircuitBreaker) Do(fn func() error) error {
	if err := cb.Allow(); err != nil {
		return err
	}
	err := fn()
	if err != nil {
		cb.RecordFailure()
		return err
	}
	cb.RecordSuccess()
	return nil
}
