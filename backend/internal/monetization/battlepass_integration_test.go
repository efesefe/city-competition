package monetization_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/credits"
	"github.com/city-competition-remastered/backend/internal/migrate"
	"github.com/city-competition-remastered/backend/internal/monetization"
)

func TestBattlePassClaimDoesNotRequirePremium(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	migrationsPath := os.Getenv("TEST_MIGRATIONS_PATH")
	if migrationsPath == "" {
		migrationsPath = filepath.Join("..", "..", "..", "migrations")
	}
	abs, err := filepath.Abs(migrationsPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := migrate.Up(dsn, abs); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	id := uuid.New()
	phone := "+1555" + id.String()[24:]
	username := "bp" + id.String()[:10]
	_, err = pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date)
		VALUES ($1, $2, $3, DATE '2000-01-01')
	`, id, phone, username)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_battle_pass_claims WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_battle_pass WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_cosmetics WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_ledger WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_accounts WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_xp WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})

	svc := &monetization.BattlePassService{
		Pool:   pool,
		Wallet: &credits.Wallet{Pool: pool},
	}
	ctx := context.Background()

	status, err := svc.Status(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Enrolled || status.Premium {
		t.Fatalf("status=%+v want enrolled free track", status)
	}

	// Tier 1 requires 0 XP — claimable without supporting any province.
	result, err := svc.Claim(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.ClaimedTierIDs) < 1 {
		t.Fatalf("expected at least tier 1 claim: %+v", result)
	}
	found := false
	for _, c := range result.Cosmetics {
		if c == "banner_starter" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected banner_starter cosmetic, got %+v", result)
	}
}
