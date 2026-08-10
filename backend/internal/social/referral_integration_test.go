package social_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/credits"
	"github.com/city-competition-remastered/backend/internal/migrate"
	"github.com/city-competition-remastered/backend/internal/social"
)

func referralTestPool(t *testing.T) *pgxpool.Pool {
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

func seedReferralUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date)
		VALUES ($1, $2, $3, DATE '2000-01-01')
	`, id, "+1999"+id.String()[24:], "f"+id.String()[:12])
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM flagged_users WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM referral_redemptions WHERE referrer_id = $1 OR referee_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM referral_codes WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_device_fingerprints WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_ledger WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_accounts WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func TestSameDeviceReferral_Flagged_CreditsWithheld(t *testing.T) {
	pool := referralTestPool(t)
	referrer := seedReferralUser(t, pool)
	referee := seedReferralUser(t, pool)
	store := &social.PoolStore{Pool: pool}
	svc := &social.ReferralService{
		Pool:   pool,
		Wallet: &credits.Wallet{Pool: pool},
		Store:  store,
		Amount: 100,
	}

	rc, err := svc.EnsureCode(context.Background(), referrer)
	if err != nil {
		t.Fatalf("EnsureCode: %v", err)
	}
	fp := "same-device-fp-" + referrer.String()
	if err := svc.RecordFingerprint(context.Background(), referrer, fp); err != nil {
		t.Fatalf("RecordFingerprint: %v", err)
	}

	red, err := svc.Redeem(context.Background(), referee, rc.Code, fp)
	if err == nil {
		t.Fatal("expected ErrReferralFlagged")
	}
	if err != social.ErrReferralFlagged {
		t.Fatalf("err=%v want ErrReferralFlagged", err)
	}
	if red.Status != "flagged" {
		t.Fatalf("status=%s", red.Status)
	}

	wallet := &credits.Wallet{Pool: pool}
	balRef, _ := wallet.GetBalance(context.Background(), referrer)
	balRee, _ := wallet.GetBalance(context.Background(), referee)
	if balRef != 0 || balRee != 0 {
		t.Fatalf("balances referrer=%d referee=%d want 0", balRef, balRee)
	}

	var flagged int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM flagged_users WHERE user_id = $1 AND reason = 'referral_same_device'
	`, referee).Scan(&flagged); err != nil {
		t.Fatal(err)
	}
	if flagged != 1 {
		t.Fatalf("flagged_users count=%d want 1", flagged)
	}
}
