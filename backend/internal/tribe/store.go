package tribe

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound           = errors.New("tribe_not_found")
	ErrAlreadyInTribe     = errors.New("already_in_tribe")
	ErrSwitchCooldown     = errors.New("tribe_switch_cooldown")
	ErrInactiveTribe      = errors.New("tribe_inactive")
	ErrSlugTaken          = errors.New("tribe_slug_taken")
	ErrInvalidColor       = errors.New("invalid_color")
	ErrInvalidInput       = errors.New("invalid_input")
)

// Tribe is a public tribe row.
type Tribe struct {
	ID             uuid.UUID `json:"id"`
	Slug           string    `json:"slug"`
	DisplayName    string    `json:"display_name"`
	ShortName      string    `json:"short_name"`
	PrimaryColor   string    `json:"primary_color"`
	SecondaryColor string    `json:"secondary_color"`
	IsActive       bool      `json:"is_active"`
	MemberCount    int64     `json:"member_count,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// Membership is the caller's current tribe affiliation.
type Membership struct {
	TribeID           *uuid.UUID `json:"tribe_id"`
	TribeSwitchedAt   *time.Time `json:"tribe_switched_at"`
	SwitchAvailableAt *time.Time `json:"switch_available_at"`
}

// CreateTribeInput is the admin create payload.
type CreateTribeInput struct {
	Slug              string
	DisplayName       string
	ShortName         string
	PrimaryColor      string
	SecondaryColor    string
	CreatedByAdminID  uuid.UUID
}

// UpdateTribeInput is a partial admin update.
type UpdateTribeInput struct {
	DisplayName    *string
	ShortName      *string
	PrimaryColor   *string
	SecondaryColor *string
	IsActive       *bool
}

// Store persists tribes and membership.
type Store interface {
	SeedUpserter
	ListActive(ctx context.Context) ([]Tribe, error)
	GetByID(ctx context.Context, id uuid.UUID) (Tribe, error)
	GetMembership(ctx context.Context, userID uuid.UUID) (tribeID *uuid.UUID, switchedAt *time.Time, err error)
	Join(ctx context.Context, userID, tribeID uuid.UUID, now time.Time) error
	// Switch updates only users.tribe_id / tribe_switched_at.
	// Prior supports remain attributed to the tribe_id recorded at spend time;
	// switching must never rewrite support history.
	Switch(ctx context.Context, userID, tribeID uuid.UUID, now time.Time, cooldown time.Duration) error
	Create(ctx context.Context, in CreateTribeInput) (Tribe, error)
	Update(ctx context.Context, id uuid.UUID, in UpdateTribeInput) (Tribe, error)
}

// PoolStore implements Store with pgxpool.
type PoolStore struct {
	Pool *pgxpool.Pool
}

// UpsertSeedTribe inserts or updates a seed tribe by slug (created_by_admin_id stays null).
func (s *PoolStore) UpsertSeedTribe(ctx context.Context, t SeedTribe) error {
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO tribes (slug, display_name, short_name, primary_color, secondary_color, is_active, created_by_admin_id)
		VALUES ($1, $2, $3, $4, $5, true, NULL)
		ON CONFLICT (slug) DO UPDATE SET
			display_name = EXCLUDED.display_name,
			short_name = EXCLUDED.short_name,
			primary_color = EXCLUDED.primary_color,
			secondary_color = EXCLUDED.secondary_color,
			is_active = true,
			updated_at = now()
	`, t.Slug, t.DisplayName, t.ShortName, t.PrimaryColor, t.SecondaryColor)
	return err
}

// ListActive returns active tribes with member counts.
func (s *PoolStore) ListActive(ctx context.Context) ([]Tribe, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT t.id, t.slug, t.display_name, t.short_name, t.primary_color, t.secondary_color,
		       t.is_active, t.created_at, t.updated_at,
		       (SELECT COUNT(*) FROM users u WHERE u.tribe_id = t.id) AS member_count
		FROM tribes t
		WHERE t.is_active = true
		ORDER BY t.display_name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Tribe
	for rows.Next() {
		var t Tribe
		if err := rows.Scan(
			&t.ID, &t.Slug, &t.DisplayName, &t.ShortName, &t.PrimaryColor, &t.SecondaryColor,
			&t.IsActive, &t.CreatedAt, &t.UpdatedAt, &t.MemberCount,
		); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// GetByID returns a tribe public profile including inactive (admin may need them);
// handlers filter active for public get.
func (s *PoolStore) GetByID(ctx context.Context, id uuid.UUID) (Tribe, error) {
	var t Tribe
	err := s.Pool.QueryRow(ctx, `
		SELECT t.id, t.slug, t.display_name, t.short_name, t.primary_color, t.secondary_color,
		       t.is_active, t.created_at, t.updated_at,
		       (SELECT COUNT(*) FROM users u WHERE u.tribe_id = t.id) AS member_count
		FROM tribes t
		WHERE t.id = $1
	`, id).Scan(
		&t.ID, &t.Slug, &t.DisplayName, &t.ShortName, &t.PrimaryColor, &t.SecondaryColor,
		&t.IsActive, &t.CreatedAt, &t.UpdatedAt, &t.MemberCount,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Tribe{}, ErrNotFound
	}
	return t, err
}

// GetMembership returns the user's tribe_id and tribe_switched_at.
func (s *PoolStore) GetMembership(ctx context.Context, userID uuid.UUID) (*uuid.UUID, *time.Time, error) {
	var tribeID *uuid.UUID
	var switchedAt *time.Time
	err := s.Pool.QueryRow(ctx,
		`SELECT tribe_id, tribe_switched_at FROM users WHERE id = $1`, userID,
	).Scan(&tribeID, &switchedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, ErrNotFound
	}
	return tribeID, switchedAt, err
}

func (s *PoolStore) requireActiveTribe(ctx context.Context, tribeID uuid.UUID) error {
	var active bool
	err := s.Pool.QueryRow(ctx, `SELECT is_active FROM tribes WHERE id = $1`, tribeID).Scan(&active)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if !active {
		return ErrInactiveTribe
	}
	return nil
}

// Join sets the user's first tribe, or is idempotent when already in the same tribe.
func (s *PoolStore) Join(ctx context.Context, userID, tribeID uuid.UUID, now time.Time) error {
	if err := s.requireActiveTribe(ctx, tribeID); err != nil {
		return err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var current *uuid.UUID
	err = tx.QueryRow(ctx,
		`SELECT tribe_id FROM users WHERE id = $1 FOR UPDATE`, userID,
	).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	if current != nil {
		if *current == tribeID {
			return tx.Commit(ctx) // idempotent same-tribe
		}
		return ErrAlreadyInTribe
	}

	_, err = tx.Exec(ctx,
		`UPDATE users SET tribe_id = $1, tribe_switched_at = $2 WHERE id = $3`,
		tribeID, now.UTC(), userID,
	)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Switch changes tribe after the cooldown window.
// Only mutates users.tribe_id and users.tribe_switched_at — never support history.
func (s *PoolStore) Switch(ctx context.Context, userID, tribeID uuid.UUID, now time.Time, cooldown time.Duration) error {
	if err := s.requireActiveTribe(ctx, tribeID); err != nil {
		return err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var current *uuid.UUID
	var switchedAt *time.Time
	err = tx.QueryRow(ctx,
		`SELECT tribe_id, tribe_switched_at FROM users WHERE id = $1 FOR UPDATE`, userID,
	).Scan(&current, &switchedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	if current != nil && *current == tribeID {
		return tx.Commit(ctx) // idempotent same-tribe switch
	}

	if switchedAt != nil {
		available := switchedAt.Add(cooldown)
		if now.Before(available) {
			return ErrSwitchCooldown
		}
	}

	_, err = tx.Exec(ctx,
		`UPDATE users SET tribe_id = $1, tribe_switched_at = $2 WHERE id = $3`,
		tribeID, now.UTC(), userID,
	)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Create inserts an admin-managed tribe.
func (s *PoolStore) Create(ctx context.Context, in CreateTribeInput) (Tribe, error) {
	var t Tribe
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO tribes (slug, display_name, short_name, primary_color, secondary_color, is_active, created_by_admin_id)
		VALUES ($1, $2, $3, $4, $5, true, $6)
		RETURNING id, slug, display_name, short_name, primary_color, secondary_color, is_active, created_at, updated_at
	`, in.Slug, in.DisplayName, in.ShortName, in.PrimaryColor, in.SecondaryColor, in.CreatedByAdminID,
	).Scan(
		&t.ID, &t.Slug, &t.DisplayName, &t.ShortName, &t.PrimaryColor, &t.SecondaryColor,
		&t.IsActive, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return Tribe{}, ErrSlugTaken
		}
		return Tribe{}, err
	}
	return t, nil
}

// Update applies a partial admin update.
func (s *PoolStore) Update(ctx context.Context, id uuid.UUID, in UpdateTribeInput) (Tribe, error) {
	existing, err := s.GetByID(ctx, id)
	if err != nil {
		return Tribe{}, err
	}

	display := existing.DisplayName
	if in.DisplayName != nil {
		display = *in.DisplayName
	}
	short := existing.ShortName
	if in.ShortName != nil {
		short = *in.ShortName
	}
	primary := existing.PrimaryColor
	if in.PrimaryColor != nil {
		primary = *in.PrimaryColor
	}
	secondary := existing.SecondaryColor
	if in.SecondaryColor != nil {
		secondary = *in.SecondaryColor
	}
	active := existing.IsActive
	if in.IsActive != nil {
		active = *in.IsActive
	}

	var t Tribe
	err = s.Pool.QueryRow(ctx, `
		UPDATE tribes SET
			display_name = $2,
			short_name = $3,
			primary_color = $4,
			secondary_color = $5,
			is_active = $6,
			updated_at = now()
		WHERE id = $1
		RETURNING id, slug, display_name, short_name, primary_color, secondary_color, is_active, created_at, updated_at
	`, id, display, short, primary, secondary, active,
	).Scan(
		&t.ID, &t.Slug, &t.DisplayName, &t.ShortName, &t.PrimaryColor, &t.SecondaryColor,
		&t.IsActive, &t.CreatedAt, &t.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Tribe{}, ErrNotFound
	}
	if err != nil {
		return Tribe{}, err
	}
	t.MemberCount = existing.MemberCount
	return t, nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
