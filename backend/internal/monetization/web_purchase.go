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

const (
	ProviderIyzico     Provider = "iyzico"
	ProviderPapara     Provider = "papara"
	ProviderBKMExpress Provider = "bkm_express"
)

// WebPurchaseService grants credits from the isolated payments service callback
// and proxies checkout creation to that service.
type WebPurchaseService struct {
	Pool             *pgxpool.Pool
	Wallet           *credits.Wallet
	Packs            *PackStore
	Promos           *PromoStore
	Invoices         *InvoiceWriter
	PaymentsURL      string
	InternalToken    string
	HTTP             *http.Client
	DefaultReturnURL string
}

func (s *WebPurchaseService) httpClient() *http.Client {
	if s.HTTP != nil {
		return s.HTTP
	}
	return &http.Client{Timeout: 20 * time.Second}
}

// CreditGrantInput is the authenticated callback payload from payments.
type CreditGrantInput struct {
	UserID            uuid.UUID
	Credits           int64
	ProductID         string
	Provider          Provider
	ProviderPaymentID string
	PaymentIntentID   uuid.UUID
}

// GrantFromPayments persists web_purchases and grants via the ledger.
// Duplicate provider_payment_id grants exactly once.
func (s *WebPurchaseService) GrantFromPayments(ctx context.Context, in CreditGrantInput) (GrantResult, error) {
	provider := Provider(strings.ToLower(strings.TrimSpace(string(in.Provider))))
	in.Provider = provider
	in.ProductID = strings.TrimSpace(in.ProductID)
	in.ProviderPaymentID = strings.TrimSpace(in.ProviderPaymentID)

	if !IsWebProvider(provider) {
		return GrantResult{}, ErrInvalidProvider
	}
	if in.UserID == uuid.Nil || in.ProductID == "" || in.ProviderPaymentID == "" || in.PaymentIntentID == uuid.Nil {
		return GrantResult{}, ErrInvalidReceipt
	}
	if in.Credits <= 0 {
		return GrantResult{}, ErrUnknownProduct
	}
	if s.Wallet == nil {
		return GrantResult{}, fmt.Errorf("wallet required")
	}

	grantCredits, amountKurus, err := s.resolveGrant(ctx, in)
	if err != nil {
		return GrantResult{}, err
	}
	if amountKurus <= 0 {
		amountKurus = 1
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return GrantResult{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	purchaseID := uuid.New()
	var insertedID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO web_purchases (
			id, user_id, provider, product_id, provider_payment_id, payment_intent_id,
			credits_granted, amount_kurus, status
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'verified')
		ON CONFLICT (provider_payment_id) DO NOTHING
		RETURNING id
	`, purchaseID, in.UserID, string(provider), in.ProductID, in.ProviderPaymentID,
		in.PaymentIntentID, grantCredits, amountKurus).Scan(&insertedID)

	already := false
	if errors.Is(err, pgx.ErrNoRows) {
		already = true
		var existingUser uuid.UUID
		var existingCredits int64
		var existingID uuid.UUID
		if err := tx.QueryRow(ctx, `
			SELECT id, user_id, credits_granted
			FROM web_purchases
			WHERE provider_payment_id = $1
		`, in.ProviderPaymentID).Scan(&existingID, &existingUser, &existingCredits); err != nil {
			return GrantResult{}, fmt.Errorf("load existing web_purchase: %w", err)
		}
		if existingUser != in.UserID {
			return GrantResult{}, ErrInvalidReceipt
		}
		purchaseID = existingID
		grantCredits = existingCredits
	} else if err != nil {
		return GrantResult{}, fmt.Errorf("insert web_purchase: %w", err)
	} else {
		purchaseID = insertedID
	}

	balanceAfter, err := s.Wallet.GrantCreditsOnTx(ctx, tx, credits.ApplyInput{
		UserID:         in.UserID,
		Amount:         grantCredits,
		Reason:         credits.ReasonPurchase,
		RefType:        "web_purchase",
		RefID:          purchaseID.String(),
		IdempotencyKey: in.ProviderPaymentID,
	})
	if err != nil {
		return GrantResult{}, err
	}
	var invoiceID uuid.UUID
	writer := s.Invoices
	if writer == nil {
		writer = &InvoiceWriter{KDVRateBPS: DefaultKDVRateBPS}
	}
	if !already {
		inv, err := writer.WriteOnTx(ctx, tx, in.UserID, SourceWebPurchase, purchaseID, amountKurus)
		if err != nil {
			return GrantResult{}, err
		}
		invoiceID = inv.ID
	} else if inv, err := LookupInvoiceBySourceOnTx(ctx, tx, SourceWebPurchase, purchaseID); err == nil {
		invoiceID = inv.ID
	}
	if err := tx.Commit(ctx); err != nil {
		return GrantResult{}, fmt.Errorf("commit: %w", err)
	}
	return GrantResult{
		BalanceAfter:   balanceAfter,
		CreditsGranted: grantCredits,
		PurchaseID:     purchaseID,
		InvoiceID:      invoiceID,
		AlreadyGranted: already,
	}, nil
}

func (s *WebPurchaseService) resolveGrant(ctx context.Context, in CreditGrantInput) (creditsGranted, amountKurus int64, err error) {
	quote, qerr := LoadQuote(ctx, s.Pool, in.PaymentIntentID)
	if qerr == nil {
		if quote.UserID != in.UserID {
			return 0, 0, ErrInvalidReceipt
		}
		if quote.ProductID != in.ProductID || quote.Credits != in.Credits {
			return 0, 0, ErrProductMismatch
		}
		return quote.Credits, quote.AmountKurus, nil
	}
	if !errors.Is(qerr, pgx.ErrNoRows) {
		return 0, 0, qerr
	}
	if in.ProductID == ProductCustom {
		return 0, 0, ErrUnknownProduct
	}
	if s.Packs == nil {
		return 0, 0, ErrUnknownProduct
	}
	pack, err := s.Packs.Lookup(ctx, in.Provider, in.ProductID)
	if err != nil {
		return 0, 0, err
	}
	if pack.Credits != in.Credits {
		return 0, 0, ErrProductMismatch
	}
	return pack.Credits, pack.AmountKurus, nil
}

// CheckoutResult is returned to the player after payments creates a hosted session.
type CheckoutResult struct {
	CheckoutURL       string `json:"checkout_url"`
	PaymentIntentID   string `json:"payment_intent_id"`
	Provider          string `json:"provider"`
	ProviderPaymentID string `json:"provider_payment_id"`
}

// CheckoutInput is the player-facing checkout request after auth.
type CheckoutInput struct {
	Provider  Provider
	ProductID string
	Credits   int64
	ReturnURL string
}

// StartCheckout prices the pack or custom amount, freezes a quote, and asks payments to Charge.
func (s *WebPurchaseService) StartCheckout(ctx context.Context, userID uuid.UUID, in CheckoutInput) (CheckoutResult, error) {
	provider := Provider(strings.ToLower(strings.TrimSpace(string(in.Provider))))
	productID := strings.TrimSpace(in.ProductID)
	if !IsWebProvider(provider) {
		return CheckoutResult{}, ErrInvalidProvider
	}
	if s.PaymentsURL == "" || s.InternalToken == "" {
		return CheckoutResult{}, ErrVerifierUnavailable
	}
	priced, err := s.priceCheckout(ctx, provider, productID, in.Credits)
	if err != nil {
		return CheckoutResult{}, err
	}
	returnURL := strings.TrimSpace(in.ReturnURL)
	if returnURL == "" {
		returnURL = s.DefaultReturnURL
	}
	idempotencyKey := fmt.Sprintf("%s:%s:%s", userID.String(), provider, productID)
	body, err := json.Marshal(map[string]any{
		"user_id":         userID.String(),
		"provider":        string(provider),
		"product_id":      productID,
		"credits":         priced.TotalCredits,
		"amount_kurus":    priced.AmountKurus,
		"idempotency_key": idempotencyKey + ":" + uuid.NewString(),
		"return_url":      returnURL,
	})
	if err != nil {
		return CheckoutResult{}, err
	}
	url := strings.TrimRight(s.PaymentsURL, "/") + "/v1/charges"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return CheckoutResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", s.InternalToken)
	res, err := s.httpClient().Do(req)
	if err != nil {
		return CheckoutResult{}, fmt.Errorf("payments charge: %w", err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return CheckoutResult{}, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return CheckoutResult{}, fmt.Errorf("%w: status %d", ErrVerifierUnavailable, res.StatusCode)
	}
	var out struct {
		CheckoutURL       string `json:"checkout_url"`
		PaymentIntentID   string `json:"payment_intent_id"`
		Provider          string `json:"provider"`
		ProviderPaymentID string `json:"provider_payment_id"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return CheckoutResult{}, err
	}
	if out.CheckoutURL == "" {
		return CheckoutResult{}, ErrVerifierUnavailable
	}
	intentID, err := uuid.Parse(strings.TrimSpace(out.PaymentIntentID))
	if err != nil {
		return CheckoutResult{}, ErrVerifierUnavailable
	}
	if err := InsertQuote(ctx, s.Pool, PurchaseQuote{
		PaymentIntentID: intentID,
		UserID:          userID,
		ProductID:       productID,
		BaseCredits:     priced.BaseCredits,
		BonusPercent:    priced.BonusPercent,
		Credits:         priced.TotalCredits,
		AmountKurus:     priced.AmountKurus,
	}); err != nil {
		return CheckoutResult{}, err
	}
	return CheckoutResult{
		CheckoutURL:       out.CheckoutURL,
		PaymentIntentID:   out.PaymentIntentID,
		Provider:          out.Provider,
		ProviderPaymentID: out.ProviderPaymentID,
	}, nil
}

type pricedCheckout struct {
	BaseCredits  int64
	BonusPercent int64
	TotalCredits int64
	AmountKurus  int64
}

func (s *WebPurchaseService) priceCheckout(ctx context.Context, provider Provider, productID string, customCredits int64) (pricedCheckout, error) {
	if s.Packs == nil {
		return pricedCheckout{}, ErrUnknownProduct
	}
	var baseCredits, amountKurus int64
	if productID == ProductCustom {
		pack, err := s.Packs.Lookup(ctx, provider, BaselineProductID)
		if err != nil {
			return pricedCheckout{}, err
		}
		amount, err := CustomAmountKurus(customCredits, pack.Credits, pack.AmountKurus)
		if err != nil {
			return pricedCheckout{}, err
		}
		baseCredits = customCredits
		amountKurus = amount
	} else {
		pack, err := s.Packs.Lookup(ctx, provider, productID)
		if err != nil {
			return pricedCheckout{}, err
		}
		if pack.AmountKurus <= 0 {
			return pricedCheckout{}, ErrUnknownProduct
		}
		baseCredits = pack.Credits
		amountKurus = pack.AmountKurus
	}
	var bonus int64
	if s.Promos != nil {
		promo, err := s.Promos.Active(ctx)
		if err != nil {
			return pricedCheckout{}, err
		}
		if promo.Active {
			bonus = promo.BonusPercent
		}
	}
	return pricedCheckout{
		BaseCredits:  baseCredits,
		BonusPercent: bonus,
		TotalCredits: ApplyBonus(baseCredits, bonus),
		AmountKurus:  amountKurus,
	}, nil
}

// CheckoutStatus is the player-facing poll result after hosted checkout return.
type CheckoutStatus struct {
	Status         string     `json:"status"`
	PurchaseID     *uuid.UUID `json:"purchase_id,omitempty"`
	InvoiceID      *uuid.UUID `json:"invoice_id,omitempty"`
	CreditsGranted *int64     `json:"credits_granted,omitempty"`
	BalanceAfter   *int64     `json:"balance_after,omitempty"`
}

// CheckoutStatusForUser reports whether a payment intent has been granted for the user.
func (s *WebPurchaseService) CheckoutStatusForUser(ctx context.Context, userID, paymentIntentID uuid.UUID) (CheckoutStatus, error) {
	var purchaseID uuid.UUID
	var creditsGranted int64
	err := s.Pool.QueryRow(ctx, `
		SELECT id, credits_granted
		FROM web_purchases
		WHERE user_id = $1 AND payment_intent_id = $2
		ORDER BY created_at DESC
		LIMIT 1
	`, userID, paymentIntentID).Scan(&purchaseID, &creditsGranted)
	if errors.Is(err, pgx.ErrNoRows) {
		return CheckoutStatus{Status: "pending"}, nil
	}
	if err != nil {
		return CheckoutStatus{}, fmt.Errorf("checkout status: %w", err)
	}

	out := CheckoutStatus{
		Status:         "succeeded",
		PurchaseID:     &purchaseID,
		CreditsGranted: &creditsGranted,
	}

	var invoiceID uuid.UUID
	err = s.Pool.QueryRow(ctx, `
		SELECT id FROM invoices
		WHERE source_type = $1 AND source_id = $2
	`, SourceWebPurchase, purchaseID).Scan(&invoiceID)
	if err == nil {
		out.InvoiceID = &invoiceID
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return CheckoutStatus{}, fmt.Errorf("checkout status invoice: %w", err)
	}

	if s.Wallet != nil {
		bal, berr := s.Wallet.GetBalance(ctx, userID)
		if berr != nil {
			return CheckoutStatus{}, berr
		}
		out.BalanceAfter = &bal
	}
	return out, nil
}

// IsWebProvider reports whether provider is an enabled Turkish web PSP.
func IsWebProvider(p Provider) bool {
	return p == ProviderIyzico
}
