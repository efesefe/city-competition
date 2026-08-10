package webhook_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/city-competition-remastered/payments/internal/checkout"
	"github.com/city-competition-remastered/payments/internal/providers"
	"github.com/city-competition-remastered/payments/internal/webhook"
)

func TestWebhookHandlerRejectsBadSignatureWithoutDB(t *testing.T) {
	registry := providers.Registry{
		providers.NameIyzico: &providers.Iyzico{SecretKey: "secret"},
	}
	h := &webhook.Handler{
		Checkout:  &checkout.Service{Providers: registry},
		Providers: registry,
	}
	body := []byte(`{"iyziEventType":"CHECKOUT_FORM_AUTH","token":"t","paymentConversationId":"c","status":"SUCCESS","iyziPaymentId":"1"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/webhooks/iyzico", bytes.NewReader(body))
	req.SetPathValue("provider", "iyzico")
	req.Header.Set("X-IYZ-SIGNATURE-V3", "bad")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401", rec.Code)
	}
}
