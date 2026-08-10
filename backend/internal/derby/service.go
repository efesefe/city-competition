package derby

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/db"
)

// ProvinceChecker reports whether an il_code exists.
type ProvinceChecker interface {
	Exists(ctx context.Context, ilCode string) (bool, error)
}

// Service orchestrates derby create, reads, activate, and resolve.
type Service struct {
	Store     Store
	Provinces ProvinceChecker
	RDB       redis.Cmdable
	Notifier  *Notifier
	Breaker   *db.CircuitBreaker
	ScoreTTL  time.Duration
	Logger    *slog.Logger
	Now       func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now().UTC()
}

func (s *Service) log() *slog.Logger {
	if s.Logger != nil {
		return s.Logger
	}
	return slog.Default()
}

func (s *Service) scoreTTL() time.Duration {
	if s.ScoreTTL > 0 {
		return s.ScoreTTL
	}
	return 24 * time.Hour
}

// Create validates and inserts a scheduled derby, then announces to members.
func (s *Service) Create(ctx context.Context, in CreateInput) (Derby, error) {
	if in.HostTribeID == uuid.Nil || in.GuestTribeID == uuid.Nil {
		return Derby{}, ErrInvalidInput
	}
	if in.HostTribeID == in.GuestTribeID {
		return Derby{}, ErrSameTribe
	}
	if !in.EndsAt.After(in.StartsAt) {
		return Derby{}, ErrInvalidWindow
	}
	in.IlCode = normalizeIlCode(in.IlCode)
	if in.IlCode == "" {
		return Derby{}, ErrInvalidIlCode
	}

	if err := s.Breaker.Allow(); err != nil {
		return Derby{}, err
	}

	d, err := s.create(ctx, in)
	if err != nil {
		if isDerbyBusinessErr(err) {
			return Derby{}, err
		}
		s.Breaker.RecordFailure()
		return Derby{}, err
	}
	s.Breaker.RecordSuccess()
	return d, nil
}

func (s *Service) create(ctx context.Context, in CreateInput) (Derby, error) {
	if s.Provinces != nil {
		ok, err := s.Provinces.Exists(ctx, in.IlCode)
		if err != nil {
			return Derby{}, err
		}
		if !ok {
			return Derby{}, ErrInvalidIlCode
		}
	}
	if err := s.Store.RequireActiveTribe(ctx, in.HostTribeID); err != nil {
		return Derby{}, err
	}
	if err := s.Store.RequireActiveTribe(ctx, in.GuestTribeID); err != nil {
		return Derby{}, err
	}

	d, err := s.Store.Create(ctx, in)
	if err != nil {
		return Derby{}, err
	}
	if _, err := s.Notifier.EnqueueToMembers(ctx, NotifTypeDerbyAnnounced, d); err != nil {
		s.log().Error("derby announce enqueue failed", "derby_id", d.ID, "error", err)
	}
	return d, nil
}

// Get returns a derby, overlaying live Redis scores when active.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (Derby, error) {
	d, err := s.Store.Get(ctx, id)
	if err != nil {
		return Derby{}, err
	}
	return s.withLiveScores(ctx, d), nil
}

// List returns derbies with live scores for active rows.
func (s *Service) List(ctx context.Context) ([]Derby, error) {
	list, err := s.Store.List(ctx)
	if err != nil {
		return nil, err
	}
	for i := range list {
		list[i] = s.withLiveScores(ctx, list[i])
	}
	return list, nil
}

func (s *Service) withLiveScores(ctx context.Context, d Derby) Derby {
	if d.Status != StatusActive || s.RDB == nil {
		return d
	}
	host, guest, err := GetScores(ctx, s.RDB, d.ID)
	if err != nil {
		s.log().Warn("derby live scores read failed", "derby_id", d.ID, "error", err)
		return d
	}
	d.HostEffectiveTotal = host
	d.GuestEffectiveTotal = guest
	return d
}

// Activate transitions scheduled → active, inits Redis, notifies members.
// Always goes through active even if ends_at already passed.
func (s *Service) Activate(ctx context.Context, d Derby, now time.Time) (Derby, error) {
	if d.Status != StatusScheduled {
		return Derby{}, ErrInvalidStatus
	}
	if !d.EndsAt.After(now) {
		s.log().Warn("derby activating after ends_at already passed",
			"derby_id", d.ID,
			"starts_at", d.StartsAt,
			"ends_at", d.EndsAt,
			"now", now,
		)
	}
	activated, err := s.Store.TransitionToActive(ctx, d.ID)
	if err != nil {
		return Derby{}, err
	}
	if err := InitScores(ctx, s.RDB, activated.ID); err != nil {
		s.log().Error("derby score init failed", "derby_id", activated.ID, "error", err)
	}
	if err := SetCachedActiveByIl(ctx, s.RDB, activated); err != nil {
		s.log().Error("derby by-il cache set failed", "derby_id", activated.ID, "error", err)
	}
	if _, err := s.Notifier.EnqueueToMembers(ctx, NotifTypeDerbyStarted, activated); err != nil {
		s.log().Error("derby started enqueue failed", "derby_id", activated.ID, "error", err)
	}
	return activated, nil
}

// Resolve persists Redis totals into Postgres and expires Redis keys.
func (s *Service) Resolve(ctx context.Context, id uuid.UUID) (Derby, error) {
	host, guest, err := GetScores(ctx, s.RDB, id)
	if err != nil {
		return Derby{}, err
	}
	resolved, err := s.Store.Resolve(ctx, id, host, guest)
	if err != nil {
		return Derby{}, err
	}
	if err := ExpireScores(ctx, s.RDB, id, s.scoreTTL()); err != nil {
		s.log().Error("derby score expire failed", "derby_id", id, "error", err)
	}
	if err := InvalidateActiveByIl(ctx, s.RDB, resolved.IlCode); err != nil {
		s.log().Error("derby by-il cache invalidate failed", "derby_id", id, "error", err)
	}
	return resolved, nil
}

// ForceResolve admin shortcut: resolve from scheduled or active.
func (s *Service) ForceResolve(ctx context.Context, id uuid.UUID) (Derby, error) {
	if err := s.Breaker.Allow(); err != nil {
		return Derby{}, err
	}
	d, err := s.forceResolve(ctx, id)
	if err != nil {
		if isDerbyBusinessErr(err) {
			return Derby{}, err
		}
		s.Breaker.RecordFailure()
		return Derby{}, err
	}
	s.Breaker.RecordSuccess()
	return d, nil
}

func (s *Service) forceResolve(ctx context.Context, id uuid.UUID) (Derby, error) {
	d, err := s.Store.Get(ctx, id)
	if err != nil {
		return Derby{}, err
	}
	if d.Status == StatusResolved {
		return Derby{}, ErrAlreadyResolved
	}
	return s.Resolve(ctx, id)
}

func isDerbyBusinessErr(err error) bool {
	switch {
	case errors.Is(err, ErrSameTribe),
		errors.Is(err, ErrInvalidWindow),
		errors.Is(err, ErrInvalidIlCode),
		errors.Is(err, ErrInvalidInput),
		errors.Is(err, ErrTribeNotFound),
		errors.Is(err, ErrInactiveTribe),
		errors.Is(err, ErrNotFound),
		errors.Is(err, ErrAlreadyResolved),
		errors.Is(err, db.ErrWritePathDegraded):
		return true
	default:
		return false
	}
}

// ProcessDue runs one scheduler pass: activate due derbies, then resolve overdue active ones.
// Never jumps scheduled → resolved without visiting active.
func (s *Service) ProcessDue(ctx context.Context, now time.Time) error {
	dueActivate, err := s.Store.ListDueToActivate(ctx, now)
	if err != nil {
		return fmt.Errorf("list due activate: %w", err)
	}
	for _, d := range dueActivate {
		activated, err := s.Activate(ctx, d, now)
		if err != nil {
			s.log().Error("derby activate failed", "derby_id", d.ID, "error", err)
			continue
		}
		// Same pass: if already past ends_at, resolve after the brief active visit.
		if !activated.EndsAt.After(now) {
			if _, err := s.Resolve(ctx, activated.ID); err != nil {
				s.log().Error("derby resolve after overdue activate failed", "derby_id", activated.ID, "error", err)
			}
		}
	}

	dueResolve, err := s.Store.ListDueToResolve(ctx, now)
	if err != nil {
		return fmt.Errorf("list due resolve: %w", err)
	}
	for _, d := range dueResolve {
		if _, err := s.Resolve(ctx, d.ID); err != nil {
			s.log().Error("derby resolve failed", "derby_id", d.ID, "error", err)
		}
	}
	return nil
}

func normalizeIlCode(raw string) string {
	raw = strings.TrimSpace(raw)
	if len(raw) == 1 && raw[0] >= '1' && raw[0] <= '9' {
		return "0" + raw
	}
	if len(raw) == 2 && raw[0] >= '0' && raw[0] <= '9' && raw[1] >= '0' && raw[1] <= '9' {
		return raw
	}
	return raw
}
