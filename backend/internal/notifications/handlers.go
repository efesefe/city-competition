package notifications

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/auth"
)

// Handler exposes device push-token and in-app inbox endpoints.
type Handler struct {
	Tokens TokenStore
	Inbox  InboxStore
}

type pushTokenBody struct {
	Platform string `json:"platform"`
	Token    string `json:"token"`
}

type markReadBody struct {
	IDs []uuid.UUID `json:"ids"`
	All bool        `json:"all"`
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

// ListNotifications handles GET /v1/notifications.
func (h *Handler) ListNotifications(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.Inbox == nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	list, err := h.Inbox.List(r.Context(), userID, inboxListLimit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"notifications": list})
}

// UnreadCount handles GET /v1/notifications/unread-count.
func (h *Handler) UnreadCount(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.Inbox == nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	n, err := h.Inbox.UnreadCount(r.Context(), userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"unread_count": n})
}

// MarkRead handles POST /v1/notifications/mark-read.
func (h *Handler) MarkRead(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.Inbox == nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	var body markReadBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}
	if !body.All && len(body.IDs) == 0 {
		writeErr(w, http.StatusBadRequest, "error_invalid_input")
		return
	}
	updated, err := h.Inbox.MarkRead(r.Context(), userID, body.IDs, body.All)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"updated": updated})
}

func writeErr(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
