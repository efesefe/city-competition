package credits

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/migrate"
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
	// Unique E.164-ish phone; last 12 hex digits of UUID keep it unique within tests.
	phone := "+1555" + id.String()[24:]
	username := "u" + id.String()[:12]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date)
		VALUES ($1, $2, $3, DATE '2000-01-01')
	`, id, phone, username)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_ledger WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_accounts WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func TestGrantCreditsIdempotent(t *testing.T) {
	pool := testPool(t)
	w := &Wallet{Pool: pool}
	userID := seedUser(t, pool)
	ctx := context.Background()

	in := ApplyInput{
		UserID:         userID,
		Amount:         50,
		Reason:         ReasonStubGrant,
		IdempotencyKey: "idem-grant-" + userID.String(),
	}

	b1, err := w.GrantCredits(ctx, in)
	if err != nil {
		t.Fatalf("first grant: %v", err)
	}
	if b1 != 50 {
		t.Fatalf("balance_after=%d want 50", b1)
	}

	b2, err := w.GrantCredits(ctx, in)
	if err != nil {
		t.Fatalf("second grant: %v", err)
	}
	if b2 != 50 {
		t.Fatalf("idempotent balance_after=%d want 50", b2)
	}

	bal, err := w.GetBalance(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if bal != 50 {
		t.Fatalf("stored balance=%d want 50 (double-credit)", bal)
	}
}

func TestSpendCreditsInsufficientFunds(t *testing.T) {
	pool := testPool(t)
	w := &Wallet{Pool: pool}
	userID := seedUser(t, pool)
	ctx := context.Background()

	_, err := w.SpendCredits(ctx, ApplyInput{
		UserID:         userID,
		Amount:         1,
		Reason:         ReasonSupportSpend,
		IdempotencyKey: "spend-empty-" + userID.String(),
	})
	if !errors.Is(err, ErrInsufficientCredits) {
		t.Fatalf("err=%v want ErrInsufficientCredits", err)
	}
}

func TestConcurrentSpendsNeverNegative(t *testing.T) {
	pool := testPool(t)
	w := &Wallet{Pool: pool}
	userID := seedUser(t, pool)
	ctx := context.Background()

	if _, err := w.GrantCredits(ctx, ApplyInput{
		UserID:         userID,
		Amount:         10,
		Reason:         ReasonStubGrant,
		IdempotencyKey: "seed-balance-" + userID.String(),
	}); err != nil {
		t.Fatalf("seed grant: %v", err)
	}

	const n = 50
	var (
		wg       sync.WaitGroup
		okSpends atomic.Int64
		negSeen  atomic.Bool
	)
	wg.Add(n)
	for i := 0; i < n; i++ {
		i := i
		go func() {
			defer wg.Done()
			_, err := w.SpendCredits(ctx, ApplyInput{
				UserID:         userID,
				Amount:         1,
				Reason:         ReasonSupportSpend,
				IdempotencyKey: fmt.Sprintf("spend-%s-%d", userID.String(), i),
			})
			switch {
			case err == nil:
				okSpends.Add(1)
			case errors.Is(err, ErrInsufficientCredits):
				// expected for oversubscription
			default:
				t.Errorf("unexpected spend err: %v", err)
			}
			bal, gerr := w.GetBalance(ctx, userID)
			if gerr == nil && bal < 0 {
				negSeen.Store(true)
			}
		}()
	}
	wg.Wait()

	if negSeen.Load() {
		t.Fatal("observed negative balance during concurrent spends")
	}
	bal, err := w.GetBalance(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if bal < 0 {
		t.Fatalf("final balance=%d is negative", bal)
	}
	if okSpends.Load() > 10 {
		t.Fatalf("successful spends=%d want <= 10", okSpends.Load())
	}
	if bal != 10-okSpends.Load() {
		t.Fatalf("balance=%d successful=%d inconsistent", bal, okSpends.Load())
	}
}
