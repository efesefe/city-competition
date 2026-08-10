package monetization

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/credits"
	"github.com/city-competition-remastered/backend/internal/db"
)

// Handler exposes IAP verify, credit packs, and battle-pass endpoints.
type Handler struct {
	IAP        *Service
	BattlePass *BattlePassService
	Breaker    *db.CircuitBreaker
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
	Provider  string `json:"provider"`
	ProductID string `json:"product_id"`
	Credits   int64  `json:"credits"`
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
			Provider:  string(p.Provider),
			ProductID: p.ProductID,
			Credits:   p.Credits,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"packs": out})
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
	case errors.Is(err, ErrVerifierUnavailable):
		writeErr(w, http.StatusServiceUnavailable, err.Error())
	case errors.Is(err, ErrNoActiveSeason):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrTierNotEligible):
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
