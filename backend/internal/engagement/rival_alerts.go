package engagement

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/cache"
	"github.com/city-competition-remastered/backend/internal/logging"
)

const (
	NotifTypeProvinceLeadThreatened = "province_lead_threatened"
	defaultGapRatio                 = 0.10
	defaultRateLimit                = 30 * time.Minute
)

// TribeScore is one tribe's effective support sum in an il.
type TribeScore struct {
	TribeID uuid.UUID
	Sum     float64
}

// LeadThreatenedPayload is enqueued to notif_queue for the push worker.
type LeadThreatenedPayload struct {
	Type      string    `json:"type"`
	UserID    uuid.UUID `json:"user_id"`
	IlCode    string    `json:"il_code"`
	TribeID   uuid.UUID `json:"tribe_id"`
	RequestID string    `json:"request_id,omitempty"`
}

// GapRatio returns (leader - second) / leader, or a large value when there is no valid pair.
func GapRatio(leaderSum, secondSum float64) float64 {
	if leaderSum <= 0 || secondSum < 0 || secondSum >= leaderSum {
		return 1e18
	}
	return (leaderSum - secondSum) / leaderSum
}

// LeadThreatenedCrossing reports whether post-support scores newly enter the
// threatened band (pre gap > threshold, post gap <= threshold) while the lead holds.
func LeadThreatenedCrossing(pre, post []TribeScore, threshold float64) (leaderID uuid.UUID, crossed bool) {
	if threshold <= 0 || threshold >= 1 {
		threshold = defaultGapRatio
	}
	preSorted := rankScores(pre)
	postSorted := rankScores(post)
	if len(preSorted) < 2 || len(postSorted) < 2 {
		return uuid.Nil, false
	}

	preGap := GapRatio(preSorted[0].Sum, preSorted[1].Sum)
	postGap := GapRatio(postSorted[0].Sum, postSorted[1].Sum)
	if postSorted[0].Sum <= postSorted[1].Sum || postSorted[1].Sum <= 0 {
		return uuid.Nil, false
	}
	if !(preGap > threshold && postGap <= threshold) {
		return uuid.Nil, false
	}
	return postSorted[0].TribeID, true
}

// ReconstructPreScores subtracts delta from supportingTribe to recover pre-spend sums.
func ReconstructPreScores(post []TribeScore, supportingTribe uuid.UUID, delta float64) []TribeScore {
	out := make([]TribeScore, len(post))
	copy(out, post)
	for i := range out {
		if out[i].TribeID == supportingTribe {
			out[i].Sum -= delta
			if out[i].Sum < 0 {
				out[i].Sum = 0
			}
			break
		}
	}
	return out
}

func rankScores(scores []TribeScore) []TribeScore {
	out := make([]TribeScore, 0, len(scores))
	for _, s := range scores {
		if s.Sum > 0 {
			out = append(out, s)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Sum == out[j].Sum {
			return out[i].TribeID.String() < out[j].TribeID.String()
		}
		return out[i].Sum > out[j].Sum
	})
	return out
}

// RivalAlerter detects lead-threatened crossings and enqueues rate-limited notifs.
type RivalAlerter struct {
	Pool      *pgxpool.Pool
	RDB       redis.Cmdable
	GapRatio  float64
	RateLimit time.Duration
	// Inbox optionally dual-writes an in-app notification for each enqueued push.
	Inbox func(ctx context.Context, userID uuid.UUID, notifType, title, body string, payload any) error
}

func (a *RivalAlerter) gapRatio() float64 {
	if a == nil || a.GapRatio <= 0 || a.GapRatio >= 1 {
		return defaultGapRatio
	}
	return a.GapRatio
}

func (a *RivalAlerter) rateLimit() time.Duration {
	if a == nil || a.RateLimit <= 0 {
		return defaultRateLimit
	}
	return a.RateLimit
}

// DetectAndEnqueue loads post-spend scores, detects a gap crossing, and enqueues
// one notif per leading-tribe member (max 1 per user per il per rate window).
// Best-effort: errors are returned for logging but callers should not fail the spend.
func (a *RivalAlerter) DetectAndEnqueue(
	ctx context.Context,
	ilCode string,
	supportingTribe uuid.UUID,
	effectiveDelta float64,
) (enqueued int, err error) {
	if a == nil || a.Pool == nil || a.RDB == nil || effectiveDelta == 0 {
		return 0, nil
	}

	post, err := a.loadScores(ctx, ilCode)
	if err != nil {
		return 0, err
	}
	pre := ReconstructPreScores(post, supportingTribe, effectiveDelta)
	leaderID, crossed := LeadThreatenedCrossing(pre, post, a.gapRatio())
	if !crossed {
		return 0, nil
	}

	members, err := a.loadTribeMembers(ctx, leaderID)
	if err != nil {
		return 0, err
	}

	for _, userID := range members {
		ok, err := a.tryRateLimit(ctx, userID, ilCode)
		if err != nil {
			return enqueued, err
		}
		if !ok {
			continue
		}
		reqID, _ := logging.RequestIDFromContext(ctx)
		payload := LeadThreatenedPayload{
			Type:      NotifTypeProvinceLeadThreatened,
			UserID:    userID,
			IlCode:    ilCode,
			TribeID:   leaderID,
			RequestID: reqID,
		}
		raw, _ := json.Marshal(payload)
		if err := cache.EnqueueNotif(ctx, a.RDB, string(raw)); err != nil {
			return enqueued, fmt.Errorf("enqueue notif: %w", err)
		}
		if a.Inbox != nil {
			title := "Liderlik tehdit altında"
			body := fmt.Sprintf("%s ilindeki liderliğiniz tehdit altında.", ilCode)
			_ = a.Inbox(ctx, userID, NotifTypeProvinceLeadThreatened, title, body, payload)
		}
		enqueued++
	}
	return enqueued, nil
}

func (a *RivalAlerter) loadScores(ctx context.Context, ilCode string) ([]TribeScore, error) {
	rows, err := a.Pool.Query(ctx, `
		SELECT tribe_id, effective_support_sum::float8
		FROM tribe_province_scores
		WHERE il_code = $1
		ORDER BY effective_support_sum DESC, tribe_id ASC
	`, ilCode)
	if err != nil {
		return nil, fmt.Errorf("load tribe scores: %w", err)
	}
	defer rows.Close()

	var out []TribeScore
	for rows.Next() {
		var s TribeScore
		if err := rows.Scan(&s.TribeID, &s.Sum); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (a *RivalAlerter) loadTribeMembers(ctx context.Context, tribeID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := a.Pool.Query(ctx, `
		SELECT id FROM users WHERE tribe_id = $1
	`, tribeID)
	if err != nil {
		return nil, fmt.Errorf("load tribe members: %w", err)
	}
	defer rows.Close()

	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (a *RivalAlerter) tryRateLimit(ctx context.Context, userID uuid.UUID, ilCode string) (bool, error) {
	key := fmt.Sprintf("notif_rl:%s:%s:%s", NotifTypeProvinceLeadThreatened, userID.String(), ilCode)
	return a.RDB.SetNX(ctx, key, "1", a.rateLimit()).Result()
}

// Hooks bundles engagement side-effects for the support spend path.
type Hooks struct {
	Streaks *StreakStore
	Rivals  *RivalAlerter
}

// UpsertStreak updates the support streak inside tx. Nil-safe.
// Returns previous and next streak states (zeros when hooks are unset).
func (h *Hooks) UpsertStreak(ctx context.Context, tx pgx.Tx, userID uuid.UUID, now time.Time) (StreakState, StreakState, error) {
	if h == nil || h.Streaks == nil {
		return StreakState{}, StreakState{}, nil
	}
	return h.Streaks.UpsertOnSupport(ctx, tx, userID, now)
}

// MaybeLeadThreatened runs the rival-alert detector. Nil-safe; never required for spend success.
func (h *Hooks) MaybeLeadThreatened(
	ctx context.Context,
	ilCode string,
	supportingTribe uuid.UUID,
	effectiveDelta float64,
) (int, error) {
	if h == nil || h.Rivals == nil {
		return 0, nil
	}
	return h.Rivals.DetectAndEnqueue(ctx, ilCode, supportingTribe, effectiveDelta)
}
