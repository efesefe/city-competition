package webhook

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/payments/internal/checkout"
	"github.com/city-competition-remastered/payments/internal/emit"
	"github.com/city-competition-remastered/payments/internal/providers"
)

// Handler processes provider webhooks after mandatory signature verification.
type Handler struct {
	Checkout  *checkout.Service
	Providers providers.Registry
	Emitter   *emit.Client
	Logger    *slog.Logger
}

// ServeHTTP handles POST /v1/webhooks/{provider}.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	providerName := r.PathValue("provider")
	prov, err := h.Providers.Get(providerName)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown_provider"})
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_body"})
		return
	}
	if err := prov.VerifyWebhookSignature(r.Header, body); err != nil {
		if h.Logger != nil {
			h.Logger.Warn("webhook signature rejected", "provider", providerName)
		}
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_webhook_signature"})
		return
	}
	event, err := prov.ParseWebhook(body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_webhook"})
		return
	}
	intentID, err := uuid.Parse(event.ConversationID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_conversation_id"})
		return
	}
	if event.Status == "chargeback" {
		intent, err := h.Checkout.ByID(r.Context(), intentID)
		if err != nil {
			if errors.Is(err, checkout.ErrNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "error_internal"})
			return
		}
		if intent.Status == "succeeded" {
			_ = h.Checkout.MarkRefunded(r.Context(), intentID)
		}
		if h.Emitter != nil {
			if err := h.Emitter.Chargeback(r.Context(), emit.ChargebackPayload{
				UserID:            intent.UserID,
				Provider:          intent.Provider,
				ProviderPaymentID: firstNonEmpty(event.ProviderPaymentID, intent.ProviderPaymentID),
				PaymentIntentID:   intent.ID,
			}); err != nil {
				if h.Logger != nil {
					h.Logger.Error("chargeback emit failed", "intent_id", intent.ID.String(), "err", err.Error())
				}
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": "emit_failed"})
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "chargeback"})
		return
	}
	if event.Status != "succeeded" {
		_ = h.Checkout.MarkFailed(r.Context(), intentID)
		writeJSON(w, http.StatusOK, map[string]string{"status": "ignored"})
		return
	}
	intent, newlySucceeded, err := h.Checkout.MarkSucceeded(r.Context(), intentID, event.ProviderPaymentID)
	if err != nil {
		if errors.Is(err, checkout.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
			return
		}
		if errors.Is(err, checkout.ErrAlreadyFinal) {
			writeJSON(w, http.StatusOK, map[string]string{"status": "already_final"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "error_internal"})
		return
	}
	if newlySucceeded && h.Emitter != nil {
		if err := h.Emitter.CreditGrant(r.Context(), emit.CreditGrantPayload{
			UserID:            intent.UserID,
			Credits:           intent.Credits,
			ProductID:         intent.ProductID,
			Provider:          intent.Provider,
			ProviderPaymentID: intent.ProviderPaymentID,
			PaymentIntentID:   intent.ID,
		}); err != nil {
			if h.Logger != nil {
				h.Logger.Error("credit grant emit failed", "intent_id", intent.ID.String(), "err", err.Error())
			}
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "emit_failed"})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" && v != "<nil>" {
			return v
		}
	}
	return ""
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
