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
	"github.com/city-competition-remastered/backend/internal/conquest"
	"github.com/city-competition-remastered/backend/internal/credits"
	"github.com/city-competition-remastered/backend/internal/db"
	"github.com/city-competition-remastered/backend/internal/derby"
	"github.com/city-competition-remastered/backend/internal/engagement"
	"github.com/city-competition-remastered/backend/internal/moderation"
	"github.com/city-competition-remastered/backend/internal/share"
)

var (
	// ErrTribeRequired is returned when the user has no tribe_id.
	ErrTribeRequired = errors.New("tribe_required")
	// ErrInvalidIlCode is returned when il_code is missing from admin_boundaries.
	ErrInvalidIlCode = errors.New("invalid_il_code")
	// ErrUnknownRegion is returned by POST /v1/region/{il_code}/support when the
	// path il_code is not among the fixed 81-city set (admin_boundaries).
	ErrUnknownRegion = errors.New("unknown_region")
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
	Achievements *share.Store
	Breaker      *db.CircuitBreaker
	MultiplierFn MultiplierFn
	Now          func() time.Time
	// OnSupportApplied is invoked after a successful spend + Pub/Sub publish (best-effort).
	// Leaderboard ZSET updates subscribe here — do not put ZINCRBY in this package.
	OnSupportApplied func(ctx context.Context, ev SupportAppliedEvent)
	// OnStreakUpdated is invoked after a successful spend with the streak snapshot (best-effort).
	OnStreakUpdated func(ctx context.Context, ev StreakUpdatedEvent)
	// RecordFlip inserts a conquest_log row on the spend transaction when leadership
	// changes. Production wires conquest.Store.InsertOnTx. Nil skips durable logging
	// (existing tests that do not care about the log). A non-nil error rolls back the
	// entire spend — a flip that is not logged is a data-integrity bug.
	RecordFlip func(ctx context.Context, tx pgx.Tx, rec conquest.Entry) error
	// AttributeFlip tags the in-window supports for a logged flip and records the
	// causing support id. Production wires conquest.Store.AttributeSupportsOnTx.
	// Nil skips attribution (tests that only care about the log row). A non-nil
	// error rolls back the entire spend, same integrity rule as RecordFlip.
	AttributeFlip func(ctx context.Context, tx pgx.Tx, rec conquest.Attribution) error
	// SpendAnomaly is invoked after a real (non-inert) support commit (best-effort).
	SpendAnomaly *moderation.SpendAnomalyDetector
}

// StreakUpdatedEvent is passed to OnStreakUpdated after support spend commits.
type StreakUpdatedEvent struct {
	UserID         uuid.UUID `json:"user_id"`
	CurrentStreak  int       `json:"current_streak"`
	LongestStreak  int       `json:"longest_streak"`
	PreviousStreak int       `json:"previous_streak"`
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

// SupportAppliedEvent is published on support_applied:{il_code} and passed to OnSupportApplied.
// Extra fields beyond tribe_id/delta are ignored by the map hub.
type SupportAppliedEvent struct {
	UserID  uuid.UUID  `json:"user_id"`
	TribeID uuid.UUID  `json:"tribe_id"`
	IlCode  string     `json:"il_code"`
	Delta   float64    `json:"delta"`
	DerbyID *uuid.UUID `json:"derby_id,omitempty"`
}

// RegionSupportedEvent is published on region_supported:{il_code} after a committed
// ownership flip. The realtime hub fans this out app-wide (not viewport-filtered).
type RegionSupportedEvent struct {
	ID                      uuid.UUID  `json:"id"`
	IlCode                  string     `json:"il_code"`
	CityName                string     `json:"city_name"`
	PreviousTribeID         *uuid.UUID `json:"previous_tribe_id"`
	NewTribeID              uuid.UUID  `json:"new_tribe_id"`
	WinningCommittedCredits float64    `json:"winning_committed_credits"`
	OccurredAt              time.Time  `json:"occurred_at"`
	WasDerbiBonus           bool       `json:"was_derbi_bonus"`
}

// RegionSupportedChannel is the Redis Pub/Sub channel for a city ownership flip.
func RegionSupportedChannel(ilCode string) string {
	return "region_supported:" + ilCode
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
	var userStatus string
	if err := s.Pool.QueryRow(ctx, `
		SELECT tribe_id, status FROM users WHERE id = $1
	`, userID).Scan(&tribeID, &userStatus); err != nil {
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

	// Shadow-ban inert path (08.4): success-shaped response, no ledger debit,
	// no supports row, no tribe_province_scores / leaderboard / pubsub side effects.
	if userStatus == moderation.StatusShadowBanned {
		balanceAfter, err := s.Wallet.GetBalance(ctx, userID)
		if err != nil {
			return nil, err
		}
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

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	// Serialize concurrent spends on this city, including first-ever capture
	// (no tribe_province_scores rows exist yet to lock).
	var cityName string
	if err := tx.QueryRow(ctx, `
		SELECT name_tr FROM admin_boundaries WHERE il_code = $1 FOR UPDATE
	`, ilCode).Scan(&cityName); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidIlCode
		}
		return nil, fmt.Errorf("lock city: %w", err)
	}
	// Stamp times after the lock so concurrent flips order by occurred_at
	// in commit order rather than lock-wait start time.
	now = s.now()

	prevLeader, _, err := loadProvinceLeader(ctx, tx, ilCode)
	if err != nil {
		return nil, err
	}

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

	prevStreak, streak, err := s.Engagement.UpsertStreak(ctx, tx, userID, now)
	if err != nil {
		return nil, err
	}

	newLeader, newSum, err := loadProvinceLeader(ctx, tx, ilCode)
	if err != nil {
		return nil, err
	}

	var flip *conquest.Entry
	if s.RecordFlip != nil && leaderChanged(prevLeader, newLeader) {
		entry := conquest.Entry{
			ID:                      uuid.New(),
			IlCode:                  ilCode,
			CityName:                cityName,
			PreviousTribeID:         prevLeader,
			NewTribeID:              *newLeader,
			WinningCommittedCredits: newSum,
			OccurredAt:              now,
			WasDerbiBonus:           derbyID != nil,
		}
		if err := s.RecordFlip(ctx, tx, entry); err != nil {
			return nil, fmt.Errorf("insert conquest_log: %w", err)
		}
		if s.AttributeFlip != nil {
			if err := s.AttributeFlip(ctx, tx, conquest.Attribution{
				LogID:            entry.ID,
				IlCode:           ilCode,
				WinningTribeID:   *newLeader,
				CausingSupportID: supportID,
				OccurredAt:       now,
			}); err != nil {
				return nil, fmt.Errorf("attribute conquest flip: %w", err)
			}
		}
		flip = &entry
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	if s.Cache != nil {
		// Push-based invalidation so the next control read cannot see a stale snapshot.
		_ = s.Cache.Invalidate(ctx, ilCode)
	}

	ev := SupportAppliedEvent{
		UserID:  userID,
		TribeID: *tribeID,
		IlCode:  ilCode,
		Delta:   effective,
	}
	if derbyID != nil {
		ev.DerbyID = derbyID
	}

	if s.RDB != nil {
		payload, _ := json.Marshal(ev)
		channel := fmt.Sprintf("support_applied:%s", ilCode)
		if err := cache.Publish(ctx, s.RDB, channel, string(payload)); err != nil {
			// Spend already committed; log via caller if needed — do not fail the request.
			_ = err
		}
		if derbyID != nil && (derbySide == "host" || derbySide == "guest") {
			// Best-effort derby score update; spend already committed.
			_ = derby.IncrScore(ctx, s.RDB, *derbyID, derbySide, effective)
		}
		if flip != nil {
			regionEv := RegionSupportedEvent{
				ID:                      flip.ID,
				IlCode:                  flip.IlCode,
				CityName:                flip.CityName,
				PreviousTribeID:         flip.PreviousTribeID,
				NewTribeID:              flip.NewTribeID,
				WinningCommittedCredits: flip.WinningCommittedCredits,
				OccurredAt:              flip.OccurredAt,
				WasDerbiBonus:           flip.WasDerbiBonus,
			}
			regionPayload, _ := json.Marshal(regionEv)
			if err := cache.Publish(ctx, s.RDB, RegionSupportedChannel(ilCode), string(regionPayload)); err != nil {
				_ = err
			}
		}
	}

	if s.OnSupportApplied != nil {
		s.OnSupportApplied(ctx, ev)
	}
	if s.OnStreakUpdated != nil {
		s.OnStreakUpdated(ctx, StreakUpdatedEvent{
			UserID:         userID,
			CurrentStreak:  streak.CurrentStreak,
			LongestStreak:  streak.LongestStreak,
			PreviousStreak: prevStreak.CurrentStreak,
		})
	}

	// Best-effort retention alert; never fail the successful spend.
	_, _ = s.Engagement.MaybeLeadThreatened(ctx, ilCode, *tribeID, effective)
	_ = share.MaybeFirstSupport(ctx, s.Achievements, userID, ilCode)
	_ = share.MaybeStreakAchievements(ctx, s.Achievements, userID, streak.CurrentStreak, nil)
	if s.SpendAnomaly != nil {
		_ = s.SpendAnomaly.CheckAfterSupport(ctx, userID)
	}

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

// loadProvinceLeader returns the controlling tribe for il_code using the same
// ranking as GET /v1/cities: highest effective_support_sum, tribe_id ASC tie-break.
func loadProvinceLeader(ctx context.Context, tx pgx.Tx, ilCode string) (*uuid.UUID, float64, error) {
	var id uuid.UUID
	var sum float64
	err := tx.QueryRow(ctx, `
		SELECT tribe_id, effective_support_sum::float8
		FROM tribe_province_scores
		WHERE il_code = $1 AND effective_support_sum > 0
		ORDER BY effective_support_sum DESC, tribe_id ASC
		LIMIT 1
	`, ilCode).Scan(&id, &sum)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, 0, nil
	}
	if err != nil {
		return nil, 0, fmt.Errorf("load province leader: %w", err)
	}
	return &id, sum, nil
}

func leaderChanged(prev, next *uuid.UUID) bool {
	if next == nil {
		return false
	}
	if prev == nil {
		return true
	}
	return *prev != *next
}
