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
		_, _ = pool.Exec(context.Background(), `DELETE FROM purchase_quotes WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM purchase_promos WHERE created_by = $1 OR deactivated_by = $1`, id)
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

func TestWebPurchaseCustomQuoteGrant(t *testing.T) {
	pool := webTestPool(t)
	userID := seedWebUser(t, pool)
	svc := &WebPurchaseService{
		Pool:   pool,
		Wallet: &credits.Wallet{Pool: pool},
		Packs:  &PackStore{Pool: pool},
	}
	intentID := uuid.New()
	if err := InsertQuote(context.Background(), pool, PurchaseQuote{
		PaymentIntentID: intentID,
		UserID:          userID,
		ProductID:       ProductCustom,
		BaseCredits:     75,
		BonusPercent:    0,
		Credits:         75,
		AmountKurus:     750,
	}); err != nil {
		t.Fatalf("quote: %v", err)
	}
	in := CreditGrantInput{
		UserID:            userID,
		Credits:           75,
		ProductID:         ProductCustom,
		Provider:          ProviderIyzico,
		ProviderPaymentID: "iyzi-custom-" + uuid.NewString(),
		PaymentIntentID:   intentID,
	}
	r, err := svc.GrantFromPayments(context.Background(), in)
	if err != nil {
		t.Fatalf("grant: %v", err)
	}
	if r.CreditsGranted != 75 {
		t.Fatalf("granted=%d want 75", r.CreditsGranted)
	}

	in.Credits = 76
	if _, err := svc.GrantFromPayments(context.Background(), in); err != ErrProductMismatch {
		t.Fatalf("mismatch err=%v want ErrProductMismatch", err)
	}
}

func TestWebPurchasePromoFrozenOnQuote(t *testing.T) {
	pool := webTestPool(t)
	userID := seedWebUser(t, pool)
	promos := &PromoStore{Pool: pool}
	if _, err := promos.Activate(context.Background(), userID, 50); err != nil {
		t.Fatalf("activate: %v", err)
	}
	svc := &WebPurchaseService{
		Pool:   pool,
		Wallet: &credits.Wallet{Pool: pool},
		Packs:  &PackStore{Pool: pool},
		Promos: promos,
	}
	intentID := uuid.New()
	if err := InsertQuote(context.Background(), pool, PurchaseQuote{
		PaymentIntentID: intentID,
		UserID:          userID,
		ProductID:       "credits_100",
		BaseCredits:     100,
		BonusPercent:    50,
		Credits:         150,
		AmountKurus:     999,
	}); err != nil {
		t.Fatalf("quote: %v", err)
	}
	if _, err := promos.Deactivate(context.Background(), userID); err != nil {
		t.Fatalf("deactivate: %v", err)
	}
	in := CreditGrantInput{
		UserID:            userID,
		Credits:           150,
		ProductID:         "credits_100",
		Provider:          ProviderIyzico,
		ProviderPaymentID: "iyzi-promo-" + uuid.NewString(),
		PaymentIntentID:   intentID,
	}
	r, err := svc.GrantFromPayments(context.Background(), in)
	if err != nil {
		t.Fatalf("grant: %v", err)
	}
	if r.CreditsGranted != 150 {
		t.Fatalf("granted=%d want 150 frozen promo", r.CreditsGranted)
	}

	noQuote := CreditGrantInput{
		UserID:            userID,
		Credits:           150,
		ProductID:         "credits_100",
		Provider:          ProviderIyzico,
		ProviderPaymentID: "iyzi-noquote-" + uuid.NewString(),
		PaymentIntentID:   uuid.New(),
	}
	if _, err := svc.GrantFromPayments(context.Background(), noQuote); err != ErrProductMismatch {
		t.Fatalf("no-quote mismatch err=%v", err)
	}
}

func TestCustomGrantRequiresQuote(t *testing.T) {
	pool := webTestPool(t)
	userID := seedWebUser(t, pool)
	svc := &WebPurchaseService{
		Pool:   pool,
		Wallet: &credits.Wallet{Pool: pool},
		Packs:  &PackStore{Pool: pool},
	}
	_, err := svc.GrantFromPayments(context.Background(), CreditGrantInput{
		UserID:            userID,
		Credits:           75,
		ProductID:         ProductCustom,
		Provider:          ProviderIyzico,
		ProviderPaymentID: "iyzi-noquote-custom-" + uuid.NewString(),
		PaymentIntentID:   uuid.New(),
	})
	if err != ErrUnknownProduct {
		t.Fatalf("err=%v want ErrUnknownProduct", err)
	}
}

