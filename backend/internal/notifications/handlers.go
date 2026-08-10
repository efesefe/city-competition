package notifications

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/city-competition-remastered/backend/internal/auth"
)

// Handler exposes device push-token registration endpoints.
type Handler struct {
	Tokens TokenStore
}

type pushTokenBody struct {
	Platform string `json:"platform"`
	Token    string `json:"token"`
}

// PutPushToken handles PUT /v1/me/push-tokens.
func (h *Handler) PutPushToken(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	var body pushTokenBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}
	if err := h.Tokens.Upsert(r.Context(), userID, body.Platform, body.Token); err != nil {
		if strings.Contains(err.Error(), "invalid") || strings.Contains(err.Error(), "empty") {
			writeErr(w, http.StatusBadRequest, "error_invalid_input")
			return
		}
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeletePushToken handles DELETE /v1/me/push-tokens.
func (h *Handler) DeletePushToken(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	var body pushTokenBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Token) == "" {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}
	if err := h.Tokens.Delete(r.Context(), userID, body.Token); err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeErr(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code})
}
