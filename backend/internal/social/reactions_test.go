package social_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/migrate"
	"github.com/city-competition-remastered/backend/internal/social"
)

func reactionTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	migrationsPath := os.Getenv("TEST_MIGRATIONS_PATH")
	if migrationsPath == "" {
		migrationsPath = filepath.Join("..", "..", "..", "migrations")
	}
	if err := migrate.Up(dsn, migrationsPath); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func seedReactionUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date)
		VALUES ($1, $2, $3, DATE '2000-01-01')
	`, id, "+1888"+id.String()[24:], "r"+id.String()[:12])
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM event_reactions WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM activity_events WHERE actor_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func seedEvent(t *testing.T, pool *pgxpool.Pool, actorID uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO activity_events (event_type, actor_id, place_name, place_type)
		VALUES ('support_placed', $1, 'İstanbul', 'province')
		RETURNING id
	`, actorID).Scan(&id)
	if err != nil {
		t.Fatalf("seed event: %v", err)
	}
	return id
}

func TestUpsertReaction_ChangesEmoji_NoDuplicateRow(t *testing.T) {
	pool := reactionTestPool(t)
	userID := seedReactionUser(t, pool)
	eventID := seedEvent(t, pool, userID)
	store := &social.PoolStore{Pool: pool}

	r1, err := store.UpsertReaction(context.Background(), eventID, userID, "🔥")
	if err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	if r1.Emoji != "🔥" {
		t.Fatalf("emoji=%q", r1.Emoji)
	}

	r2, err := store.UpsertReaction(context.Background(), eventID, userID, "👏")
	if err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	if r2.Emoji != "👏" {
		t.Fatalf("emoji=%q want 👏", r2.Emoji)
	}
	if r2.ID != r1.ID {
		t.Fatalf("id changed on upsert: %s -> %s", r1.ID, r2.ID)
	}

	var count int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM event_reactions WHERE event_id = $1 AND user_id = $2
	`, eventID, userID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("row count=%d want 1", count)
	}
}
