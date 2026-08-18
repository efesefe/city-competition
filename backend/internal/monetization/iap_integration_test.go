package monetization

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/credits"
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
	abs, err := filepath.Abs(migrationsPath)
	if err != nil {
		t.Fatalf("migrations abs: %v", err)
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

func seedUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.New()
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
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_battle_pass_claims WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_battle_pass WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_cosmetics WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM invoices WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM iap_purchases WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM purchase_promos WHERE created_by = $1 OR deactivated_by = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_ledger WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_accounts WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_xp WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func TestCreditsForProductMapsExpectedAmount(t *testing.T) {
	pool := testPool(t)
	store := &PackStore{Pool: pool}
	ctx := context.Background()

	cases := []struct {
		provider  Provider
		productID string
		want      int64
	}{
		{ProviderApple, "credits_100", 100},
		{ProviderApple, "credits_500", 500},
		{ProviderGoogle, "credits_1200", 1200},
	}
	for _, tc := range cases {
		got, err := store.CreditsForProduct(ctx, tc.provider, tc.productID)
		if err != nil {
			t.Fatalf("%s/%s: %v", tc.provider, tc.productID, err)
		}
		if got != tc.want {
			t.Fatalf("%s/%s credits=%d want %d", tc.provider, tc.productID, got, tc.want)
		}
	}

	_, err := store.CreditsForProduct(ctx, ProviderApple, "does_not_exist")
	if !errors.Is(err, ErrUnknownProduct) {
		t.Fatalf("unknown product err=%v want ErrUnknownProduct", err)
	}
}

func TestForgedClientPurchaseSuccessRejected(t *testing.T) {
	pool := testPool(t)
	userID := seedUser(t, pool)
	wallet := &credits.Wallet{Pool: pool}
	svc := &Service{
		Pool:   pool,
		Wallet: wallet,
		Verifier: &StaticMapVerifier{ByToken: map[string]VerifiedPurchase{
			"valid-receipt": {
				Provider:      ProviderApple,
				ProductID:     "credits_100",
				TransactionID: "txn-valid-1",
			},
		}},
		Packs: &PackStore{Pool: pool},
	}
	ctx := context.Background()

	_, err := svc.VerifyAndGrant(ctx, userID, ReceiptInput{
		Provider:    ProviderApple,
		ProductID:   "credits_100",
		ReceiptData: "forged-garbage",
	})
	if !errors.Is(err, ErrInvalidReceipt) {
		t.Fatalf("err=%v want ErrInvalidReceipt", err)
	}

	bal, err := wallet.GetBalance(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if bal != 0 {
		t.Fatalf("balance=%d want 0 after forged purchase", bal)
	}

	var ledgerCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM credit_ledger WHERE user_id = $1`, userID).Scan(&ledgerCount); err != nil {
		t.Fatal(err)
	}
	if ledgerCount != 0 {
		t.Fatalf("ledger rows=%d want 0", ledgerCount)
	}
}

func TestDuplicateWebhookGrantsOnce(t *testing.T) {
	pool := testPool(t)
	userID := seedUser(t, pool)
	wallet := &credits.Wallet{Pool: pool}
	svc := &Service{
		Pool:     pool,
		Wallet:   wallet,
		Verifier: &StaticMapVerifier{ByToken: map[string]VerifiedPurchase{}},
		Packs:    &PackStore{Pool: pool},
	}
	ctx := context.Background()

	verified := VerifiedPurchase{
		Provider:      ProviderApple,
		ProductID:     "credits_100",
		TransactionID: "webhook-txn-" + userID.String(),
	}

	r1, err := svc.GrantVerified(ctx, userID, verified)
	if err != nil {
		t.Fatalf("first webhook: %v", err)
	}
	if r1.AlreadyGranted || r1.BalanceAfter != 100 || r1.CreditsGranted != 100 {
		t.Fatalf("first result=%+v", r1)
	}

	r2, err := svc.GrantVerified(ctx, userID, verified)
	if err != nil {
		t.Fatalf("duplicate webhook: %v", err)
	}
	if !r2.AlreadyGranted {
		t.Fatalf("second result should be already_granted: %+v", r2)
	}
	if r2.BalanceAfter != 100 {
		t.Fatalf("balance_after=%d want 100", r2.BalanceAfter)
	}

	bal, err := wallet.GetBalance(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if bal != 100 {
		t.Fatalf("stored balance=%d want 100 (double-credit)", bal)
	}

	var n int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM credit_ledger
		WHERE user_id = $1 AND reason = 'purchase' AND idempotency_key = $2
	`, userID, verified.TransactionID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("ledger purchase rows=%d want 1", n)
	}

	var purchases int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM iap_purchases WHERE provider_transaction_id = $1
	`, verified.TransactionID).Scan(&purchases); err != nil {
		t.Fatal(err)
	}
	if purchases != 1 {
		t.Fatalf("iap_purchases=%d want 1", purchases)
	}
}

func TestIAPGrantAppliesActivePromo(t *testing.T) {
	pool := testPool(t)
	userID := seedUser(t, pool)
	promos := &PromoStore{Pool: pool}
	if _, err := promos.Activate(context.Background(), userID, 50); err != nil {
		t.Fatalf("activate: %v", err)
	}
	wallet := &credits.Wallet{Pool: pool}
	svc := &Service{
		Pool:   pool,
		Wallet: wallet,
		Verifier: &StaticMapVerifier{ByToken: map[string]VerifiedPurchase{
			"promo-receipt": {
				Provider:      ProviderApple,
				ProductID:     "credits_100",
				TransactionID: "txn-promo-1",
			},
		}},
		Packs:  &PackStore{Pool: pool},
		Promos: promos,
	}
	r, err := svc.VerifyAndGrant(context.Background(), userID, ReceiptInput{
		Provider:    ProviderApple,
		ProductID:   "credits_100",
		ReceiptData: "promo-receipt",
	})
	if err != nil {
		t.Fatalf("grant: %v", err)
	}
	if r.CreditsGranted != 150 {
		t.Fatalf("granted=%d want 150", r.CreditsGranted)
	}
	bal, err := wallet.GetBalance(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	if bal != 150 {
		t.Fatalf("balance=%d want 150", bal)
	}
}
