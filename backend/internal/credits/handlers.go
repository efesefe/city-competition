package credits

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/db"
)

// Handler exposes credit balance and (dev-only) stub-grant endpoints.
type Handler struct {
	Wallet       *Wallet
	Breaker      *db.CircuitBreaker
	StubEnabled  bool
	StubAmount   int64
	IsProduction bool
}

type errorBody struct {
	Error string `json:"error"`
}

type balanceResponse struct {
	Balance int64 `json:"balance"`
}

type stubGrantRequest struct {
	IdempotencyKey string `json:"idempotency_key"`
}

// Balance handles GET /v1/credits/balance.
func (h *Handler) Balance(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}

	balance, err := h.Wallet.GetBalance(r.Context(), userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, balanceResponse{Balance: balance})
}

// StubGrant handles POST /v1/credits/stub-grant.
// Enabled only when CREDITS_STUB_ENABLED=true and not production.
func (h *Handler) StubGrant(w http.ResponseWriter, r *http.Request) {
	if !h.StubEnabled || h.IsProduction {
		writeErr(w, http.StatusNotFound, "not_found")
		return
	}

	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}

	var req stubGrantRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input")
		return
	}
	if req.IdempotencyKey == "" {
		writeErr(w, http.StatusBadRequest, ErrInvalidIdempotencyKey.Error())
		return
	}

	if err := h.Breaker.Allow(); err != nil {
		writeCreditsErr(w, err)
		return
	}

	balanceAfter, err := h.Wallet.GrantCredits(r.Context(), ApplyInput{
		UserID:         userID,
		Amount:         h.StubAmount,
		Reason:         ReasonStubGrant,
		RefType:        "stub_grant",
		RefID:          req.IdempotencyKey,
		IdempotencyKey: req.IdempotencyKey,
	})
	if err != nil {
		if !isCreditsBusinessErr(err) {
			h.Breaker.RecordFailure()
		}
		writeCreditsErr(w, err)
		return
	}
	h.Breaker.RecordSuccess()
	writeJSON(w, http.StatusOK, balanceResponse{Balance: balanceAfter})
}

func isCreditsBusinessErr(err error) bool {
	switch {
	case errors.Is(err, ErrInsufficientCredits),
		errors.Is(err, ErrIdempotencyConflict),
		errors.Is(err, ErrInvalidAmount),
		errors.Is(err, ErrInvalidIdempotencyKey),
		errors.Is(err, db.ErrWritePathDegraded):
		return true
	default:
		return false
	}
}

func writeCreditsErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, db.ErrWritePathDegraded):
		writeErr(w, http.StatusServiceUnavailable, db.ErrWritePathDegraded.Error())
	case errors.Is(err, ErrInsufficientCredits):
		writeErr(w, http.StatusPaymentRequired, ErrInsufficientCredits.Error())
	case errors.Is(err, ErrIdempotencyConflict):
		writeErr(w, http.StatusConflict, ErrIdempotencyConflict.Error())
	case errors.Is(err, ErrInvalidAmount), errors.Is(err, ErrInvalidIdempotencyKey):
		writeErr(w, http.StatusBadRequest, err.Error())
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
