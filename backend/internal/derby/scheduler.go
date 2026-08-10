package derby

import (
	"context"
	"log/slog"
	"time"
)

// Scheduler ticks ProcessDue on an interval until ctx is cancelled.
type Scheduler struct {
	Service  *Service
	Interval time.Duration
	Logger   *slog.Logger
}

func (s *Scheduler) interval() time.Duration {
	if s.Interval > 0 {
		return s.Interval
	}
	return 5 * time.Second
}

func (s *Scheduler) log() *slog.Logger {
	if s.Logger != nil {
		return s.Logger
	}
	return slog.Default()
}

// Run processes due derbies immediately, then on each tick until ctx is cancelled.
func (s *Scheduler) Run(ctx context.Context) {
	if s == nil || s.Service == nil {
		return
	}

	tick := func() {
		now := s.Service.now()
		if err := s.Service.ProcessDue(ctx, now); err != nil {
			if ctx.Err() != nil {
				return
			}
			s.log().Error("derby scheduler tick failed", "error", err)
		}
	}

	tick()

	ticker := time.NewTicker(s.interval())
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			tick()
		}
	}
}
