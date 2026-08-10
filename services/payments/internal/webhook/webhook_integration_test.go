package webhook_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/payments/internal/checkout"
	"github.com/city-competition-remastered/payments/internal/emit"
	"github.com/city-competition-remastered/payments/internal/migrate"
	"github.com/city-competition-remastered/payments/internal/providers"
	"github.com/city-competition-remastered/payments/internal/webhook"
)

func testPaymentsPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_PAYMENTS_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_PAYMENTS_DATABASE_URL not set")
	}
	migrationsPath := os.Getenv("TEST_PAYMENTS_MIGRATIONS_PATH")
	if migrationsPath == "" {
		migrationsPath = filepath.Join("..", "..", "migrations")
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

func TestInvalidWebhookSignatureRejected(t *testing.T) {
	pool := testPaymentsPool(t)
	secret := "whsec"
	registry := providers.Registry{
		providers.NamePapara: &providers.Papara{SecretKey: secret},
	}
	svc := &checkout.Service{Pool: pool, Providers: registry, WebhookBase: "http://payments.test"}
	h := &webhook.Handler{Checkout: svc, Providers: registry}

	body := []byte(`{"id":"x","referenceId":"` + uuid.NewString() + `","status":1}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/webhooks/papara", bytes.NewReader(body))
	req.SetPathValue("provider", "papara")
	req.Header.Set("X-Papara-Signature", "invalid")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401 body=%s", rec.Code, rec.Body.String())
	}
}

func TestSuccessfulChargeWebhookEmitsCreditGrantWithoutGameTables(t *testing.T) {
	pool := testPaymentsPool(t)
	secret := "papara-test-secret"
	userID := uuid.New()
	intentID := uuid.New()

	var grantBodies [][]byte
	grantSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/internal/payments/credit-grant" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("X-Internal-Token") != "tok" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		grantBodies = append(grantBodies, raw)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"balance_after":100,"credits_granted":100}`))
	}))
	t.Cleanup(grantSrv.Close)

	psp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"succeeded": true,
			"data": map[string]any{
				"id":         "pay-abc",
				"paymentUrl": "https://papara.test/pay/abc",
			},
		})
	}))
	t.Cleanup(psp.Close)

	papara := &providers.Papara{
		APIKey:    "key",
		SecretKey: secret,
		BaseURL:   psp.URL,
		HTTP:      psp.Client(),
	}
	registry := providers.Registry{providers.NamePapara: papara}
	svc := &checkout.Service{Pool: pool, Providers: registry, WebhookBase: "http://payments.test"}
	emitter := &emit.Client{BaseURL: grantSrv.URL, InternalToken: "tok", HTTP: grantSrv.Client()}
	h := &webhook.Handler{Checkout: svc, Providers: registry, Emitter: emitter}

	// Seed intent as if Charge already persisted (conversation id = intent id).
	_, err := pool.Exec(context.Background(), `
		INSERT INTO payment_intents (
			id, user_id, provider, product_id, credits, amount_kurus, currency,
			status, provider_payment_id, checkout_url, idempotency_key
		) VALUES ($1,$2,'papara','credits_100',100,999,'TRY','pending','pay-abc','https://papara.test/pay/abc',$3)
	`, intentID, userID, "idem-"+intentID.String())
	if err != nil {
		t.Fatalf("seed intent: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM payment_intents WHERE id = $1`, intentID)
	})

	bodyObj := map[string]any{
		"id":          "pay-abc",
		"referenceId": intentID.String(),
		"status":      1,
	}
	body, _ := json.Marshal(bodyObj)
	sig := providers.SignBodyHMAC(secret, body)
	req := httptest.NewRequest(http.MethodPost, "/v1/webhooks/papara", bytes.NewReader(body))
	req.SetPathValue("provider", "papara")
	req.Header.Set("X-Papara-Signature", sig)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if len(grantBodies) != 1 {
		t.Fatalf("grant calls=%d want 1", len(grantBodies))
	}
	var payload emit.CreditGrantPayload
	if err := json.Unmarshal(grantBodies[0], &payload); err != nil {
		t.Fatal(err)
	}
	if payload.UserID != userID || payload.Credits != 100 || payload.ProviderPaymentID != "pay-abc" {
		t.Fatalf("payload=%+v", payload)
	}

	// Payments DB must not contain game ledger tables.
	var exists bool
	err = pool.QueryRow(context.Background(), `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name IN ('credit_ledger','credit_accounts','tribe_province_scores')
		)
	`).Scan(&exists)
	if err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Fatal("payments DB must not contain game tables")
	}

	srcRoot := filepath.Join("..", "..")
	err = filepath.Walk(srcRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if bytes.Contains(data, []byte("credit_ledger")) || bytes.Contains(data, []byte("credit_accounts")) {
			t.Errorf("payments service must not reference game credit tables: %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
