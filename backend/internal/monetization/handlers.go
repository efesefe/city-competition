package monetization

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/credits"
	"github.com/city-competition-remastered/backend/internal/db"
)

// Handler exposes IAP verify, credit packs, battle-pass, and web checkout endpoints.
type Handler struct {
	IAP           *Service
	BattlePass    *BattlePassService
	WebPurchase   *WebPurchaseService
	Refunds       *RefundService
	Breaker       *db.CircuitBreaker
	InternalToken string
}

type errorBody struct {
	Error string `json:"error"`
}

type verifyRequest struct {
	Provider      string `json:"provider"`
	ProductID     string `json:"product_id"`
	ReceiptData   string `json:"receipt_data"`
	PurchaseToken string `json:"purchase_token"`
	PackageName   string `json:"package_name"`
	// Success / Credits / TransactionID are intentionally ignored for granting.
	Success       *bool  `json:"success"`
	Credits       *int64 `json:"credits"`
	TransactionID string `json:"transaction_id"`
}

type packDTO struct {
	Provider    string `json:"provider"`
	ProductID   string `json:"product_id"`
	Credits     int64  `json:"credits"`
	AmountKurus int64  `json:"amount_kurus,omitempty"`
}

// Verify handles POST /v1/iap/verify.
// Never trusts client-reported success, credits, or transaction_id.
func (h *Handler) Verify(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}

	var req verifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input")
		return
	}

	if h.Breaker != nil {
		if err := h.Breaker.Allow(); err != nil {
			writeIAPErr(w, err)
			return
		}
	}

	result, err := h.IAP.VerifyAndGrant(r.Context(), userID, ReceiptInput{
		Provider:      Provider(strings.ToLower(strings.TrimSpace(req.Provider))),
		ProductID:     strings.TrimSpace(req.ProductID),
		ReceiptData:   req.ReceiptData,
		PurchaseToken: req.PurchaseToken,
		PackageName:   req.PackageName,
	})
	if err != nil {
		if h.Breaker != nil && !isIAPBusinessErr(err) {
			h.Breaker.RecordFailure()
		}
		writeIAPErr(w, err)
		return
	}
	if h.Breaker != nil {
		h.Breaker.RecordSuccess()
	}
	writeJSON(w, http.StatusOK, result)
}

// ListPacks handles GET /v1/credit-packs.
func (h *Handler) ListPacks(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserIDFromContext(r.Context()); !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	packs, err := h.IAP.Packs.ListActive(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	out := make([]packDTO, 0, len(packs))
	for _, p := range packs {
		out = append(out, packDTO{
			Provider:    string(p.Provider),
			ProductID:   p.ProductID,
			Credits:     p.Credits,
			AmountKurus: p.AmountKurus,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"packs": out})
}

type checkoutRequest struct {
	Provider  string `json:"provider"`
	ProductID string `json:"product_id"`
	ReturnURL string `json:"return_url"`
}

type creditGrantRequest struct {
	UserID            string `json:"user_id"`
	Credits           int64  `json:"credits"`
	ProductID         string `json:"product_id"`
	Provider          string `json:"provider"`
	ProviderPaymentID string `json:"provider_payment_id"`
	PaymentIntentID   string `json:"payment_intent_id"`
}

// Checkout handles POST /v1/payments/checkout (player-facing proxy to payments service).
func (h *Handler) Checkout(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.WebPurchase == nil {
		writeErr(w, http.StatusServiceUnavailable, ErrVerifierUnavailable.Error())
		return
	}
	var req checkoutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input")
		return
	}
	if h.Breaker != nil {
		if err := h.Breaker.Allow(); err != nil {
			writeIAPErr(w, err)
			return
		}
	}
	result, err := h.WebPurchase.StartCheckout(
		r.Context(),
		userID,
		Provider(strings.ToLower(strings.TrimSpace(req.Provider))),
		strings.TrimSpace(req.ProductID),
		strings.TrimSpace(req.ReturnURL),
	)
	if err != nil {
		if h.Breaker != nil && !isIAPBusinessErr(err) {
			h.Breaker.RecordFailure()
		}
		writeIAPErr(w, err)
		return
	}
	if h.Breaker != nil {
		h.Breaker.RecordSuccess()
	}
	writeJSON(w, http.StatusOK, result)
}

type invoiceDTO struct {
	ID         string `json:"id"`
	Currency   string `json:"currency"`
	KDVRateBPS int    `json:"kdv_rate_bps"`
	NetKurus   int64  `json:"net_kurus"`
	TaxKurus   int64  `json:"tax_kurus"`
	GrossKurus int64  `json:"gross_kurus"`
	Status     string `json:"status"`
	CreatedAt  string `json:"created_at"`
	SourceType string `json:"source_type"`
	SourceID   string `json:"source_id"`
}

// GetInvoice handles GET /v1/invoices/{id}.
func (h *Handler) GetInvoice(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	invoiceID, err := uuid.Parse(strings.TrimSpace(r.PathValue("id")))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_invoice_id")
		return
	}
	pool := invoicePool(h)
	if pool == nil {
		writeErr(w, http.StatusServiceUnavailable, ErrVerifierUnavailable.Error())
		return
	}
	inv, err := GetInvoiceForUser(r.Context(), pool, userID, invoiceID)
	if err != nil {
		if errors.Is(err, ErrInvoiceNotFound) {
			writeErr(w, http.StatusNotFound, ErrInvoiceNotFound.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, invoiceDTO{
		ID:         inv.ID.String(),
		Currency:   inv.Currency,
		KDVRateBPS: inv.KDVRateBPS,
		NetKurus:   inv.NetKurus,
		TaxKurus:   inv.TaxKurus,
		GrossKurus: inv.GrossKurus,
		Status:     inv.Status,
		CreatedAt:  inv.CreatedAt.UTC().Format(time.RFC3339),
		SourceType: inv.SourceType,
		SourceID:   inv.SourceID.String(),
	})
}

// CheckoutStatus handles GET /v1/payments/checkout/status?payment_intent_id=.
func (h *Handler) CheckoutStatus(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.WebPurchase == nil {
		writeErr(w, http.StatusServiceUnavailable, ErrVerifierUnavailable.Error())
		return
	}
	intentRaw := strings.TrimSpace(r.URL.Query().Get("payment_intent_id"))
	intentID, err := uuid.Parse(intentRaw)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_payment_intent_id")
		return
	}
	status, err := h.WebPurchase.CheckoutStatusForUser(r.Context(), userID, intentID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func invoicePool(h *Handler) *pgxpool.Pool {
	if h.WebPurchase != nil && h.WebPurchase.Pool != nil {
		return h.WebPurchase.Pool
	}
	if h.IAP != nil && h.IAP.Pool != nil {
		return h.IAP.Pool
	}
	if h.Refunds != nil && h.Refunds.Pool != nil {
		return h.Refunds.Pool
	}
	return nil
}

// CreditGrant handles POST /internal/payments/credit-grant from the payments service.
func (h *Handler) CreditGrant(w http.ResponseWriter, r *http.Request) {
	got := r.Header.Get("X-Internal-Token")
	if h.InternalToken == "" || got != h.InternalToken {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if h.WebPurchase == nil {
		writeErr(w, http.StatusServiceUnavailable, ErrVerifierUnavailable.Error())
		return
	}
	var req creditGrantRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input")
		return
	}
	userID, err := uuid.Parse(strings.TrimSpace(req.UserID))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_user_id")
		return
	}
	intentID, err := uuid.Parse(strings.TrimSpace(req.PaymentIntentID))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_payment_intent_id")
		return
	}
	if h.Breaker != nil {
		if err := h.Breaker.Allow(); err != nil {
			writeIAPErr(w, err)
			return
		}
	}
	result, err := h.WebPurchase.GrantFromPayments(r.Context(), CreditGrantInput{
		UserID:            userID,
		Credits:           req.Credits,
		ProductID:         strings.TrimSpace(req.ProductID),
		Provider:          Provider(strings.ToLower(strings.TrimSpace(req.Provider))),
		ProviderPaymentID: strings.TrimSpace(req.ProviderPaymentID),
		PaymentIntentID:   intentID,
	})
	if err != nil {
		if h.Breaker != nil && !isIAPBusinessErr(err) {
			h.Breaker.RecordFailure()
		}
		writeIAPErr(w, err)
		return
	}
	if h.Breaker != nil {
		h.Breaker.RecordSuccess()
	}
	writeJSON(w, http.StatusOK, result)
}

type refundRequest struct {
	WebPurchaseID  string `json:"web_purchase_id"`
	IdempotencyKey string `json:"idempotency_key"`
}

// AdminRefund handles POST /v1/admin/refunds (admin/support gated).
func (h *Handler) AdminRefund(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserIDFromContext(r.Context()); !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.Refunds == nil {
		writeErr(w, http.StatusServiceUnavailable, ErrVerifierUnavailable.Error())
		return
	}
	var req refundRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input")
		return
	}
	purchaseID, err := uuid.Parse(strings.TrimSpace(req.WebPurchaseID))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_web_purchase_id")
		return
	}
	if h.Breaker != nil {
		if err := h.Breaker.Allow(); err != nil {
			writeIAPErr(w, err)
			return
		}
	}
	result, err := h.Refunds.RefundWebPurchase(r.Context(), purchaseID, strings.TrimSpace(req.IdempotencyKey))
	if err != nil {
		if h.Breaker != nil && !isIAPBusinessErr(err) {
			h.Breaker.RecordFailure()
		}
		writeIAPErr(w, err)
		return
	}
	if h.Breaker != nil {
		h.Breaker.RecordSuccess()
	}
	writeJSON(w, http.StatusOK, result)
}

type chargebackRequest struct {
	UserID            string `json:"user_id"`
	Provider          string `json:"provider"`
	ProviderPaymentID string `json:"provider_payment_id"`
	PaymentIntentID   string `json:"payment_intent_id"`
}

// Chargeback handles POST /internal/payments/chargeback from the payments service.
func (h *Handler) Chargeback(w http.ResponseWriter, r *http.Request) {
	got := r.Header.Get("X-Internal-Token")
	if h.InternalToken == "" || got != h.InternalToken {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if h.Refunds == nil {
		writeErr(w, http.StatusServiceUnavailable, ErrVerifierUnavailable.Error())
		return
	}
	var req chargebackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input")
		return
	}
	intentID, err := uuid.Parse(strings.TrimSpace(req.PaymentIntentID))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_payment_intent_id")
		return
	}
	if h.Breaker != nil {
		if err := h.Breaker.Allow(); err != nil {
			writeIAPErr(w, err)
			return
		}
	}
	result, err := h.Refunds.HandleChargeback(r.Context(), intentID, strings.TrimSpace(req.ProviderPaymentID))
	if err != nil {
		if h.Breaker != nil && !isIAPBusinessErr(err) {
			h.Breaker.RecordFailure()
		}
		writeIAPErr(w, err)
		return
	}
	if h.Breaker != nil {
		h.Breaker.RecordSuccess()
	}
	writeJSON(w, http.StatusOK, result)
}

// BattlePassStatus handles GET /v1/battle-pass.
func (h *Handler) BattlePassStatus(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	status, err := h.BattlePass.Status(r.Context(), userID)
	if err != nil {
		writeIAPErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, status)
}

// BattlePassClaim handles POST /v1/battle-pass/claim.
func (h *Handler) BattlePassClaim(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.Breaker != nil {
		if err := h.Breaker.Allow(); err != nil {
			writeIAPErr(w, err)
			return
		}
	}
	result, err := h.BattlePass.Claim(r.Context(), userID)
	if err != nil {
		if h.Breaker != nil && !isIAPBusinessErr(err) {
			h.Breaker.RecordFailure()
		}
		writeIAPErr(w, err)
		return
	}
	if h.Breaker != nil {
		h.Breaker.RecordSuccess()
	}
	writeJSON(w, http.StatusOK, result)
}

func isIAPBusinessErr(err error) bool {
	switch {
	case errors.Is(err, ErrInvalidReceipt),
		errors.Is(err, ErrUnknownProduct),
		errors.Is(err, ErrProductMismatch),
		errors.Is(err, ErrInvalidProvider),
		errors.Is(err, ErrMissingReceipt),
		errors.Is(err, ErrVerifierUnavailable),
		errors.Is(err, ErrNoActiveSeason),
		errors.Is(err, ErrTierNotEligible),
		errors.Is(err, ErrPurchaseNotFound),
		errors.Is(err, ErrInvoiceNotFound),
		errors.Is(err, ErrAlreadyRefunded),
		errors.Is(err, ErrPaymentsRefundFailed),
		errors.Is(err, credits.ErrIdempotencyConflict),
		errors.Is(err, credits.ErrInvalidIdempotencyKey),
		errors.Is(err, db.ErrWritePathDegraded):
		return true
	default:
		return false
	}
}

func writeIAPErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, db.ErrWritePathDegraded):
		writeErr(w, http.StatusServiceUnavailable, db.ErrWritePathDegraded.Error())
	case errors.Is(err, ErrMissingReceipt),
		errors.Is(err, ErrInvalidProvider),
		errors.Is(err, ErrUnknownProduct),
		errors.Is(err, ErrProductMismatch):
		writeErr(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrInvalidReceipt):
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, ErrVerifierUnavailable),
		errors.Is(err, ErrPaymentsRefundFailed):
		writeErr(w, http.StatusServiceUnavailable, err.Error())
	case errors.Is(err, ErrNoActiveSeason),
		errors.Is(err, ErrPurchaseNotFound),
		errors.Is(err, ErrInvoiceNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrTierNotEligible),
		errors.Is(err, ErrAlreadyRefunded):
		writeErr(w, http.StatusConflict, err.Error())
	case errors.Is(err, credits.ErrIdempotencyConflict):
		writeErr(w, http.StatusConflict, credits.ErrIdempotencyConflict.Error())
	default:
		writeErr(w, http.StatusInternalServerError, "error_internal")
	}
}

func writeErr(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, errorBody{Error: code})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
