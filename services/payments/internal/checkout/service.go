package checkout

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/payments/internal/providers"
)

var (
	ErrNotFound       = errors.New("payment_intent_not_found")
	ErrInvalidInput   = errors.New("invalid_input")
	ErrAlreadyFinal   = errors.New("payment_already_final")
)

// Intent is a row in payment_intents (no card data).
type Intent struct {
	ID                uuid.UUID
	UserID            uuid.UUID
	Provider          string
	ProductID         string
	Credits           int64
	AmountKurus       int64
	Currency          string
	Status            string
	ProviderPaymentID string
	CheckoutURL       string
	IdempotencyKey    string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// CreateInput is the internal create-charge request.
type CreateInput struct {
	UserID         uuid.UUID
	Provider       string
	ProductID      string
	Credits        int64
	AmountKurus    int64
	IdempotencyKey string
	ReturnURL      string
}

// Service creates charges via PSP and persists intents in the payments DB only.
type Service struct {
	Pool      *pgxpool.Pool
	Providers providers.Registry
	WebhookBase string
}

// CreateCharge starts hosted checkout and stores the intent.
func (s *Service) CreateCharge(ctx context.Context, in CreateInput) (Intent, error) {
	if in.UserID == uuid.Nil || in.ProductID == "" || in.Credits <= 0 || in.AmountKurus <= 0 || in.IdempotencyKey == "" {
		return Intent{}, ErrInvalidInput
	}
	prov, err := s.Providers.Get(in.Provider)
	if err != nil {
		return Intent{}, err
	}

	// Idempotent replay of the same key.
	existing, err := s.ByIdempotencyKey(ctx, in.IdempotencyKey)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return Intent{}, err
	}

	id := uuid.New()
	callbackURL := strings.TrimRight(s.WebhookBase, "/") + "/v1/webhooks/" + in.Provider
	result, err := prov.Charge(ctx, providers.ChargeRequest{
		UserID:         in.UserID,
		ProductID:      in.ProductID,
		Credits:        in.Credits,
		AmountKurus:    in.AmountKurus,
		Currency:       "TRY",
		IdempotencyKey: in.IdempotencyKey,
		ReturnURL:      in.ReturnURL,
		CallbackURL:    callbackURL,
		ConversationID: id.String(),
	})
	if err != nil {
		return Intent{}, err
	}

	var intent Intent
	err = s.Pool.QueryRow(ctx, `
		INSERT INTO payment_intents (
			id, user_id, provider, product_id, credits, amount_kurus, currency,
			status, provider_payment_id, checkout_url, idempotency_key
		) VALUES ($1,$2,$3,$4,$5,$6,'TRY','pending',$7,$8,$9)
		ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
		RETURNING id, user_id, provider, product_id, credits, amount_kurus, currency,
			status, COALESCE(provider_payment_id,''), COALESCE(checkout_url,''), idempotency_key, created_at, updated_at
	`, id, in.UserID, in.Provider, in.ProductID, in.Credits, in.AmountKurus,
		result.ProviderPaymentID, result.CheckoutURL, in.IdempotencyKey,
	).Scan(
		&intent.ID, &intent.UserID, &intent.Provider, &intent.ProductID, &intent.Credits,
		&intent.AmountKurus, &intent.Currency, &intent.Status, &intent.ProviderPaymentID,
		&intent.CheckoutURL, &intent.IdempotencyKey, &intent.CreatedAt, &intent.UpdatedAt,
	)
	if err != nil {
		return Intent{}, fmt.Errorf("insert payment_intent: %w", err)
	}
	return intent, nil
}

// ByIdempotencyKey loads an intent by merchant idempotency key.
func (s *Service) ByIdempotencyKey(ctx context.Context, key string) (Intent, error) {
	var intent Intent
	err := s.Pool.QueryRow(ctx, `
		SELECT id, user_id, provider, product_id, credits, amount_kurus, currency,
			status, COALESCE(provider_payment_id,''), COALESCE(checkout_url,''), idempotency_key, created_at, updated_at
		FROM payment_intents WHERE idempotency_key = $1
	`, key).Scan(
		&intent.ID, &intent.UserID, &intent.Provider, &intent.ProductID, &intent.Credits,
		&intent.AmountKurus, &intent.Currency, &intent.Status, &intent.ProviderPaymentID,
		&intent.CheckoutURL, &intent.IdempotencyKey, &intent.CreatedAt, &intent.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Intent{}, ErrNotFound
	}
	if err != nil {
		return Intent{}, err
	}
	return intent, nil
}

// ByID loads an intent by id.
func (s *Service) ByID(ctx context.Context, id uuid.UUID) (Intent, error) {
	var intent Intent
	err := s.Pool.QueryRow(ctx, `
		SELECT id, user_id, provider, product_id, credits, amount_kurus, currency,
			status, COALESCE(provider_payment_id,''), COALESCE(checkout_url,''), idempotency_key, created_at, updated_at
		FROM payment_intents WHERE id = $1
	`, id).Scan(
		&intent.ID, &intent.UserID, &intent.Provider, &intent.ProductID, &intent.Credits,
		&intent.AmountKurus, &intent.Currency, &intent.Status, &intent.ProviderPaymentID,
		&intent.CheckoutURL, &intent.IdempotencyKey, &intent.CreatedAt, &intent.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Intent{}, ErrNotFound
	}
	if err != nil {
		return Intent{}, err
	}
	return intent, nil
}

// MarkSucceeded transitions pending → succeeded idempotently.
func (s *Service) MarkSucceeded(ctx context.Context, id uuid.UUID, providerPaymentID string) (Intent, bool, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Intent{}, false, err
	}
	defer tx.Rollback(ctx)

	var intent Intent
	err = tx.QueryRow(ctx, `
		SELECT id, user_id, provider, product_id, credits, amount_kurus, currency,
			status, COALESCE(provider_payment_id,''), COALESCE(checkout_url,''), idempotency_key, created_at, updated_at
		FROM payment_intents WHERE id = $1 FOR UPDATE
	`, id).Scan(
		&intent.ID, &intent.UserID, &intent.Provider, &intent.ProductID, &intent.Credits,
		&intent.AmountKurus, &intent.Currency, &intent.Status, &intent.ProviderPaymentID,
		&intent.CheckoutURL, &intent.IdempotencyKey, &intent.CreatedAt, &intent.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Intent{}, false, ErrNotFound
	}
	if err != nil {
		return Intent{}, false, err
	}
	if intent.Status == "succeeded" {
		return intent, false, nil
	}
	if intent.Status != "pending" {
		return Intent{}, false, ErrAlreadyFinal
	}
	if providerPaymentID != "" {
		intent.ProviderPaymentID = providerPaymentID
	}
	_, err = tx.Exec(ctx, `
		UPDATE payment_intents
		SET status = 'succeeded', provider_payment_id = $2, updated_at = now()
		WHERE id = $1
	`, id, intent.ProviderPaymentID)
	if err != nil {
		return Intent{}, false, err
	}
	intent.Status = "succeeded"
	if err := tx.Commit(ctx); err != nil {
		return Intent{}, false, err
	}
	return intent, true, nil
}

// MarkFailed transitions pending → failed.
func (s *Service) MarkFailed(ctx context.Context, id uuid.UUID) error {
	ct, err := s.Pool.Exec(ctx, `
		UPDATE payment_intents SET status = 'failed', updated_at = now()
		WHERE id = $1 AND status = 'pending'
	`, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// MarkRefunded sets status refunded after a successful PSP refund.
func (s *Service) MarkRefunded(ctx context.Context, id uuid.UUID) error {
	ct, err := s.Pool.Exec(ctx, `
		UPDATE payment_intents SET status = 'refunded', updated_at = now()
		WHERE id = $1 AND status = 'succeeded'
	`, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Refund calls the PSP and marks the intent refunded.
func (s *Service) Refund(ctx context.Context, intentID uuid.UUID, idempotencyKey string) (providers.RefundResult, error) {
	intent, err := s.ByID(ctx, intentID)
	if err != nil {
		return providers.RefundResult{}, err
	}
	if intent.Status != "succeeded" {
		return providers.RefundResult{}, ErrAlreadyFinal
	}
	prov, err := s.Providers.Get(intent.Provider)
	if err != nil {
		return providers.RefundResult{}, err
	}
	result, err := prov.Refund(ctx, providers.RefundRequest{
		ProviderPaymentID: intent.ProviderPaymentID,
		AmountKurus:       intent.AmountKurus,
		Currency:          intent.Currency,
		IdempotencyKey:    idempotencyKey,
	})
	if err != nil {
		return providers.RefundResult{}, err
	}
	if err := s.MarkRefunded(ctx, intentID); err != nil {
		return providers.RefundResult{}, err
	}
	return result, nil
}
