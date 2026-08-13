package conquest

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/auth"
)

// Handler exposes the durable conquest log HTTP API.
type Handler struct {
	Store *Store
}

type listResponse struct {
	Entries    []Entry `json:"entries"`
	NextOffset *int    `json:"next_offset"`
}

type markReadBody struct {
	All    bool       `json:"all"`
	UpToID *uuid.UUID `json:"up_to_id"`
}

// List handles GET /v1/conquest-log — paginated reverse-chronological flips.
// Query params: limit (default 20, max 100), offset (default 0).
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.Store == nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}

	q := r.URL.Query()
	limit := parseLimit(q.Get("limit"))
	offset := parseOffset(q.Get("offset"))

	items, err := h.Store.List(r.Context(), userID, limit, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if items == nil {
		items = []Entry{}
	}

	resp := listResponse{Entries: items}
	if len(items) == limit {
		next := offset + limit
		resp.NextOffset = &next
	}
	writeJSON(w, http.StatusOK, resp)
}

// UnreadCount handles GET /v1/conquest-log/unread-count.
func (h *Handler) UnreadCount(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.Store == nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	n, err := h.Store.UnreadCount(r.Context(), userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"unread_count": n})
}

// MarkRead handles POST /v1/conquest-log/mark-read.
// Body: { "all": true } or { "up_to_id": "<uuid>" }. The cursor never moves backwards.
func (h *Handler) MarkRead(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.Store == nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}

	var body markReadBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}
	if !body.All && (body.UpToID == nil || *body.UpToID == uuid.Nil) {
		writeErr(w, http.StatusBadRequest, "error_invalid_input")
		return
	}

	updated, err := h.Store.MarkRead(r.Context(), userID, body.UpToID, body.All)
	if err != nil {
		if errors.Is(err, ErrUnknownLog) {
			writeErr(w, http.StatusNotFound, ErrUnknownLog.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"updated": updated})
}

// Supporters handles GET /v1/conquest-log/{log_id}/supporters.
// Query params: limit (default 10, max 50).
func (h *Handler) Supporters(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.Store == nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}

	logID, err := uuid.Parse(r.PathValue("log_id"))
	if err != nil || logID == uuid.Nil {
		writeErr(w, http.StatusBadRequest, "invalid_log_id")
		return
	}

	limit := parseSupporterLimit(r.URL.Query().Get("limit"))
	result, err := h.Store.Supporters(r.Context(), logID, userID, limit)
	if err != nil {
		if errors.Is(err, ErrUnknownLog) {
			writeErr(w, http.StatusNotFound, ErrUnknownLog.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func parseSupporterLimit(raw string) int {
	if raw == "" {
		return defaultSupporterLimit
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultSupporterLimit
	}
	if n > maxSupporterLimit {
		return maxSupporterLimit
	}
	return n
}

func parseLimit(raw string) int {
	if raw == "" {
		return defaultListLimit
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultListLimit
	}
	if n > maxListLimit {
		return maxListLimit
	}
	return n
}

func parseOffset(raw string) int {
	if raw == "" {
		return 0
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

func writeErr(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
