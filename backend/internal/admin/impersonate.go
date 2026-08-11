package admin

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/auth"
)

const (
	ActionImpersonate = "impersonate"
	TargetTypeUser    = "user"
)

// ImpersonateHandler creates a session for a target user (admin only).
type ImpersonateHandler struct {
	Users    auth.UserStore
	Sessions *auth.SessionService
	Audit    Writer
}

type impersonateBody struct {
	Reason string `json:"reason"`
}

// ServeHTTP handles POST /v1/admin/users/{id}/impersonate.
func (h *ImpersonateHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	actorID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	targetID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_user_id")
		return
	}
	matched, found, err := h.Users.FindByID(r.Context(), targetID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if !found {
		writeErr(w, http.StatusNotFound, ErrNotFound.Error())
		return
	}

	var body impersonateBody
	_ = json.NewDecoder(r.Body).Decode(&body)
	reason := body.Reason
	if reason == "" {
		reason = "admin_impersonate"
	}

	if h.Audit != nil {
		if err := h.Audit.Insert(r.Context(), actorID, ActionImpersonate, TargetTypeUser, matched.ID, map[string]any{
			"reason": reason,
		}); err != nil {
			writeErr(w, http.StatusInternalServerError, "error_internal")
			return
		}
	}

	restricted, err := h.Users.IsRestricted(r.Context(), matched.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	token, err := h.Sessions.Create(r.Context(), matched.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user_id":         matched.ID.String(),
		"session_token":   token,
		"restricted_mode": restricted,
		"actor_id":        actorID.String(),
	})
}
