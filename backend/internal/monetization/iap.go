package monetization

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/credits"
)

// Service verifies IAP receipts and grants credits via the ledger.
type Service struct {
	Pool     *pgxpool.Pool
	Wallet   *credits.Wallet
	Verifier ReceiptVerifier
	Packs    *PackStore
}

// GrantResult is the outcome of a verified purchase grant.
type GrantResult struct {
	BalanceAfter   int64     `json:"balance_after"`
	CreditsGranted int64     `json:"credits_granted"`
	PurchaseID     uuid.UUID `json:"purchase_id"`
	AlreadyGranted bool      `json:"already_granted"`
}

// VerifyAndGrant validates the receipt server-side, maps product → credits, and
// grants with ledger reason purchase and idempotency_key = provider_transaction_id.
// Client-reported success / amounts / transaction IDs are never used for granting.
func (s *Service) VerifyAndGrant(ctx context.Context, userID uuid.UUID, in ReceiptInput) (GrantResult, error) {
	if s.Verifier == nil {
		return GrantResult{}, ErrVerifierUnavailable
	}
	provider := Provider(strings.ToLower(strings.TrimSpace(string(in.Provider))))
	in.Provider = provider
	in.ProductID = strings.TrimSpace(in.ProductID)

	if provider != ProviderApple && provider != ProviderGoogle {
		return GrantResult{}, ErrInvalidProvider
	}
	if in.ProductID == "" {
		return GrantResult{}, ErrUnknownProduct
	}
	if provider == ProviderApple && strings.TrimSpace(in.ReceiptData) == "" {
		return GrantResult{}, ErrMissingReceipt
	}
	if provider == ProviderGoogle && strings.TrimSpace(in.PurchaseToken) == "" {
		return GrantResult{}, ErrMissingReceipt
	}

	verified, err := s.Verifier.Verify(ctx, in)
	if err != nil {
		if errors.Is(err, ErrInvalidReceipt) || errors.Is(err, ErrVerifierUnavailable) ||
			errors.Is(err, ErrProductMismatch) || errors.Is(err, ErrInvalidProvider) ||
			errors.Is(err, ErrMissingReceipt) {
			return GrantResult{}, err
		}
		return GrantResult{}, fmt.Errorf("verify receipt: %w", err)
	}
	if verified.ProductID != in.ProductID {
		return GrantResult{}, ErrProductMismatch
	}

	return s.grantVerified(ctx, userID, verified)
}

// GrantVerified grants credits for an already store-validated purchase (e.g. webhook).
// Duplicate provider_transaction_id grants exactly once.
func (s *Service) GrantVerified(ctx context.Context, userID uuid.UUID, verified VerifiedPurchase) (GrantResult, error) {
	provider := Provider(strings.ToLower(strings.TrimSpace(string(verified.Provider))))
	verified.Provider = provider
	verified.ProductID = strings.TrimSpace(verified.ProductID)
	verified.TransactionID = strings.TrimSpace(verified.TransactionID)

	if provider != ProviderApple && provider != ProviderGoogle {
		return GrantResult{}, ErrInvalidProvider
	}
	if verified.ProductID == "" {
		return GrantResult{}, ErrUnknownProduct
	}
	if verified.TransactionID == "" {
		return GrantResult{}, ErrInvalidReceipt
	}
	return s.grantVerified(ctx, userID, verified)
}

func (s *Service) grantVerified(ctx context.Context, userID uuid.UUID, verified VerifiedPurchase) (GrantResult, error) {
	pack, err := s.Packs.Lookup(ctx, verified.Provider, verified.ProductID)
	if err != nil {
		return GrantResult{}, err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return GrantResult{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	purchaseID := uuid.New()
	var insertedID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO iap_purchases (
			id, user_id, provider, product_id, provider_transaction_id, credits_granted, status
		) VALUES ($1, $2, $3, $4, $5, $6, 'verified')
		ON CONFLICT (provider_transaction_id) DO NOTHING
		RETURNING id
	`, purchaseID, userID, string(verified.Provider), verified.ProductID, verified.TransactionID, pack.Credits).Scan(&insertedID)

	already := false
	if errors.Is(err, pgx.ErrNoRows) {
		already = true
		var existingUser uuid.UUID
		var existingCredits int64
		var existingID uuid.UUID
		if err := tx.QueryRow(ctx, `
			SELECT id, user_id, credits_granted
			FROM iap_purchases
			WHERE provider_transaction_id = $1
		`, verified.TransactionID).Scan(&existingID, &existingUser, &existingCredits); err != nil {
			return GrantResult{}, fmt.Errorf("load existing iap_purchase: %w", err)
		}
		if existingUser != userID {
			return GrantResult{}, ErrInvalidReceipt
		}
		purchaseID = existingID
		pack.Credits = existingCredits
	} else if err != nil {
		return GrantResult{}, fmt.Errorf("insert iap_purchase: %w", err)
	} else {
		purchaseID = insertedID
	}

	if s.Wallet == nil {
		return GrantResult{}, fmt.Errorf("wallet required")
	}
	balanceAfter, err := s.Wallet.GrantCreditsOnTx(ctx, tx, credits.ApplyInput{
		UserID:         userID,
		Amount:         pack.Credits,
		Reason:         credits.ReasonPurchase,
		RefType:        "iap_purchase",
		RefID:          purchaseID.String(),
		IdempotencyKey: verified.TransactionID,
	})
	if err != nil {
		return GrantResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return GrantResult{}, fmt.Errorf("commit: %w", err)
	}

	return GrantResult{
		BalanceAfter:   balanceAfter,
		CreditsGranted: pack.Credits,
		PurchaseID:     purchaseID,
		AlreadyGranted: already,
	}, nil
}
