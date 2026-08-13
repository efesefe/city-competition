package conquest

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/cache"
	"github.com/city-competition-remastered/backend/internal/logging"
	"github.com/city-competition-remastered/backend/internal/notifications"
)

const (
	// NotifTypeRivalThreat is enqueued to notif_queue when contest_tension
	// crosses a configured alert level toward a flip.
	NotifTypeRivalThreat = "rival_threat"

	defaultThreatLow        = 0.70
	defaultThreatHigh       = 0.90
	defaultThreatCooldown   = 10 * time.Minute
	threatCooldownKeyPrefix = "threat_alert:"
)

// ThreatAlertPayload is enqueued to notif_queue for the push worker.
type ThreatAlertPayload struct {
	Type           string    `json:"type"`
	UserID         uuid.UUID `json:"user_id"`
	IlCode         string    `json:"il_code"`
	CityName       string    `json:"city_name"`
	TribeID        uuid.UUID `json:"tribe_id"`
	ContestTension float64   `json:"contest_tension"`
	TensionPercent int       `json:"tension_percent"`
	Level          int       `json:"level"`
	DeepLink       string    `json:"deep_link"`
	RequestID      string    `json:"request_id,omitempty"`
}

// ThreatAlerter detects contest-tension threshold crossings and enqueues
// rate-limited notifs to the currently-controlling tribe.
type ThreatAlerter struct {
	Pool       *pgxpool.Pool
	RDB        redis.Cmdable
	Thresholds []float64
	Cooldown   time.Duration
	// Inbox optionally dual-writes an in-app notification for each enqueued push.
	Inbox func(ctx context.Context, userID uuid.UUID, notifType, title, body string, payload any) error
}

type tribeScore struct {
	TribeID uuid.UUID
	Sum     float64
}

// TensionLevelCrossings returns thresholds that post newly meets after an
// upward tension move (pre < threshold && post >= threshold). Downward or
// unchanged tension returns nil.
func TensionLevelCrossings(pre, post float64, thresholds []float64) []float64 {
	if post <= pre {
		return nil
	}
	var out []float64
	for _, th := range thresholds {
		if th <= 0 {
			continue
		}
		if pre < th && post >= th {
			out = append(out, th)
		}
	}
	return out
}

// ThreatCooldownKey is the Redis SETNX key for one city + alert level.
func ThreatCooldownKey(ilCode string, level int) string {
	return fmt.Sprintf("%s%s:%d", threatCooldownKeyPrefix, ilCode, level)
}

// CitySupportDeepLink opens the map on the city's support sheet.
func CitySupportDeepLink(ilCode string) string {
	return "/map?il=" + ilCode
}

func thresholdLevel(th float64) int {
	return int(math.Round(th * 100))
}

func (a *ThreatAlerter) thresholds() []float64 {
	if a == nil || len(a.Thresholds) == 0 {
		return []float64{defaultThreatLow, defaultThreatHigh}
	}
	return a.Thresholds
}

func (a *ThreatAlerter) cooldown() time.Duration {
	if a == nil || a.Cooldown <= 0 {
		return defaultThreatCooldown
	}
	return a.Cooldown
}

// DetectAndEnqueue loads post-spend scores, detects upward tension crossings,
// and enqueues one notif per controlling-tribe member per newly crossed level.
// City-level Redis SETNX prevents duplicate alerts while tension hovers.
// Best-effort: callers should not fail the spend.
func (a *ThreatAlerter) DetectAndEnqueue(
	ctx context.Context,
	ilCode, cityName string,
	supportingTribe uuid.UUID,
	effectiveDelta float64,
) (enqueued int, err error) {
	if a == nil || a.Pool == nil || a.RDB == nil || effectiveDelta == 0 || ilCode == "" {
		return 0, nil
	}

	post, err := a.loadScores(ctx, ilCode)
	if err != nil {
		return 0, err
	}
	pre := reconstructPreScores(post, supportingTribe, effectiveDelta)
	preRanked := rankScores(pre)
	postRanked := rankScores(post)
	if len(postRanked) < 2 {
		return 0, nil
	}
	// A flip is handled by ClearCooldown; do not alert the previous owner after loss.
	if len(preRanked) == 0 || preRanked[0].TribeID != postRanked[0].TribeID {
		return 0, nil
	}

	preTension := ContestTension(preRanked[0].Sum, secondSum(preRanked))
	postTension := ContestTension(postRanked[0].Sum, postRanked[1].Sum)
	crossed := TensionLevelCrossings(preTension, postTension, a.thresholds())
	if len(crossed) == 0 {
		return 0, nil
	}

	leaderID := postRanked[0].TribeID
	members, err := a.loadTribeMembers(ctx, leaderID)
	if err != nil {
		return 0, err
	}
	if len(members) == 0 {
		return 0, nil
	}

	tensionPercent := int(math.Round(postTension * 100))
	reqID, _ := logging.RequestIDFromContext(ctx)

	for _, th := range crossed {
		level := thresholdLevel(th)
		ok, err := a.tryCooldown(ctx, ilCode, level)
		if err != nil {
			return enqueued, err
		}
		if !ok {
			continue
		}
		title, body := notifications.RenderRivalThreatCopy(cityName, tensionPercent, level)
		for _, userID := range members {
			payload := ThreatAlertPayload{
				Type:           NotifTypeRivalThreat,
				UserID:         userID,
				IlCode:         ilCode,
				CityName:       cityName,
				TribeID:        leaderID,
				ContestTension: postTension,
				TensionPercent: tensionPercent,
				Level:          level,
				DeepLink:       CitySupportDeepLink(ilCode),
				RequestID:      reqID,
			}
			raw, _ := json.Marshal(payload)
			if err := cache.EnqueueNotif(ctx, a.RDB, string(raw)); err != nil {
				return enqueued, fmt.Errorf("enqueue notif: %w", err)
			}
			if a.Inbox != nil {
				_ = a.Inbox(ctx, userID, NotifTypeRivalThreat, title, body, payload)
			}
			enqueued++
		}
	}
	return enqueued, nil
}

// ClearCooldown deletes per-level threat-alert cooldown keys for a city so the
// next contest cycle does not inherit the previous owner's window.
func (a *ThreatAlerter) ClearCooldown(ctx context.Context, ilCode string) error {
	if a == nil || a.RDB == nil || ilCode == "" {
		return nil
	}
	keys := make([]string, 0, len(a.thresholds()))
	seen := map[int]bool{}
	for _, th := range a.thresholds() {
		level := thresholdLevel(th)
		if seen[level] {
			continue
		}
		seen[level] = true
		keys = append(keys, ThreatCooldownKey(ilCode, level))
	}
	if len(keys) == 0 {
		return nil
	}
	return a.RDB.Del(ctx, keys...).Err()
}

func (a *ThreatAlerter) tryCooldown(ctx context.Context, ilCode string, level int) (bool, error) {
	key := ThreatCooldownKey(ilCode, level)
	return a.RDB.SetNX(ctx, key, "1", a.cooldown()).Result()
}

func (a *ThreatAlerter) loadScores(ctx context.Context, ilCode string) ([]tribeScore, error) {
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

	var out []tribeScore
	for rows.Next() {
		var s tribeScore
		if err := rows.Scan(&s.TribeID, &s.Sum); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (a *ThreatAlerter) loadTribeMembers(ctx context.Context, tribeID uuid.UUID) ([]uuid.UUID, error) {
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

func reconstructPreScores(post []tribeScore, supportingTribe uuid.UUID, delta float64) []tribeScore {
	out := make([]tribeScore, len(post))
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

func rankScores(scores []tribeScore) []tribeScore {
	out := make([]tribeScore, 0, len(scores))
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

func secondSum(ranked []tribeScore) float64 {
	if len(ranked) < 2 {
		return 0
	}
	return ranked[1].Sum
}
