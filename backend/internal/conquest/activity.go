package conquest

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// KindConquest is a city ownership flip from conquest_log.
	KindConquest = "conquest"
	// KindLargeSupport is a single support at or above the large-spend threshold.
	KindLargeSupport = "large_support"
	// KindDerbySupport is a derby-flagged support (derby_id IS NOT NULL).
	KindDerbySupport = "derby_support"

	// ActivityFeedChannel is the Redis Pub/Sub channel for live ticker events.
	ActivityFeedChannel = "activity:feed"

	// DefaultLargeSupportMin is credits_spent at/above which a support is
	// ticker-eligible. Stand-in for ~p95 until product picks a percentile.
	DefaultLargeSupportMin int64 = 50

	defaultActivityLimit = 50
	maxActivityLimit     = 100
)

// ErrUnknownSinceID is returned when since_id is not a feed-eligible event.
var ErrUnknownSinceID = errors.New("unknown_since_id")

// FeedItem is one nationwide activity-ticker event.
type FeedItem struct {
	ID              uuid.UUID  `json:"id"`
	Kind            string     `json:"kind"`
	IlCode          string     `json:"il_code"`
	CityName        string     `json:"city_name"`
	TribeID         uuid.UUID  `json:"tribe_id"`
	PreviousTribeID *uuid.UUID `json:"previous_tribe_id,omitempty"`
	Credits         float64    `json:"credits"`
	WasDerbiBonus   bool       `json:"was_derbi_bonus"`
	OccurredAt      time.Time  `json:"occurred_at"`
}

// ActivityStore reads the merged conquest + large/derby-support activity feed.
type ActivityStore struct {
	Pool            *pgxpool.Pool
	Read            *pgxpool.Pool
	LargeSupportMin int64
}

func (s *ActivityStore) readPool() *pgxpool.Pool {
	if s != nil && s.Read != nil {
		return s.Read
	}
	if s != nil {
		return s.Pool
	}
	return nil
}

func (s *ActivityStore) largeMin() int64 {
	if s != nil && s.LargeSupportMin > 0 {
		return s.LargeSupportMin
	}
	return DefaultLargeSupportMin
}

func clampActivityLimit(limit int) int {
	if limit <= 0 {
		return defaultActivityLimit
	}
	if limit > maxActivityLimit {
		return maxActivityLimit
	}
	return limit
}

// List returns a reverse-chronological merged feed.
// When sinceID is nil, the newest `limit` events are returned.
// When sinceID is set, only events strictly newer than that feed-eligible row
// are returned (newest first). Unknown sinceID yields ErrUnknownSinceID.
func (s *ActivityStore) List(ctx context.Context, sinceID *uuid.UUID, limit int) ([]FeedItem, error) {
	pool := s.readPool()
	if pool == nil {
		return nil, fmt.Errorf("activity feed: no pool configured")
	}
	limit = clampActivityLimit(limit)
	minCredits := s.largeMin()

	var cursorAt *time.Time
	var cursorID uuid.UUID
	if sinceID != nil && *sinceID != uuid.Nil {
		ts, id, err := s.resolveCursor(ctx, pool, *sinceID, minCredits)
		if err != nil {
			return nil, err
		}
		cursorAt = &ts
		cursorID = id
	}

	const feedSQL = `
		SELECT id, kind, il_code, city_name, tribe_id, previous_tribe_id,
		       credits, was_derbi_bonus, occurred_at
		FROM (
			SELECT cl.id,
			       'conquest'::text AS kind,
			       cl.il_code,
			       cl.city_name,
			       cl.new_tribe_id AS tribe_id,
			       cl.previous_tribe_id,
			       cl.winning_committed_credits::float8 AS credits,
			       cl.was_derbi_bonus,
			       cl.occurred_at
			FROM conquest_log cl
			UNION ALL
			SELECT s.id,
			       CASE WHEN s.derby_id IS NOT NULL THEN 'derby_support' ELSE 'large_support' END,
			       s.il_code,
			       b.name_tr,
			       s.tribe_id,
			       NULL::uuid,
			       s.credits_spent::float8,
			       (s.derby_id IS NOT NULL),
			       s.created_at
			FROM supports s
			JOIN admin_boundaries b ON b.il_code = s.il_code
			WHERE (s.derby_id IS NOT NULL OR s.credits_spent >= $1)
			  AND NOT EXISTS (
			    SELECT 1 FROM conquest_log cl2 WHERE cl2.causing_support_id = s.id
			  )
		) feed
	`

	var (
		rows pgx.Rows
		err  error
	)
	if cursorAt == nil {
		rows, err = pool.Query(ctx, feedSQL+`
			ORDER BY occurred_at DESC, id DESC
			LIMIT $2
		`, minCredits, limit)
	} else {
		rows, err = pool.Query(ctx, feedSQL+`
			WHERE (occurred_at, id) > ($2::timestamptz, $3::uuid)
			ORDER BY occurred_at DESC, id DESC
			LIMIT $4
		`, minCredits, *cursorAt, cursorID, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("list activity feed: %w", err)
	}
	defer rows.Close()

	out := make([]FeedItem, 0)
	for rows.Next() {
		var e FeedItem
		if err := rows.Scan(
			&e.ID,
			&e.Kind,
			&e.IlCode,
			&e.CityName,
			&e.TribeID,
			&e.PreviousTribeID,
			&e.Credits,
			&e.WasDerbiBonus,
			&e.OccurredAt,
		); err != nil {
			return nil, fmt.Errorf("scan activity feed: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate activity feed: %w", err)
	}
	return out, nil
}

func (s *ActivityStore) resolveCursor(ctx context.Context, pool *pgxpool.Pool, sinceID uuid.UUID, minCredits int64) (time.Time, uuid.UUID, error) {
	var occurredAt time.Time
	err := pool.QueryRow(ctx, `
		SELECT occurred_at FROM conquest_log WHERE id = $1
	`, sinceID).Scan(&occurredAt)
	if err == nil {
		return occurredAt, sinceID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, uuid.Nil, fmt.Errorf("resolve activity since_id: %w", err)
	}

	err = pool.QueryRow(ctx, `
		SELECT s.created_at
		FROM supports s
		WHERE s.id = $1
		  AND (s.derby_id IS NOT NULL OR s.credits_spent >= $2)
		  AND NOT EXISTS (
		    SELECT 1 FROM conquest_log cl WHERE cl.causing_support_id = s.id
		  )
	`, sinceID, minCredits).Scan(&occurredAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, uuid.Nil, ErrUnknownSinceID
	}
	if err != nil {
		return time.Time{}, uuid.Nil, fmt.Errorf("resolve activity since_id: %w", err)
	}
	return occurredAt, sinceID, nil
}
