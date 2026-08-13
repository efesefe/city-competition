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

// ErrUnknownLog is returned when mark-read targets a conquest_log id that does not exist.
var ErrUnknownLog = errors.New("unknown_log")

const (
	defaultListLimit = 20
	maxListLimit     = 100
)

// Entry is one durable city-ownership flip.
type Entry struct {
	ID                      uuid.UUID  `json:"id"`
	IlCode                  string     `json:"il_code"`
	CityName                string     `json:"city_name"`
	PreviousTribeID         *uuid.UUID `json:"previous_tribe_id"`
	NewTribeID              uuid.UUID  `json:"new_tribe_id"`
	WinningCommittedCredits float64    `json:"winning_committed_credits"`
	OccurredAt              time.Time  `json:"occurred_at"`
	WasDerbiBonus           bool       `json:"was_derbi_bonus"`
	CausedFlip              bool       `json:"caused_flip"`
}

// Store reads and writes conquest_log and the per-user unread cursor.
type Store struct {
	Pool *pgxpool.Pool
	Read *pgxpool.Pool
}

func (s *Store) readPool() *pgxpool.Pool {
	if s != nil && s.Read != nil {
		return s.Read
	}
	if s != nil {
		return s.Pool
	}
	return nil
}

func (s *Store) writePool() *pgxpool.Pool {
	if s == nil {
		return nil
	}
	return s.Pool
}

// InsertOnTx writes exactly one conquest_log row on the caller's transaction.
// The support spend path must call this inside the same tx that flips scores;
// a flip that is not logged is a data-integrity bug.
func (s *Store) InsertOnTx(ctx context.Context, tx pgx.Tx, e Entry) error {
	if tx == nil {
		return fmt.Errorf("conquest log: nil tx")
	}
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO conquest_log (
			id, il_code, city_name, previous_tribe_id, new_tribe_id,
			winning_committed_credits, occurred_at, was_derbi_bonus
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, e.ID, e.IlCode, e.CityName, e.PreviousTribeID, e.NewTribeID,
		e.WinningCommittedCredits, e.OccurredAt, e.WasDerbiBonus)
	if err != nil {
		return fmt.Errorf("insert conquest_log: %w", err)
	}
	return nil
}

// List returns reverse-chronological entries (newest first).
// caused_flip is true when viewerID owns the single support that crossed the
// flip threshold for that entry.
func (s *Store) List(ctx context.Context, viewerID uuid.UUID, limit, offset int) ([]Entry, error) {
	pool := s.readPool()
	if pool == nil {
		return nil, fmt.Errorf("conquest log: no pool configured")
	}
	limit, offset = clampListBounds(limit, offset)

	rows, err := pool.Query(ctx, `
		SELECT cl.id, cl.il_code, cl.city_name, cl.previous_tribe_id, cl.new_tribe_id,
		       cl.winning_committed_credits::float8, cl.occurred_at, cl.was_derbi_bonus,
		       COALESCE(s.user_id = $1, false) AS caused_flip
		FROM conquest_log cl
		LEFT JOIN supports s ON s.id = cl.causing_support_id
		ORDER BY cl.occurred_at DESC, cl.id DESC
		LIMIT $2 OFFSET $3
	`, viewerID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list conquest_log: %w", err)
	}
	defer rows.Close()

	out := make([]Entry, 0)
	for rows.Next() {
		var e Entry
		if err := rows.Scan(
			&e.ID,
			&e.IlCode,
			&e.CityName,
			&e.PreviousTribeID,
			&e.NewTribeID,
			&e.WinningCommittedCredits,
			&e.OccurredAt,
			&e.WasDerbiBonus,
			&e.CausedFlip,
		); err != nil {
			return nil, fmt.Errorf("scan conquest_log: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate conquest_log: %w", err)
	}
	return out, nil
}

// UnreadCount returns how many log entries occurred after the user's last-read marker.
// A NULL marker means the entire log is unread.
func (s *Store) UnreadCount(ctx context.Context, userID uuid.UUID) (int, error) {
	pool := s.readPool()
	if pool == nil {
		return 0, fmt.Errorf("conquest log: no pool configured")
	}
	var n int
	err := pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM conquest_log cl
		JOIN users u ON u.id = $1
		WHERE u.last_read_conquest_log_id IS NULL
		   OR (cl.occurred_at, cl.id) > (
		        SELECT marker.occurred_at, marker.id
		        FROM conquest_log marker
		        WHERE marker.id = u.last_read_conquest_log_id
		   )
	`, userID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("conquest unread count: %w", err)
	}
	return n, nil
}

// MarkRead advances the user's last-read cursor. It never moves the marker backwards.
// When all is true, the cursor is set to the newest log row (no-op if the log is empty).
func (s *Store) MarkRead(ctx context.Context, userID uuid.UUID, upToID *uuid.UUID, all bool) (int, error) {
	pool := s.writePool()
	if pool == nil {
		return 0, fmt.Errorf("conquest log: no pool configured")
	}
	if all {
		tag, err := pool.Exec(ctx, `
			UPDATE users
			SET last_read_conquest_log_id = (
				SELECT id FROM conquest_log
				ORDER BY occurred_at DESC, id DESC
				LIMIT 1
			)
			WHERE id = $1
			  AND (
			    last_read_conquest_log_id IS DISTINCT FROM (
			      SELECT id FROM conquest_log
			      ORDER BY occurred_at DESC, id DESC
			      LIMIT 1
			    )
			  )
		`, userID)
		if err != nil {
			return 0, fmt.Errorf("conquest mark-read all: %w", err)
		}
		return int(tag.RowsAffected()), nil
	}
	if upToID == nil || *upToID == uuid.Nil {
		return 0, fmt.Errorf("conquest mark-read: missing up_to_id")
	}

	var exists bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM conquest_log WHERE id = $1)
	`, *upToID).Scan(&exists); err != nil {
		return 0, fmt.Errorf("conquest mark-read lookup: %w", err)
	}
	if !exists {
		return 0, ErrUnknownLog
	}

	tag, err := pool.Exec(ctx, `
		UPDATE users
		SET last_read_conquest_log_id = $2
		WHERE id = $1
		  AND (
		    last_read_conquest_log_id IS NULL
		    OR EXISTS (
		      SELECT 1
		      FROM conquest_log AS new_log
		      JOIN conquest_log AS old_log ON old_log.id = users.last_read_conquest_log_id
		      WHERE new_log.id = $2
		        AND (new_log.occurred_at, new_log.id) > (old_log.occurred_at, old_log.id)
		    )
		  )
	`, userID, *upToID)
	if err != nil {
		return 0, fmt.Errorf("conquest mark-read: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

func clampListBounds(limit, offset int) (int, int) {
	if limit <= 0 {
		limit = defaultListLimit
	}
	if limit > maxListLimit {
		limit = maxListLimit
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}
