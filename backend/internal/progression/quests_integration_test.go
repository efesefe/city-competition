package progression_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/migrate"
	"github.com/city-competition-remastered/backend/internal/progression"
	"github.com/city-competition-remastered/backend/internal/support"
)

func testPool(t *testing.T) *pgxpool.Pool {
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

func seedUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	phone := "+1555" + id.String()[24:]
	username := "p" + id.String()[:12]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date, restricted_mode)
		VALUES ($1, $2, $3, DATE '2000-01-01', false)
	`, id, phone, username)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_quest_progress WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_xp WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func TestNewQuestTemplate_EvaluableWithoutCodeChange(t *testing.T) {
	pool := testPool(t)
	userID := seedUser(t, pool)
	fixed := time.Date(2026, 8, 10, 12, 0, 0, 0, progression.Istanbul())

	code := "test_support_count_2_" + uuid.New().String()[:8]
	var templateID uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO quest_templates (code, title, period, criteria, xp_reward, active)
		VALUES ($1, 'Support twice', 'daily', '{"type":"support_count","target":2}'::jsonb, 15, true)
		RETURNING id
	`, code).Scan(&templateID)
	if err != nil {
		t.Fatalf("insert template: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_quest_progress WHERE template_id = $1`, templateID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM quest_templates WHERE id = $1`, templateID)
	})

	engine := &progression.Engine{
		Pool: pool,
		Now:  func() time.Time { return fixed },
	}

	tribeID := uuid.New()
	for i := 0; i < 2; i++ {
		engine.OnSupportApplied(context.Background(), support.SupportAppliedEvent{
			UserID:  userID,
			TribeID: tribeID,
			IlCode:  "34",
			Delta:   1,
		})
	}

	periodKey := progression.PeriodKey("daily", fixed)
	var progress int
	var status string
	err = pool.QueryRow(context.Background(), `
		SELECT progress, status
		FROM user_quest_progress
		WHERE user_id = $1 AND template_id = $2 AND period_key = $3
	`, userID, templateID, periodKey).Scan(&progress, &status)
	if err != nil {
		t.Fatalf("load progress: %v", err)
	}
	if progress != 2 || status != "completed" {
		t.Fatalf("progress=%d status=%q want 2/completed", progress, status)
	}

	// Quest reward + 2× support XP grants should be present.
	total, err := (&progression.Store{Pool: pool}).GetTotalXP(context.Background(), userID)
	if err != nil {
		t.Fatalf("get xp: %v", err)
	}
	wantXP := 2*progression.XPSupportApplied + 15
	if total != wantXP {
		t.Fatalf("total_xp=%d want %d", total, wantXP)
	}
}

func TestLookupRank_FromDBTiers(t *testing.T) {
	pool := testPool(t)
	store := &progression.Store{Pool: pool}
	tiers, err := store.LoadRankTiers(context.Background())
	if err != nil {
		t.Fatalf("load tiers: %v", err)
	}
	if len(tiers) < 2 {
		t.Fatalf("expected seeded rank_tiers, got %d", len(tiers))
	}
	rank := progression.LookupRank(tiers, 100)
	if rank.MinXP != 100 {
		t.Fatalf("boundary 100: min_xp=%d badge=%q", rank.MinXP, rank.BadgeName)
	}
}
