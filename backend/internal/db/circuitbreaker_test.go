package db_test

import (
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/city-competition-remastered/backend/internal/db"
)

func TestCircuitBreaker_FiveFailuresTrip_SixthShortCircuits(t *testing.T) {
	cb := db.NewCircuitBreaker(5, 30*time.Second)
	var calls atomic.Int32
	fail := errors.New("db down")

	for i := 0; i < 5; i++ {
		err := cb.Do(func() error {
			calls.Add(1)
			return fail
		})
		if !errors.Is(err, fail) {
			t.Fatalf("call %d: err=%v want %v", i+1, err, fail)
		}
	}
	if got := calls.Load(); got != 5 {
		t.Fatalf("calls=%d want 5", got)
	}
	if cb.State() != db.StateOpen {
		t.Fatalf("state=%s want open", cb.State())
	}

	err := cb.Do(func() error {
		calls.Add(1)
		return nil
	})
	if !errors.Is(err, db.ErrWritePathDegraded) {
		t.Fatalf("6th err=%v want write_path_degraded", err)
	}
	if got := calls.Load(); got != 5 {
		t.Fatalf("6th must short-circuit without DB; calls=%d want 5", got)
	}
}

func TestCircuitBreaker_HalfOpenAfterCooldownAllowsTrial(t *testing.T) {
	cb := db.NewCircuitBreaker(5, 30*time.Second)
	now := time.Unix(1_700_000_000, 0).UTC()
	cb.SetClock(func() time.Time { return now })

	fail := errors.New("db down")
	for i := 0; i < 5; i++ {
		_ = cb.Do(func() error { return fail })
	}
	if cb.State() != db.StateOpen {
		t.Fatalf("state=%s want open", cb.State())
	}

	now = now.Add(30 * time.Second)
	var trialCalls atomic.Int32

	err := cb.Do(func() error {
		trialCalls.Add(1)
		return nil
	})
	if err != nil {
		t.Fatalf("half-open trial err=%v want nil", err)
	}
	if trialCalls.Load() != 1 {
		t.Fatalf("trialCalls=%d want 1", trialCalls.Load())
	}
	if cb.State() != db.StateClosed {
		t.Fatalf("after success state=%s want closed", cb.State())
	}

	// Re-open and verify failed trial returns to open.
	for i := 0; i < 5; i++ {
		_ = cb.Do(func() error { return fail })
	}
	now = now.Add(30 * time.Second)
	err = cb.Do(func() error {
		trialCalls.Add(1)
		return fail
	})
	if !errors.Is(err, fail) {
		t.Fatalf("failed trial err=%v want %v", err, fail)
	}
	if cb.State() != db.StateOpen {
		t.Fatalf("after failed trial state=%s want open", cb.State())
	}

	// While open (before next cooldown), further calls short-circuit.
	err = cb.Allow()
	if !errors.Is(err, db.ErrWritePathDegraded) {
		t.Fatalf("still open Allow err=%v want write_path_degraded", err)
	}
}

func TestResolveReadDSN_FallsBackToPrimary(t *testing.T) {
	primary := "postgres://primary/db"
	if got := db.ResolveReadDSN(primary, ""); got != primary {
		t.Fatalf("got %q want primary %q", got, primary)
	}
	replica := "postgres://replica/db"
	if got := db.ResolveReadDSN(primary, replica); got != replica {
		t.Fatalf("got %q want replica %q", got, replica)
	}
}
