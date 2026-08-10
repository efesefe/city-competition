package providers_test

import (
	"net/http"
	"testing"

	"github.com/city-competition-remastered/payments/internal/providers"
)

func TestIyzicoRejectsInvalidWebhookSignature(t *testing.T) {
	p := &providers.Iyzico{SecretKey: "test-secret"}
	body := []byte(`{"iyziEventType":"CHECKOUT_FORM_AUTH","iyziPaymentId":"1","token":"tok","paymentConversationId":"c1","status":"SUCCESS"}`)
	headers := http.Header{}
	headers.Set("X-IYZ-SIGNATURE-V3", "deadbeef")
	if err := p.VerifyWebhookSignature(headers, body); err != providers.ErrInvalidSignature {
		t.Fatalf("err=%v want ErrInvalidSignature", err)
	}
}

func TestIyzicoAcceptsValidWebhookSignature(t *testing.T) {
	secret := "test-secret"
	p := &providers.Iyzico{SecretKey: secret}
	body := []byte(`{"iyziEventType":"CHECKOUT_FORM_AUTH","iyziPaymentId":"99","token":"tok-1","paymentConversationId":"conv-1","status":"SUCCESS"}`)
	sig := providers.IyzicoSignWebhookV3(secret, "CHECKOUT_FORM_AUTH", "99", "tok-1", "conv-1", "SUCCESS")
	headers := http.Header{}
	headers.Set("X-IYZ-SIGNATURE-V3", sig)
	if err := p.VerifyWebhookSignature(headers, body); err != nil {
		t.Fatalf("valid signature rejected: %v", err)
	}
}

func TestPaparaRejectsInvalidWebhookSignature(t *testing.T) {
	p := &providers.Papara{SecretKey: "papara-secret"}
	body := []byte(`{"id":"pay-1","referenceId":"ref","status":1}`)
	headers := http.Header{}
	headers.Set("X-Papara-Signature", "nope")
	if err := p.VerifyWebhookSignature(headers, body); err != providers.ErrInvalidSignature {
		t.Fatalf("err=%v want ErrInvalidSignature", err)
	}
}

func TestBKMRejectsInvalidWebhookSignature(t *testing.T) {
	p := &providers.BKMExpress{SecretKey: "bkm-secret"}
	body := []byte(`{"ticketId":"t1","orderId":"o1","status":"SUCCESS"}`)
	headers := http.Header{}
	headers.Set("X-BKM-Signature", "forged")
	if err := p.VerifyWebhookSignature(headers, body); err != providers.ErrInvalidSignature {
		t.Fatalf("err=%v want ErrInvalidSignature", err)
	}
}
