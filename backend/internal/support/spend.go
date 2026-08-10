package support

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/cache"
	"github.com/city-competition-remastered/backend/internal/credits"
	"github.com/city-competition-remastered/backend/internal/db"
	"github.com/city-competition-remastered/backend/internal/derby"
	"github.com/city-competition-remastered/backend/internal/engagement"
)

var (
	// ErrTribeRequired is returned when the user has no tribe_id.
	ErrTribeRequired = errors.New("tribe_required")
	// ErrInvalidIlCode is returned when il_code is missing from admin_boundaries.
	ErrInvalidIlCode = errors.New("invalid_il_code")
	// ErrInvalidCredits is returned when credits is not strictly positive.
	ErrInvalidCredits = errors.New("invalid_credits")
)

// ProvinceChecker validates that an il_code exists.
type ProvinceChecker interface {
	Exists(ctx context.Context, ilCode string) (bool, error)
}

// Service applies province support spends atomically.
type Service struct {
	Pool         *pgxpool.Pool
	Wallet       *credits.Wallet
	Provinces    ProvinceChecker
	RDB          redis.Cmdable
	Cache        *ControlCache
	Engagement   *engagement.Hooks
	Breaker      *db.CircuitBreaker
	MultiplierFn MultiplierFn
	Now          func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now().UTC()
}

// Result is returned after a successful support spend.
type Result struct {
	SupportID        uuid.UUID `json:"support_id"`
	IlCode           string    `json:"il_code"`
	CreditsSpent     int64     `json:"credits_spent"`
	Multiplier       float64   `json:"multiplier"`
	EffectiveSupport float64   `json:"effective_support"`
	TribeID          uuid.UUID `json:"tribe_id"`
	BalanceAfter     int64     `json:"balance_after"`
}

type supportAppliedEvent struct {
	TribeID uuid.UUID `json:"tribe_id"`
	Delta   float64   `json:"delta"`
}

// Apply spends credits for the user's tribe in il_code inside one DB transaction,
// then publishes a Redis Pub/Sub event for the live map layer.
func (s *Service) Apply(ctx context.Context, userID uuid.UUID, ilCode string, creditsSpent int64) (*Result, error) {
	if creditsSpent <= 0 {
		return nil, ErrInvalidCredits
	}
	ilCode = normalizeIlCode(ilCode)
	if ilCode == "" {
		return nil, ErrInvalidIlCode
	}

	if err := s.Breaker.Allow(); err != nil {
		return nil, err
	}

	result, err := s.apply(ctx, userID, ilCode, creditsSpent)
	if err != nil {
		if isSupportBusinessErr(err) {
			return nil, err
		}
		s.Breaker.RecordFailure()
		return nil, err
	}
	s.Breaker.RecordSuccess()
	return result, nil
}

func (s *Service) apply(ctx context.Context, userID uuid.UUID, ilCode string, creditsSpent int64) (*Result, error) {
	ok, err := s.Provinces.Exists(ctx, ilCode)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrInvalidIlCode
	}

	var tribeID *uuid.UUID
	if err := s.Pool.QueryRow(ctx, `
		SELECT tribe_id FROM users WHERE id = $1
	`, userID).Scan(&tribeID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrTribeRequired
		}
		return nil, fmt.Errorf("load user tribe: %w", err)
	}
	if tribeID == nil {
		return nil, ErrTribeRequired
	}

	now := s.now()
	multiplier := 1.0
	var derbyID *uuid.UUID
	var derbySide string
	if s.MultiplierFn != nil {
		multiplier, derbyID, derbySide = s.MultiplierFn(ctx, userID, *tribeID, ilCode, now)
	}
	effective := float64(creditsSpent) * multiplier
	supportID := uuid.New()

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	balanceAfter, err := s.Wallet.SpendCreditsOnTx(ctx, tx, credits.ApplyInput{
		UserID:         userID,
		Amount:         creditsSpent,
		Reason:         credits.ReasonSupportSpend,
		RefType:        "support",
		RefID:          supportID.String(),
		IdempotencyKey: "support:" + supportID.String(),
	})
	if err != nil {
		return nil, err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO supports (
			id, user_id, tribe_id, il_code, credits_spent, multiplier, effective_support, derby_id, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, supportID, userID, *tribeID, ilCode, creditsSpent, multiplier, effective, derbyID, now)
	if err != nil {
		return nil, fmt.Errorf("insert support: %w", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO tribe_province_scores (tribe_id, il_code, effective_support_sum)
		VALUES ($1, $2, $3)
		ON CONFLICT (tribe_id, il_code) DO UPDATE SET
			effective_support_sum = tribe_province_scores.effective_support_sum + EXCLUDED.effective_support_sum
	`, *tribeID, ilCode, effective)
	if err != nil {
		return nil, fmt.Errorf("upsert tribe_province_scores: %w", err)
	}

	if err := s.Engagement.UpsertStreak(ctx, tx, userID, now); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	if s.Cache != nil {
		// Push-based invalidation so the next control read cannot see a stale snapshot.
		_ = s.Cache.Invalidate(ctx, ilCode)
	}

	if s.RDB != nil {
		payload, _ := json.Marshal(supportAppliedEvent{
			TribeID: *tribeID,
			Delta:   effective,
		})
		channel := fmt.Sprintf("support_applied:%s", ilCode)
		if err := cache.Publish(ctx, s.RDB, channel, string(payload)); err != nil {
			// Spend already committed; log via caller if needed — do not fail the request.
			_ = err
		}
		if derbyID != nil && (derbySide == "host" || derbySide == "guest") {
			// Best-effort derby score update; spend already committed.
			_ = derby.IncrScore(ctx, s.RDB, *derbyID, derbySide, effective)
		}
	}

	// Best-effort retention alert; never fail the successful spend.
	_, _ = s.Engagement.MaybeLeadThreatened(ctx, ilCode, *tribeID, effective)

	return &Result{
		SupportID:        supportID,
		IlCode:           ilCode,
		CreditsSpent:     creditsSpent,
		Multiplier:       multiplier,
		EffectiveSupport: effective,
		TribeID:          *tribeID,
		BalanceAfter:     balanceAfter,
	}, nil
}

func isSupportBusinessErr(err error) bool {
	switch {
	case errors.Is(err, ErrTribeRequired),
		errors.Is(err, ErrInvalidIlCode),
		errors.Is(err, ErrInvalidCredits),
		errors.Is(err, credits.ErrInsufficientCredits),
		errors.Is(err, credits.ErrIdempotencyConflict),
		errors.Is(err, credits.ErrInvalidAmount),
		errors.Is(err, credits.ErrInvalidIdempotencyKey),
		errors.Is(err, db.ErrWritePathDegraded):
		return true
	default:
		return false
	}
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
