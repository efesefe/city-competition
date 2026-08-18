package monetization

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PurchaseQuote freezes credits and price at web checkout time.
type PurchaseQuote struct {
	PaymentIntentID uuid.UUID
	UserID          uuid.UUID
	ProductID       string
	BaseCredits     int64
	BonusPercent    int64
	Credits         int64
	AmountKurus     int64
}

// InsertQuote writes a frozen checkout quote. Idempotent on payment_intent_id.
func InsertQuote(ctx context.Context, pool *pgxpool.Pool, q PurchaseQuote) error {
	if pool == nil {
		return fmt.Errorf("quote store not configured")
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO purchase_quotes (
			payment_intent_id, user_id, product_id, base_credits, bonus_percent, credits, amount_kurus
		) VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (payment_intent_id) DO NOTHING
	`, q.PaymentIntentID, q.UserID, q.ProductID, q.BaseCredits, q.BonusPercent, q.Credits, q.AmountKurus)
	if err != nil {
		return fmt.Errorf("insert purchase_quote: %w", err)
	}
	return nil
}

// LoadQuote returns the frozen quote for a payment intent.
func LoadQuote(ctx context.Context, pool *pgxpool.Pool, paymentIntentID uuid.UUID) (PurchaseQuote, error) {
	if pool == nil {
		return PurchaseQuote{}, pgx.ErrNoRows
	}
	var q PurchaseQuote
	err := pool.QueryRow(ctx, `
		SELECT payment_intent_id, user_id, product_id, base_credits, bonus_percent, credits, amount_kurus
		FROM purchase_quotes
		WHERE payment_intent_id = $1
	`, paymentIntentID).Scan(
		&q.PaymentIntentID, &q.UserID, &q.ProductID, &q.BaseCredits, &q.BonusPercent, &q.Credits, &q.AmountKurus,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PurchaseQuote{}, err
		}
		return PurchaseQuote{}, fmt.Errorf("load purchase_quote: %w", err)
	}
	return q, nil
}
