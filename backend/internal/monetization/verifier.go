package monetization

import (
	"context"
	"strings"
)

// CompositeVerifier routes verification to Apple or Google implementations.
type CompositeVerifier struct {
	Apple  ReceiptVerifier
	Google ReceiptVerifier
}

// Verify dispatches by provider.
func (v *CompositeVerifier) Verify(ctx context.Context, in ReceiptInput) (VerifiedPurchase, error) {
	switch Provider(strings.ToLower(strings.TrimSpace(string(in.Provider)))) {
	case ProviderApple:
		if v.Apple == nil {
			return VerifiedPurchase{}, ErrVerifierUnavailable
		}
		return v.Apple.Verify(ctx, in)
	case ProviderGoogle:
		if v.Google == nil {
			return VerifiedPurchase{}, ErrVerifierUnavailable
		}
		return v.Google.Verify(ctx, in)
	default:
		return VerifiedPurchase{}, ErrInvalidProvider
	}
}

// StaticMapVerifier is a test/dev helper that accepts known receipt tokens.
// Never wire this in production from client flags.
type StaticMapVerifier struct {
	// Keyed by receipt data or purchase token → verified purchase.
	ByToken map[string]VerifiedPurchase
}

// Verify looks up the receipt/token in the map; missing entries are invalid.
func (v *StaticMapVerifier) Verify(ctx context.Context, in ReceiptInput) (VerifiedPurchase, error) {
	_ = ctx
	key := strings.TrimSpace(in.ReceiptData)
	if key == "" {
		key = strings.TrimSpace(in.PurchaseToken)
	}
	if key == "" {
		return VerifiedPurchase{}, ErrMissingReceipt
	}
	if v.ByToken == nil {
		return VerifiedPurchase{}, ErrInvalidReceipt
	}
	got, ok := v.ByToken[key]
	if !ok {
		return VerifiedPurchase{}, ErrInvalidReceipt
	}
	if in.ProductID != "" && got.ProductID != in.ProductID {
		return VerifiedPurchase{}, ErrProductMismatch
	}
	got.Provider = in.Provider
	return got, nil
}
