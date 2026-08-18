package monetization

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Promo is one extra-credits campaign row.
type Promo struct {
	ID           uuid.UUID
	BonusPercent int64
	Active       bool
	CreatedBy    uuid.UUID
	CreatedAt    time.Time
}

// PromoStore loads and toggles purchase_promos.
type PromoStore struct {
	Pool *pgxpool.Pool
}

// Active returns the current extra-credits promo, or a zero Promo when none is on.
func (s *PromoStore) Active(ctx context.Context) (Promo, error) {
	if s == nil || s.Pool == nil {
		return Promo{}, nil
	}
	var p Promo
	err := s.Pool.QueryRow(ctx, `
		SELECT id, bonus_percent, active, created_by, created_at
		FROM purchase_promos
		WHERE active = true
		ORDER BY created_at DESC
		LIMIT 1
	`).Scan(&p.ID, &p.BonusPercent, &p.Active, &p.CreatedBy, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Promo{}, nil
	}
	if err != nil {
		return Promo{}, fmt.Errorf("active promo: %w", err)
	}
	return p, nil
}

// Activate deactivates any live promo and inserts a new active one.
func (s *PromoStore) Activate(ctx context.Context, adminID uuid.UUID, percent int64) (Promo, error) {
	if s == nil || s.Pool == nil {
		return Promo{}, fmt.Errorf("promo store not configured")
	}
	if !ValidPromoPercent(percent) {
		return Promo{}, ErrInvalidPromoPercent
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Promo{}, fmt.Errorf("begin promo: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		UPDATE purchase_promos
		SET active = false, deactivated_at = now(), deactivated_by = $1
		WHERE active = true
	`, adminID); err != nil {
		return Promo{}, fmt.Errorf("deactivate previous promo: %w", err)
	}

	var p Promo
	p.Active = true
	p.BonusPercent = percent
	p.CreatedBy = adminID
	err = tx.QueryRow(ctx, `
		INSERT INTO purchase_promos (bonus_percent, active, created_by)
		VALUES ($1, true, $2)
		RETURNING id, created_at
	`, percent, adminID).Scan(&p.ID, &p.CreatedAt)
	if err != nil {
		return Promo{}, fmt.Errorf("insert promo: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Promo{}, fmt.Errorf("commit promo: %w", err)
	}
	return p, nil
}

// Deactivate turns off the current promo. Returns the deactivated row.
func (s *PromoStore) Deactivate(ctx context.Context, adminID uuid.UUID) (Promo, error) {
	if s == nil || s.Pool == nil {
		return Promo{}, fmt.Errorf("promo store not configured")
	}
	var p Promo
	err := s.Pool.QueryRow(ctx, `
		UPDATE purchase_promos
		SET active = false, deactivated_at = now(), deactivated_by = $1
		WHERE active = true
		RETURNING id, bonus_percent, active, created_by, created_at
	`, adminID).Scan(&p.ID, &p.BonusPercent, &p.Active, &p.CreatedBy, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Promo{}, ErrNoActivePromo
	}
	if err != nil {
		return Promo{}, fmt.Errorf("deactivate promo: %w", err)
	}
	return p, nil
}
