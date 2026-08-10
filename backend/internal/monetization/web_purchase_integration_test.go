package monetization

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/credits"
	"github.com/city-competition-remastered/backend/internal/migrate"
)

func webTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
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
		t.Fatalf("abs: %v", err)
	}
	if err := migrate.Up(dsn, abs); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func seedWebUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	phone := "+1556" + id.String()[24:]
	username := "w" + id.String()[:12]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date)
		VALUES ($1, $2, $3, DATE '2000-01-01')
	`, id, phone, username)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM invoices WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM web_purchases WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_ledger WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_accounts WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func TestWebPurchaseGrantCreditsIdempotent(t *testing.T) {
	pool := webTestPool(t)
	userID := seedWebUser(t, pool)
	svc := &WebPurchaseService{
		Pool:   pool,
		Wallet: &credits.Wallet{Pool: pool},
		Packs:  &PackStore{Pool: pool},
	}
	intentID := uuid.New()
	in := CreditGrantInput{
		UserID:            userID,
		Credits:           100,
		ProductID:         "credits_100",
		Provider:          ProviderIyzico,
		ProviderPaymentID: "iyzi-" + uuid.NewString(),
		PaymentIntentID:   intentID,
	}
	r1, err := svc.GrantFromPayments(context.Background(), in)
	if err != nil {
		t.Fatalf("first grant: %v", err)
	}
	if r1.CreditsGranted != 100 || r1.AlreadyGranted {
		t.Fatalf("first=%+v", r1)
	}
	r2, err := svc.GrantFromPayments(context.Background(), in)
	if err != nil {
		t.Fatalf("second grant: %v", err)
	}
	if !r2.AlreadyGranted || r2.BalanceAfter != r1.BalanceAfter {
		t.Fatalf("second=%+v first=%+v", r2, r1)
	}
}
