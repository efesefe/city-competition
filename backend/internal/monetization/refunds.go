package monetization

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/credits"
)

var (
	// ErrPurchaseNotFound is returned when the web purchase does not exist.
	ErrPurchaseNotFound = errors.New("purchase_not_found")
	// ErrAlreadyRefunded is returned when the purchase was already refunded.
	ErrAlreadyRefunded = errors.New("already_refunded")
	// ErrPaymentsRefundFailed is returned when the payments service refund call fails.
	ErrPaymentsRefundFailed = errors.New("payments_refund_failed")
)

// RefundService reverses unspent credits and calls the payments service Refund API.
type RefundService struct {
	Pool          *pgxpool.Pool
	Wallet        *credits.Wallet
	PaymentsURL   string
	InternalToken string
	HTTP          *http.Client
}

func (s *RefundService) httpClient() *http.Client {
	if s.HTTP != nil {
		return s.HTTP
	}
	return &http.Client{Timeout: 20 * time.Second}
}

// RefundResult is the outcome of an admin refund.
type RefundResult struct {
	WebPurchaseID   uuid.UUID `json:"web_purchase_id"`
	CreditsReversed int64     `json:"credits_reversed"`
	BalanceAfter    int64     `json:"balance_after"`
	AlreadyRefunded bool      `json:"already_refunded"`
}

type webPurchaseRow struct {
	ID                uuid.UUID
	UserID            uuid.UUID
	ProviderPaymentID string
	PaymentIntentID   uuid.UUID
	CreditsGranted    int64
	Status            string
}

// RefundWebPurchase calls payments POST /v1/refunds then claws back unspent credits.
// Does not mutate payment_intents locally and does not touch support scores.
func (s *RefundService) RefundWebPurchase(
	ctx context.Context,
	webPurchaseID uuid.UUID,
	idempotencyKey string,
) (RefundResult, error) {
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if webPurchaseID == uuid.Nil || idempotencyKey == "" {
		return RefundResult{}, ErrInvalidReceipt
	}
	if s.Wallet == nil {
		return RefundResult{}, fmt.Errorf("wallet required")
	}
	if s.PaymentsURL == "" || s.InternalToken == "" {
		return RefundResult{}, ErrVerifierUnavailable
	}

	purchase, err := s.loadWebPurchase(ctx, webPurchaseID)
	if err != nil {
		return RefundResult{}, err
	}
	if purchase.Status == "refunded" {
		bal, balErr := s.Wallet.GetBalance(ctx, purchase.UserID)
		if balErr != nil {
			return RefundResult{}, balErr
		}
		return RefundResult{
			WebPurchaseID:   purchase.ID,
			BalanceAfter:    bal,
			AlreadyRefunded: true,
		}, nil
	}
	if purchase.Status != "verified" {
		return RefundResult{}, ErrAlreadyRefunded
	}

	if err := s.callPaymentsRefund(ctx, purchase.PaymentIntentID, idempotencyKey); err != nil {
		return RefundResult{}, err
	}

	return s.applyCreditClawback(ctx, purchase)
}

// HandleChargeback flags the account into the moderation queue and reverses unspent credits.
// Never bans or shadow-bans the user.
func (s *RefundService) HandleChargeback(ctx context.Context, paymentIntentID uuid.UUID, providerPaymentID string) (RefundResult, error) {
	if paymentIntentID == uuid.Nil {
		return RefundResult{}, ErrInvalidReceipt
	}
	purchase, err := s.loadWebPurchaseByIntent(ctx, paymentIntentID, providerPaymentID)
	if err != nil {
		return RefundResult{}, err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return RefundResult{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		INSERT INTO flagged_users (user_id, reason, context_type, context_id, status)
		SELECT $1, 'chargeback', 'web_purchase', $2, 'pending'
		WHERE NOT EXISTS (
			SELECT 1 FROM flagged_users
			WHERE user_id = $1 AND reason = 'chargeback' AND context_id = $2 AND status = 'pending'
		)
	`, purchase.UserID, purchase.ID); err != nil {
		return RefundResult{}, fmt.Errorf("flag chargeback: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return RefundResult{}, fmt.Errorf("commit flag: %w", err)
	}

	if purchase.Status == "refunded" {
		bal, balErr := s.Wallet.GetBalance(ctx, purchase.UserID)
		if balErr != nil {
			return RefundResult{}, balErr
		}
		return RefundResult{
			WebPurchaseID:   purchase.ID,
			BalanceAfter:    bal,
			AlreadyRefunded: true,
		}, nil
	}
	return s.applyCreditClawback(ctx, purchase)
}

func (s *RefundService) applyCreditClawback(ctx context.Context, purchase webPurchaseRow) (RefundResult, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return RefundResult{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var status string
	err = tx.QueryRow(ctx, `
		SELECT status FROM web_purchases WHERE id = $1 FOR UPDATE
	`, purchase.ID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return RefundResult{}, ErrPurchaseNotFound
	}
	if err != nil {
		return RefundResult{}, fmt.Errorf("lock web_purchase: %w", err)
	}
	if status == "refunded" {
		bal, balErr := s.Wallet.GetBalance(ctx, purchase.UserID)
		if balErr != nil {
			return RefundResult{}, balErr
		}
		return RefundResult{
			WebPurchaseID:   purchase.ID,
			BalanceAfter:    bal,
			AlreadyRefunded: true,
		}, nil
	}

	var balance int64
	err = tx.QueryRow(ctx, `
		SELECT COALESCE((SELECT balance FROM credit_accounts WHERE user_id = $1), 0)
	`, purchase.UserID).Scan(&balance)
	if err != nil {
		return RefundResult{}, fmt.Errorf("read balance: %w", err)
	}

	clawback := purchase.CreditsGranted
	if balance < clawback {
		clawback = balance
	}

	balanceAfter := balance
	if clawback > 0 {
		balanceAfter, err = s.Wallet.SpendCreditsOnTx(ctx, tx, credits.ApplyInput{
			UserID:         purchase.UserID,
			Amount:         clawback,
			Reason:         credits.ReasonRefund,
			RefType:        "web_purchase",
			RefID:          purchase.ID.String(),
			IdempotencyKey: "refund:" + purchase.ProviderPaymentID,
		})
		if err != nil {
			return RefundResult{}, err
		}
	}

	if _, err := tx.Exec(ctx, `
		UPDATE web_purchases SET status = 'refunded' WHERE id = $1 AND status = 'verified'
	`, purchase.ID); err != nil {
		return RefundResult{}, fmt.Errorf("mark web_purchase refunded: %w", err)
	}
	if err := MarkInvoiceRefundedOnTx(ctx, tx, SourceWebPurchase, purchase.ID); err != nil {
		return RefundResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return RefundResult{}, fmt.Errorf("commit: %w", err)
	}
	return RefundResult{
		WebPurchaseID:   purchase.ID,
		CreditsReversed: clawback,
		BalanceAfter:    balanceAfter,
	}, nil
}

func (s *RefundService) callPaymentsRefund(ctx context.Context, intentID uuid.UUID, idempotencyKey string) error {
	body, err := json.Marshal(map[string]string{
		"payment_intent_id": intentID.String(),
		"idempotency_key":   idempotencyKey,
	})
	if err != nil {
		return err
	}
	url := strings.TrimRight(s.PaymentsURL, "/") + "/v1/refunds"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", s.InternalToken)
	res, err := s.httpClient().Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrPaymentsRefundFailed, err)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<16))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("%w: status %d", ErrPaymentsRefundFailed, res.StatusCode)
	}
	return nil
}

func (s *RefundService) loadWebPurchase(ctx context.Context, id uuid.UUID) (webPurchaseRow, error) {
	var row webPurchaseRow
	err := s.Pool.QueryRow(ctx, `
		SELECT id, user_id, provider_payment_id, payment_intent_id, credits_granted, status
		FROM web_purchases WHERE id = $1
	`, id).Scan(&row.ID, &row.UserID, &row.ProviderPaymentID, &row.PaymentIntentID, &row.CreditsGranted, &row.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return webPurchaseRow{}, ErrPurchaseNotFound
	}
	if err != nil {
		return webPurchaseRow{}, fmt.Errorf("load web_purchase: %w", err)
	}
	return row, nil
}

func (s *RefundService) loadWebPurchaseByIntent(ctx context.Context, intentID uuid.UUID, providerPaymentID string) (webPurchaseRow, error) {
	var row webPurchaseRow
	err := s.Pool.QueryRow(ctx, `
		SELECT id, user_id, provider_payment_id, payment_intent_id, credits_granted, status
		FROM web_purchases
		WHERE payment_intent_id = $1
		   OR ($2 <> '' AND provider_payment_id = $2)
		ORDER BY created_at ASC
		LIMIT 1
	`, intentID, strings.TrimSpace(providerPaymentID)).Scan(
		&row.ID, &row.UserID, &row.ProviderPaymentID, &row.PaymentIntentID, &row.CreditsGranted, &row.Status,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return webPurchaseRow{}, ErrPurchaseNotFound
	}
	if err != nil {
		return webPurchaseRow{}, fmt.Errorf("load web_purchase by intent: %w", err)
	}
	return row, nil
}
