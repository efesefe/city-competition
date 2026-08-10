package derby

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	StatusScheduled = "scheduled"
	StatusActive    = "active"
	StatusResolved  = "resolved"
)

var (
	ErrNotFound        = errors.New("derby_not_found")
	ErrSameTribe       = errors.New("error_derby_same_tribe")
	ErrInactiveTribe   = errors.New("tribe_inactive")
	ErrTribeNotFound   = errors.New("tribe_not_found")
	ErrInvalidIlCode   = errors.New("invalid_il_code")
	ErrInvalidWindow   = errors.New("error_derby_invalid_window")
	ErrInvalidInput    = errors.New("invalid_input")
	ErrAlreadyResolved = errors.New("error_derby_already_resolved")
	ErrInvalidStatus   = errors.New("error_derby_invalid_status")
)

// Derby is a match-day event row.
type Derby struct {
	ID                  uuid.UUID `json:"id"`
	HostTribeID         uuid.UUID `json:"host_tribe_id"`
	GuestTribeID        uuid.UUID `json:"guest_tribe_id"`
	IlCode              string    `json:"il_code"`
	StartsAt            time.Time `json:"starts_at"`
	EndsAt              time.Time `json:"ends_at"`
	Status              string    `json:"status"`
	HostEffectiveTotal  float64   `json:"host_effective_total"`
	GuestEffectiveTotal float64   `json:"guest_effective_total"`
	CreatedByAdminID    uuid.UUID `json:"created_by_admin_id"`
	CreatedAt           time.Time `json:"created_at"`
}

// CreateInput is the admin create payload after validation.
type CreateInput struct {
	HostTribeID      uuid.UUID
	GuestTribeID     uuid.UUID
	IlCode           string
	StartsAt         time.Time
	EndsAt           time.Time
	CreatedByAdminID uuid.UUID
}

// Store persists derbies.
type Store interface {
	Create(ctx context.Context, in CreateInput) (Derby, error)
	Get(ctx context.Context, id uuid.UUID) (Derby, error)
	List(ctx context.Context) ([]Derby, error)
	GetActiveByIl(ctx context.Context, ilCode string) (Derby, error)
	RequireActiveTribe(ctx context.Context, tribeID uuid.UUID) error
	ListMemberIDs(ctx context.Context, tribeIDs ...uuid.UUID) ([]uuid.UUID, error)
	ListDueToActivate(ctx context.Context, now time.Time) ([]Derby, error)
	ListDueToResolve(ctx context.Context, now time.Time) ([]Derby, error)
	TransitionToActive(ctx context.Context, id uuid.UUID) (Derby, error)
	Resolve(ctx context.Context, id uuid.UUID, hostTotal, guestTotal float64) (Derby, error)
}

// PoolStore implements Store with pgxpool.
type PoolStore struct {
	Pool *pgxpool.Pool
}

func scanDerby(row pgx.Row) (Derby, error) {
	var d Derby
	err := row.Scan(
		&d.ID,
		&d.HostTribeID,
		&d.GuestTribeID,
		&d.IlCode,
		&d.StartsAt,
		&d.EndsAt,
		&d.Status,
		&d.HostEffectiveTotal,
		&d.GuestEffectiveTotal,
		&d.CreatedByAdminID,
		&d.CreatedAt,
	)
	return d, err
}

const derbyColumns = `
	id, host_tribe_id, guest_tribe_id, il_code, starts_at, ends_at, status,
	host_effective_total::float8, guest_effective_total::float8,
	created_by_admin_id, created_at`

// Create inserts a scheduled derby.
func (s *PoolStore) Create(ctx context.Context, in CreateInput) (Derby, error) {
	row := s.Pool.QueryRow(ctx, `
		INSERT INTO derbies (
			host_tribe_id, guest_tribe_id, il_code, starts_at, ends_at,
			status, created_by_admin_id
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING `+derbyColumns, in.HostTribeID, in.GuestTribeID, in.IlCode,
		in.StartsAt, in.EndsAt, StatusScheduled, in.CreatedByAdminID,
	)
	d, err := scanDerby(row)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23514" {
			if strings.Contains(pgErr.Message, "host_tribe_id") || strings.Contains(pgErr.ConstraintName, "host_tribe") {
				return Derby{}, ErrSameTribe
			}
			if strings.Contains(pgErr.Message, "ends_at") {
				return Derby{}, ErrInvalidWindow
			}
			return Derby{}, ErrInvalidInput
		}
		return Derby{}, err
	}
	return d, nil
}

// Get returns a derby by id.
func (s *PoolStore) Get(ctx context.Context, id uuid.UUID) (Derby, error) {
	d, err := scanDerby(s.Pool.QueryRow(ctx, `
		SELECT `+derbyColumns+` FROM derbies WHERE id = $1
	`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Derby{}, ErrNotFound
	}
	return d, err
}

// List returns all derbies newest first.
func (s *PoolStore) List(ctx context.Context) ([]Derby, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT `+derbyColumns+` FROM derbies
		ORDER BY starts_at DESC, created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Derby
	for rows.Next() {
		d, err := scanDerby(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// GetActiveByIl returns the newest active derby for an il_code, if any.
func (s *PoolStore) GetActiveByIl(ctx context.Context, ilCode string) (Derby, error) {
	d, err := scanDerby(s.Pool.QueryRow(ctx, `
		SELECT `+derbyColumns+` FROM derbies
		WHERE status = $1 AND il_code = $2
		ORDER BY starts_at DESC
		LIMIT 1
	`, StatusActive, ilCode))
	if errors.Is(err, pgx.ErrNoRows) {
		return Derby{}, ErrNotFound
	}
	return d, err
}

// RequireActiveTribe ensures the tribe exists and is active.
func (s *PoolStore) RequireActiveTribe(ctx context.Context, tribeID uuid.UUID) error {
	var active bool
	err := s.Pool.QueryRow(ctx, `SELECT is_active FROM tribes WHERE id = $1`, tribeID).Scan(&active)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrTribeNotFound
	}
	if err != nil {
		return err
	}
	if !active {
		return ErrInactiveTribe
	}
	return nil
}

// ListMemberIDs returns user ids belonging to any of the given tribes.
func (s *PoolStore) ListMemberIDs(ctx context.Context, tribeIDs ...uuid.UUID) ([]uuid.UUID, error) {
	if len(tribeIDs) == 0 {
		return nil, nil
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT id FROM users WHERE tribe_id = ANY($1)
	`, tribeIDs)
	if err != nil {
		return nil, fmt.Errorf("list tribe members: %w", err)
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

// ListDueToActivate returns scheduled derbies whose starts_at has passed.
func (s *PoolStore) ListDueToActivate(ctx context.Context, now time.Time) ([]Derby, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT `+derbyColumns+` FROM derbies
		WHERE status = $1 AND starts_at <= $2
		ORDER BY starts_at ASC
	`, StatusScheduled, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Derby
	for rows.Next() {
		d, err := scanDerby(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ListDueToResolve returns active derbies whose ends_at has passed.
func (s *PoolStore) ListDueToResolve(ctx context.Context, now time.Time) ([]Derby, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT `+derbyColumns+` FROM derbies
		WHERE status = $1 AND ends_at <= $2
		ORDER BY ends_at ASC
	`, StatusActive, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Derby
	for rows.Next() {
		d, err := scanDerby(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// TransitionToActive moves scheduled → active (CAS on status).
func (s *PoolStore) TransitionToActive(ctx context.Context, id uuid.UUID) (Derby, error) {
	d, err := scanDerby(s.Pool.QueryRow(ctx, `
		UPDATE derbies SET status = $1
		WHERE id = $2 AND status = $3
		RETURNING `+derbyColumns, StatusActive, id, StatusScheduled,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return Derby{}, ErrInvalidStatus
	}
	return d, err
}

// Resolve persists totals and sets status to resolved from scheduled or active.
func (s *PoolStore) Resolve(ctx context.Context, id uuid.UUID, hostTotal, guestTotal float64) (Derby, error) {
	d, err := scanDerby(s.Pool.QueryRow(ctx, `
		UPDATE derbies SET
			status = $1,
			host_effective_total = $2,
			guest_effective_total = $3
		WHERE id = $4 AND status IN ($5, $6)
		RETURNING `+derbyColumns,
		StatusResolved, hostTotal, guestTotal, id, StatusScheduled, StatusActive,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		cur, getErr := s.Get(ctx, id)
		if getErr != nil {
			return Derby{}, getErr
		}
		if cur.Status == StatusResolved {
			return Derby{}, ErrAlreadyResolved
		}
		return Derby{}, ErrInvalidStatus
	}
	return d, err
}
