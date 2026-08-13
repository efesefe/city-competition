package presence

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/auth"
)

const (
	errInvalidTribeID = "invalid_tribe_id"
	errTribeNotFound  = "tribe_not_found"
	errNotMember      = "error_not_member"
	errInternal       = "error_internal"
)

// Handler exposes presence HTTP endpoints.
type Handler struct {
	Tracker     *Tracker
	Memberships MembershipLookup
	// TribeExists reports whether tribeID is a known tribe. Missing tribes 404.
	TribeExists func(ctx context.Context, tribeID uuid.UUID) (bool, error)
}

type errorBody struct {
	Error string `json:"error"`
}

// OnlineCount handles GET /v1/presence/online-count.
func (h *Handler) OnlineCount(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserIDFromContext(r.Context()); !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	n, err := h.Tracker.OnlineCount(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, errInternal)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"approximate_count": n})
}

// OnlineMembers handles GET /v1/tribes/{tribe_id}/online-members.
func (h *Handler) OnlineMembers(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	tribeID, err := uuid.Parse(r.PathValue("tribe_id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, errInvalidTribeID)
		return
	}
	if h.TribeExists != nil {
		exists, err := h.TribeExists(r.Context(), tribeID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, errInternal)
			return
		}
		if !exists {
			writeErr(w, http.StatusNotFound, errTribeNotFound)
			return
		}
	}
	if h.Memberships != nil {
		got, err := h.Memberships.TribeID(r.Context(), userID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, errInternal)
			return
		}
		if got == nil || *got != tribeID {
			writeErr(w, http.StatusForbidden, errNotMember)
			return
		}
	}
	ids, err := h.Tracker.OnlineMembers(r.Context(), tribeID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, errInternal)
		return
	}
	if ids == nil {
		ids = []uuid.UUID{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user_ids":          ids,
		"approximate_count": len(ids),
	})
}

func writeErr(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, errorBody{Error: code})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
