package erasure

import (
	"encoding/json"
	"net/http"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/logging"
)

// Handler exposes account erasure endpoints.
type Handler struct {
	Store *Store
}

// Request handles POST /v1/account/erasure-request.
func (h *Handler) Request(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	reqID, _ := logging.RequestIDFromContext(r.Context())
	job, err := h.Store.Enqueue(r.Context(), userID, reqID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"job_id":     job.ID.String(),
		"status":     job.Status,
		"request_id": job.RequestID,
	})
}

func writeErr(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
