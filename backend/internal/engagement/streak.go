package engagement

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// istanbul is the calendar zone for support-streak day boundaries (Türkiye).
var istanbul *time.Location

func init() {
	var err error
	istanbul, err = time.LoadLocation("Europe/Istanbul")
	if err != nil {
		istanbul = time.FixedZone("Europe/Istanbul", 3*60*60)
	}
}

// Istanbul returns the Europe/Istanbul location used for streak calendar days.
func Istanbul() *time.Location {
	return istanbul
}

// StreakState is the persisted streak row.
type StreakState struct {
	CurrentStreak   int
	LongestStreak   int
	LastSupportDate *time.Time // date-only in Istanbul; nil if never supported
}

// NextStreak computes the streak after a successful support at now (Istanbul calendar).
func NextStreak(prev StreakState, now time.Time) StreakState {
	today := calendarDate(now)
	out := prev

	if prev.LastSupportDate == nil {
		out.CurrentStreak = 1
	} else {
		last := calendarDate(*prev.LastSupportDate)
		switch {
		case last.Equal(today):
			// Same Istanbul calendar day — no change to current/longest.
			out.LastSupportDate = &today
			return out
		case last.Equal(today.AddDate(0, 0, -1)):
			out.CurrentStreak = prev.CurrentStreak + 1
		default:
			out.CurrentStreak = 1
		}
	}

	if out.CurrentStreak > out.LongestStreak {
		out.LongestStreak = out.CurrentStreak
	}
	out.LastSupportDate = &today
	return out
}

func calendarDate(t time.Time) time.Time {
	in := t.In(istanbul)
	return time.Date(in.Year(), in.Month(), in.Day(), 0, 0, 0, 0, istanbul)
}

// StreakStore upserts user_support_streaks inside an existing transaction.
type StreakStore struct{}

// UpsertOnSupport updates the user's support streak for a successful spend at now.
func (StreakStore) UpsertOnSupport(ctx context.Context, tx pgx.Tx, userID uuid.UUID, now time.Time) error {
	var current, longest int
	var last *time.Time
	err := tx.QueryRow(ctx, `
		SELECT current_streak, longest_streak, last_support_date
		FROM user_support_streaks
		WHERE user_id = $1
		FOR UPDATE
	`, userID).Scan(&current, &longest, &last)
	if err != nil && err != pgx.ErrNoRows {
		return fmt.Errorf("load support streak: %w", err)
	}

	next := NextStreak(StreakState{
		CurrentStreak:   current,
		LongestStreak:   longest,
		LastSupportDate: last,
	}, now)

	_, err = tx.Exec(ctx, `
		INSERT INTO user_support_streaks (user_id, current_streak, longest_streak, last_support_date)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id) DO UPDATE SET
			current_streak = EXCLUDED.current_streak,
			longest_streak = EXCLUDED.longest_streak,
			last_support_date = EXCLUDED.last_support_date
	`, userID, next.CurrentStreak, next.LongestStreak, next.LastSupportDate)
	if err != nil {
		return fmt.Errorf("upsert support streak: %w", err)
	}
	return nil
}
