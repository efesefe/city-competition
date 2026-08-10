package providers_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/payments/internal/providers"
)

func TestPaparaChargeHostedCheckout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/payments" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("ApiKey") != "api-key" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"succeeded": true,
			"data": map[string]any{
				"id":         "payment-1",
				"paymentUrl": "https://merchant.test.papara.com/pay/payment-1",
			},
		})
	}))
	t.Cleanup(srv.Close)

	p := &providers.Papara{
		APIKey:    "api-key",
		SecretKey: "sec",
		BaseURL:   srv.URL,
		HTTP:      srv.Client(),
	}
	res, err := p.Charge(context.Background(), providers.ChargeRequest{
		UserID:         uuid.New(),
		ProductID:      "credits_100",
		Credits:        100,
		AmountKurus:    999,
		Currency:       "TRY",
		IdempotencyKey: "idem-1",
		ReturnURL:      "https://app/return",
		CallbackURL:    "https://payments/v1/webhooks/papara",
		ConversationID: uuid.NewString(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.ProviderPaymentID != "payment-1" || res.CheckoutURL == "" {
		t.Fatalf("result=%+v", res)
	}
}

func TestBKMChargeHostedCheckout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ticketId":    "ticket-9",
			"checkoutUrl": "https://bkm.test/checkout/ticket-9",
		})
	}))
	t.Cleanup(srv.Close)
	p := &providers.BKMExpress{APIKey: "k", SecretKey: "s", BaseURL: srv.URL, HTTP: srv.Client()}
	res, err := p.Charge(context.Background(), providers.ChargeRequest{
		UserID: uuid.New(), ProductID: "credits_100", Credits: 100, AmountKurus: 999,
		ConversationID: "ord-1", ReturnURL: "https://app", CallbackURL: "https://cb",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.ProviderPaymentID != "ticket-9" {
		t.Fatalf("%+v", res)
	}
}
