package devtools

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/tribe"
)

const adminPhone = "+905550000001"
const adminUsername = "qa_admin"

// EnsureQAPersonasSeeded upserts local QA accounts (admin + one player per tribe).
// Safe to call on every boot after tribe.EnsureSeeded.
func EnsureQAPersonasSeeded(ctx context.Context, pool *pgxpool.Pool) error {
	if pool == nil {
		return fmt.Errorf("devtools seed: nil pool")
	}
	adminID, err := upsertUser(ctx, pool, adminPhone, adminUsername, nil, true)
	if err != nil {
		return fmt.Errorf("seed qa_admin: %w", err)
	}
	if err := ensureConsents(ctx, pool, adminID); err != nil {
		return fmt.Errorf("seed qa_admin consents: %w", err)
	}

	seedTribes, err := tribe.LoadSeedTribes()
	if err != nil {
		return err
	}
	for i, t := range seedTribes {
		phone := fmt.Sprintf("+9055500000%02d", 11+i)
		uname := qaUsername(t.Slug)
		var tribeID uuid.UUID
		err := pool.QueryRow(ctx, `SELECT id FROM tribes WHERE slug = $1`, t.Slug).Scan(&tribeID)
		if err != nil {
			return fmt.Errorf("lookup tribe %q: %w", t.Slug, err)
		}
		uid, err := upsertUser(ctx, pool, phone, uname, &tribeID, false)
		if err != nil {
			return fmt.Errorf("seed persona %q: %w", uname, err)
		}
		if err := ensureConsents(ctx, pool, uid); err != nil {
			return fmt.Errorf("seed consents %q: %w", uname, err)
		}
	}
	return nil
}

func qaUsername(slug string) string {
	u := "qa_" + strings.ReplaceAll(slug, "-", "_")
	runes := []rune(u)
	if len(runes) > 24 {
		return string(runes[:24])
	}
	return u
}

func upsertUser(ctx context.Context, pool *pgxpool.Pool, phone, username string, tribeID *uuid.UUID, isAdmin bool) (uuid.UUID, error) {
	birth := time.Date(1992, 6, 15, 0, 0, 0, 0, time.UTC)
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO users (phone, username, birth_date, tribe_id, is_admin, restricted_mode)
		VALUES ($1, $2, $3, $4, $5, false)
		ON CONFLICT (phone) DO UPDATE SET
			username = EXCLUDED.username,
			tribe_id = EXCLUDED.tribe_id,
			is_admin = EXCLUDED.is_admin,
			restricted_mode = false
		RETURNING id
	`, phone, username, birth, tribeID, isAdmin).Scan(&id)
	if err == nil {
		return id, nil
	}
	// Username unique collision with a different phone — update that row.
	err2 := pool.QueryRow(ctx, `
		UPDATE users
		SET phone = $1, tribe_id = $3, is_admin = $4, restricted_mode = false, birth_date = $5
		WHERE username = $2
		RETURNING id
	`, phone, username, tribeID, isAdmin, birth).Scan(&id)
	if err2 != nil {
		return uuid.Nil, fmt.Errorf("upsert user phone=%s username=%s: %v / %w", phone, username, err, err2)
	}
	return id, nil
}

func ensureConsents(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) error {
	types := []string{"aydinlatma_metni", "acik_riza_location", "terms_of_service"}
	for _, ct := range types {
		var version string
		err := pool.QueryRow(ctx, `
			SELECT version FROM consent_versions WHERE consent_type = $1::consent_type
		`, ct).Scan(&version)
		if err != nil {
			if err == pgx.ErrNoRows {
				continue
			}
			return err
		}
		var exists bool
		err = pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM consent_events
				WHERE user_id = $1 AND consent_type = $2::consent_type AND granted = true
			)
		`, userID, ct).Scan(&exists)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		_, err = pool.Exec(ctx, `
			INSERT INTO consent_events (user_id, consent_type, consent_version, granted)
			VALUES ($1, $2::consent_type, $3, true)
		`, userID, ct, version)
		if err != nil {
			return err
		}
	}
	return nil
}
