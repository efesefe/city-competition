package checkout

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/payments/internal/httputil"
	"github.com/city-competition-remastered/payments/internal/providers"
)

// Handler exposes charge/refund HTTP routes.
type Handler struct {
	Service *Service
}

type chargeRequest struct {
	UserID         string `json:"user_id"`
	Provider       string `json:"provider"`
	ProductID      string `json:"product_id"`
	Credits        int64  `json:"credits"`
	AmountKurus    int64  `json:"amount_kurus"`
	IdempotencyKey string `json:"idempotency_key"`
	ReturnURL      string `json:"return_url"`
}

type refundRequest struct {
	PaymentIntentID string `json:"payment_intent_id"`
	IdempotencyKey  string `json:"idempotency_key"`
}

// CreateCharge handles POST /v1/charges.
func (h *Handler) CreateCharge(w http.ResponseWriter, r *http.Request) {
	var req chargeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_input"})
		return
	}
	userID, err := uuid.Parse(strings.TrimSpace(req.UserID))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_user_id"})
		return
	}
	intent, err := h.Service.CreateCharge(r.Context(), CreateInput{
		UserID:         userID,
		Provider:       strings.ToLower(strings.TrimSpace(req.Provider)),
		ProductID:      strings.TrimSpace(req.ProductID),
		Credits:        req.Credits,
		AmountKurus:    req.AmountKurus,
		IdempotencyKey: strings.TrimSpace(req.IdempotencyKey),
		ReturnURL:      strings.TrimSpace(req.ReturnURL),
	})
	if err != nil {
		writeCheckoutErr(w, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"payment_intent_id":   intent.ID.String(),
		"provider":            intent.Provider,
		"checkout_url":        intent.CheckoutURL,
		"provider_payment_id": intent.ProviderPaymentID,
		"status":              intent.Status,
	})
}

// Refund handles POST /v1/refunds.
func (h *Handler) Refund(w http.ResponseWriter, r *http.Request) {
	var req refundRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_input"})
		return
	}
	intentID, err := uuid.Parse(strings.TrimSpace(req.PaymentIntentID))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_payment_intent_id"})
		return
	}
	result, err := h.Service.Refund(r.Context(), intentID, strings.TrimSpace(req.IdempotencyKey))
	if err != nil {
		writeCheckoutErr(w, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"provider_refund_id": result.ProviderRefundID,
	})
}

func writeCheckoutErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httputil.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": ErrInvalidInput.Error()})
	case errors.Is(err, providers.ErrUnknownProvider):
		httputil.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": providers.ErrUnknownProvider.Error()})
	case errors.Is(err, ErrNotFound):
		httputil.WriteJSON(w, http.StatusNotFound, map[string]string{"error": ErrNotFound.Error()})
	case errors.Is(err, ErrAlreadyFinal):
		httputil.WriteJSON(w, http.StatusConflict, map[string]string{"error": ErrAlreadyFinal.Error()})
	case errors.Is(err, providers.ErrProviderHTTP):
		httputil.WriteJSON(w, http.StatusBadGateway, map[string]string{"error": "provider_error"})
	default:
		httputil.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "error_internal"})
	}
}
