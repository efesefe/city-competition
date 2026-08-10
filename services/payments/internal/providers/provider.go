package providers

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"
)

// Provider names used in routes and persistence.
const (
	NameIyzico     = "iyzico"
	NamePapara     = "papara"
	NameBKMExpress = "bkm_express"
)

var (
	ErrInvalidSignature = errors.New("invalid_webhook_signature")
	ErrProviderHTTP     = errors.New("provider_http_error")
	ErrUnknownProvider  = errors.New("unknown_provider")
	ErrNotSucceeded     = errors.New("payment_not_succeeded")
)

// ChargeRequest starts a hosted/tokenized checkout. Never includes raw card data.
type ChargeRequest struct {
	UserID         uuid.UUID
	ProductID      string
	Credits        int64
	AmountKurus    int64
	Currency       string
	IdempotencyKey string
	ReturnURL      string
	CallbackURL    string // provider webhook / notification URL
	ConversationID string // merchant reference (payment intent id)
}

// ChargeResult is the hosted checkout session returned by a PSP.
type ChargeResult struct {
	ProviderPaymentID string
	CheckoutURL       string
}

// RefundRequest reverses a previously succeeded charge.
type RefundRequest struct {
	ProviderPaymentID string
	AmountKurus       int64
	Currency          string
	IdempotencyKey    string
}

// RefundResult is the provider's refund acknowledgement.
type RefundResult struct {
	ProviderRefundID string
}

// WebhookEvent is a normalized payment notification after signature verification.
type WebhookEvent struct {
	ProviderPaymentID string
	ConversationID    string
	Status            string // succeeded | failed
}

// PaymentProvider is the PCI-scoped PSP adapter.
type PaymentProvider interface {
	Name() string
	Charge(ctx context.Context, req ChargeRequest) (ChargeResult, error)
	Refund(ctx context.Context, req RefundRequest) (RefundResult, error)
	VerifyWebhookSignature(headers http.Header, body []byte) error
	ParseWebhook(body []byte) (WebhookEvent, error)
}

// Registry maps provider name → implementation.
type Registry map[string]PaymentProvider

// Get returns a provider or ErrUnknownProvider.
func (r Registry) Get(name string) (PaymentProvider, error) {
	p, ok := r[name]
	if !ok || p == nil {
		return nil, ErrUnknownProvider
	}
	return p, nil
}
