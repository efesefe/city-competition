// Package monetization implements credit-pack IAP verification and optional battle pass.
package monetization

import (
	"context"
	"errors"
)

// Provider identifies the app store.
type Provider string

const (
	ProviderApple  Provider = "apple"
	ProviderGoogle Provider = "google"
)

var (
	// ErrInvalidReceipt is returned when store validation fails or the receipt is forged.
	ErrInvalidReceipt = errors.New("invalid_receipt")
	// ErrUnknownProduct is returned when the product_id is not in credit_packs.
	ErrUnknownProduct = errors.New("unknown_product")
	// ErrProductMismatch is returned when the verified product differs from the requested one.
	ErrProductMismatch = errors.New("product_mismatch")
	// ErrInvalidProvider is returned for unsupported providers.
	ErrInvalidProvider = errors.New("invalid_provider")
	// ErrMissingReceipt is returned when the client omits receipt/token material.
	ErrMissingReceipt = errors.New("missing_receipt")
	// ErrVerifierUnavailable is returned when store credentials are not configured.
	ErrVerifierUnavailable = errors.New("verifier_unavailable")
	// ErrNoActiveSeason is returned when no battle-pass season is active.
	ErrNoActiveSeason = errors.New("no_active_season")
	// ErrTierNotEligible is returned when XP is insufficient or the tier was already claimed.
	ErrTierNotEligible = errors.New("tier_not_eligible")
)

// VerifiedPurchase is the trusted result of server-side receipt validation.
// TransactionID and ProductID always come from the store — never from the client.
type VerifiedPurchase struct {
	Provider      Provider
	ProductID     string
	TransactionID string
}

// ReceiptInput is the raw material the client sends for verification.
// Client-reported success, credits, or transaction_id must be ignored for granting.
type ReceiptInput struct {
	Provider      Provider
	ProductID     string
	ReceiptData   string // Apple base64 receipt or signed transaction JWS
	PurchaseToken string // Google Play purchase token
	PackageName   string // Google Play package name (optional if configured)
}

// ReceiptVerifier validates purchases with Apple/Google. Implementations must not
// trust client-reported success or amounts.
type ReceiptVerifier interface {
	Verify(ctx context.Context, in ReceiptInput) (VerifiedPurchase, error)
}
