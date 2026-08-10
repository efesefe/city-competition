package monetization

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/credits"
	"github.com/city-competition-remastered/backend/internal/migrate"
)

func invoiceTestPool(t *testing.T) *pgxpool.Pool {
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

func seedInvoiceUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	phone := "+1557" + id.String()[24:]
	username := "inv" + id.String()[:10]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date)
		VALUES ($1, $2, $3, DATE '2000-01-01')
	`, id, phone, username)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM flagged_users WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM invoices WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM web_purchases WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_ledger WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_accounts WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func TestInvoiceSnapshotUnaffectedByLaterKDVRateChange(t *testing.T) {
	pool := invoiceTestPool(t)
	userID := seedInvoiceUser(t, pool)
	writer := &InvoiceWriter{KDVRateBPS: 2000}

	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	sourceID := uuid.New()
	inv, err := writer.WriteOnTx(context.Background(), tx, userID, SourceWebPurchase, sourceID, 12000)
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := tx.Commit(context.Background()); err != nil {
		t.Fatalf("commit: %v", err)
	}

	writer.KDVRateBPS = 1000 // later config change must not rewrite snapshot

	var rate int
	var net, tax, gross int64
	err = pool.QueryRow(context.Background(), `
		SELECT kdv_rate_bps, net_kurus, tax_kurus, gross_kurus
		FROM invoices WHERE id = $1
	`, inv.ID).Scan(&rate, &net, &tax, &gross)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if rate != 2000 || net != 10000 || tax != 2000 || gross != 12000 {
		t.Fatalf("snapshot mutated: rate=%d net=%d tax=%d gross=%d", rate, net, tax, gross)
	}
	if writer.KDVRateBPS != 1000 {
		t.Fatalf("writer rate should be mutated in memory")
	}
}

func TestRefundCallsPaymentsServiceNotLocalPaymentMutation(t *testing.T) {
	pool := invoiceTestPool(t)
	userID := seedInvoiceUser(t, pool)

	paymentsHits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/refunds" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("X-Internal-Token") != "test-token" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		paymentsHits++
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["payment_intent_id"] == "" || body["idempotency_key"] == "" {
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"provider_refund_id": "rf_1"})
	}))
	t.Cleanup(srv.Close)

	web := &WebPurchaseService{
		Pool:     pool,
		Wallet:   &credits.Wallet{Pool: pool},
		Packs:    &PackStore{Pool: pool},
		Invoices: &InvoiceWriter{KDVRateBPS: 2000},
	}
	intentID := uuid.New()
	grant, err := web.GrantFromPayments(context.Background(), CreditGrantInput{
		UserID:            userID,
		Credits:           100,
		ProductID:         "credits_100",
		Provider:          ProviderIyzico,
		ProviderPaymentID: "iyzi-refund-" + uuid.NewString(),
		PaymentIntentID:   intentID,
	})
	if err != nil {
		t.Fatalf("grant: %v", err)
	}

	refunds := &RefundService{
		Pool:          pool,
		Wallet:        &credits.Wallet{Pool: pool},
		PaymentsURL:   srv.URL,
		InternalToken: "test-token",
		HTTP:          srv.Client(),
	}
	res, err := refunds.RefundWebPurchase(context.Background(), grant.PurchaseID, "idem-"+uuid.NewString())
	if err != nil {
		t.Fatalf("refund: %v", err)
	}
	if paymentsHits != 1 {
		t.Fatalf("payments hits=%d want 1", paymentsHits)
	}
	if res.CreditsReversed != 100 || res.BalanceAfter != 0 {
		t.Fatalf("refund result=%+v", res)
	}

	var status string
	if err := pool.QueryRow(context.Background(), `
		SELECT status FROM web_purchases WHERE id = $1
	`, grant.PurchaseID).Scan(&status); err != nil {
		t.Fatalf("status: %v", err)
	}
	if status != "refunded" {
		t.Fatalf("status=%s", status)
	}
	var invStatus string
	if err := pool.QueryRow(context.Background(), `
		SELECT status FROM invoices WHERE source_type = 'web_purchase' AND source_id = $1
	`, grant.PurchaseID).Scan(&invStatus); err != nil {
		t.Fatalf("invoice: %v", err)
	}
	if invStatus != "refunded" {
		t.Fatalf("invoice status=%s", invStatus)
	}
	var refundRows int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM credit_ledger
		WHERE user_id = $1 AND reason = 'refund'
	`, userID).Scan(&refundRows); err != nil {
		t.Fatalf("ledger: %v", err)
	}
	if refundRows != 1 {
		t.Fatalf("refund ledger rows=%d", refundRows)
	}
}

func TestRefundReversesOnlyUnspentCredits(t *testing.T) {
	pool := invoiceTestPool(t)
	userID := seedInvoiceUser(t, pool)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"provider_refund_id": "rf_2"})
	}))
	t.Cleanup(srv.Close)

	wallet := &credits.Wallet{Pool: pool}
	web := &WebPurchaseService{
		Pool:     pool,
		Wallet:   wallet,
		Packs:    &PackStore{Pool: pool},
		Invoices: &InvoiceWriter{KDVRateBPS: 2000},
	}
	grant, err := web.GrantFromPayments(context.Background(), CreditGrantInput{
		UserID:            userID,
		Credits:           100,
		ProductID:         "credits_100",
		Provider:          ProviderIyzico,
		ProviderPaymentID: "iyzi-partial-" + uuid.NewString(),
		PaymentIntentID:   uuid.New(),
	})
	if err != nil {
		t.Fatalf("grant: %v", err)
	}
	if _, err := wallet.SpendCredits(context.Background(), credits.ApplyInput{
		UserID:         userID,
		Amount:         40,
		Reason:         credits.ReasonSupportSpend,
		RefType:        "support",
		RefID:          uuid.NewString(),
		IdempotencyKey: "spend-" + uuid.NewString(),
	}); err != nil {
		t.Fatalf("spend: %v", err)
	}

	refunds := &RefundService{
		Pool:          pool,
		Wallet:        wallet,
		PaymentsURL:   srv.URL,
		InternalToken: "tok",
		HTTP:          srv.Client(),
	}
	res, err := refunds.RefundWebPurchase(context.Background(), grant.PurchaseID, "idem-partial")
	if err != nil {
		t.Fatalf("refund: %v", err)
	}
	if res.CreditsReversed != 60 || res.BalanceAfter != 0 {
		t.Fatalf("want clawback 60, got %+v", res)
	}
	var supportSpend int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM credit_ledger
		WHERE user_id = $1 AND reason = 'support_spend' AND delta = -40
	`, userID).Scan(&supportSpend); err != nil {
		t.Fatalf("support ledger: %v", err)
	}
	if supportSpend != 1 {
		t.Fatalf("support spend rows=%d (must not be clawed back)", supportSpend)
	}
}

func TestChargebackCreatesModerationQueueNotBan(t *testing.T) {
	pool := invoiceTestPool(t)
	userID := seedInvoiceUser(t, pool)

	web := &WebPurchaseService{
		Pool:     pool,
		Wallet:   &credits.Wallet{Pool: pool},
		Packs:    &PackStore{Pool: pool},
		Invoices: &InvoiceWriter{KDVRateBPS: 2000},
	}
	intentID := uuid.New()
	grant, err := web.GrantFromPayments(context.Background(), CreditGrantInput{
		UserID:            userID,
		Credits:           100,
		ProductID:         "credits_100",
		Provider:          ProviderIyzico,
		ProviderPaymentID: "iyzi-cb-" + uuid.NewString(),
		PaymentIntentID:   intentID,
	})
	if err != nil {
		t.Fatalf("grant: %v", err)
	}

	refunds := &RefundService{
		Pool:   pool,
		Wallet: &credits.Wallet{Pool: pool},
	}
	res, err := refunds.HandleChargeback(context.Background(), intentID, "")
	if err != nil {
		t.Fatalf("chargeback: %v", err)
	}
	if res.CreditsReversed != 100 {
		t.Fatalf("credits reversed=%d", res.CreditsReversed)
	}

	var flagged int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM flagged_users
		WHERE user_id = $1 AND reason = 'chargeback' AND status = 'pending'
	`, userID).Scan(&flagged); err != nil {
		t.Fatalf("flagged: %v", err)
	}
	if flagged != 1 {
		t.Fatalf("flagged_users=%d want 1", flagged)
	}

	var status string
	if err := pool.QueryRow(context.Background(), `
		SELECT status::text FROM users WHERE id = $1
	`, userID).Scan(&status); err != nil {
		t.Fatalf("user status: %v", err)
	}
	if status != "active" {
		t.Fatalf("user status=%s want active (must not auto-ban)", status)
	}

	var purchaseStatus string
	_ = pool.QueryRow(context.Background(), `
		SELECT status FROM web_purchases WHERE id = $1
	`, grant.PurchaseID).Scan(&purchaseStatus)
	if purchaseStatus != "refunded" {
		t.Fatalf("purchase status=%s", purchaseStatus)
	}
}
