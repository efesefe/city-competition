package providers_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/payments/internal/providers"
)

func TestMockIyzicoChargeAndWebhookRoundTrip(t *testing.T) {
	mock := &providers.MockIyzico{
		SecretKey:  providers.DefaultMockIyzicoSecret,
		PublicBase: "http://localhost:8081",
	}
	intentID := uuid.New().String()
	result, err := mock.Charge(context.Background(), providers.ChargeRequest{
		UserID:         uuid.New(),
		ProductID:      "pack_100",
		Credits:        100,
		AmountKurus:    4999,
		ReturnURL:      "http://localhost:3000/profile/topup?checkout=1",
		ConversationID: intentID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ProviderPaymentID == "" || result.CheckoutURL == "" {
		t.Fatalf("result=%+v", result)
	}
	if !contains(result.CheckoutURL, "/v1/mock-checkout/"+intentID) {
		t.Fatalf("checkout_url=%s", result.CheckoutURL)
	}

	body, sig, err := mock.BuildSignedWebhook(intentID, result.ProviderPaymentID, "SUCCESS")
	if err != nil {
		t.Fatal(err)
	}
	headers := http.Header{}
	headers.Set("X-IYZ-SIGNATURE-V3", sig)
	if err := mock.VerifyWebhookSignature(headers, body); err != nil {
		t.Fatalf("verify: %v", err)
	}
	event, err := mock.ParseWebhook(body)
	if err != nil {
		t.Fatal(err)
	}
	if event.Status != "succeeded" || event.ConversationID != intentID {
		t.Fatalf("event=%+v", event)
	}
}

func TestMockIyzicoRejectsBadSignature(t *testing.T) {
	mock := &providers.MockIyzico{SecretKey: "secret"}
	body, _, err := mock.BuildSignedWebhook(uuid.New().String(), "tok", "SUCCESS")
	if err != nil {
		t.Fatal(err)
	}
	headers := http.Header{}
	headers.Set("X-IYZ-SIGNATURE-V3", "deadbeef")
	if err := mock.VerifyWebhookSignature(headers, body); err != providers.ErrInvalidSignature {
		t.Fatalf("want ErrInvalidSignature got %v", err)
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 ||
		(len(s) > 0 && (func() bool {
			for i := 0; i+len(sub) <= len(s); i++ {
				if s[i:i+len(sub)] == sub {
					return true
				}
			}
			return false
		})()))
}
