package derby

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/db"
)

// Handler exposes admin create/force-resolve and authenticated list/get.
type Handler struct {
	Service *Service
}

type errorBody struct {
	Error string `json:"error"`
}

type createBody struct {
	HostTribeID  uuid.UUID `json:"host_tribe_id"`
	GuestTribeID uuid.UUID `json:"guest_tribe_id"`
	IlCode       string    `json:"il_code"`
	StartsAt     time.Time `json:"starts_at"`
	EndsAt       time.Time `json:"ends_at"`
}

// Create handles POST /v1/admin/derbies.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	adminID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}

	var body createBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, ErrInvalidInput.Error())
		return
	}

	d, err := h.Service.Create(r.Context(), CreateInput{
		HostTribeID:      body.HostTribeID,
		GuestTribeID:     body.GuestTribeID,
		IlCode:           body.IlCode,
		StartsAt:         body.StartsAt.UTC(),
		EndsAt:           body.EndsAt.UTC(),
		CreatedByAdminID: adminID,
	})
	if err != nil {
		writeCreateErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, d)
}

func writeCreateErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, db.ErrWritePathDegraded):
		writeErr(w, http.StatusServiceUnavailable, db.ErrWritePathDegraded.Error())
	case errors.Is(err, ErrSameTribe):
		writeErr(w, http.StatusBadRequest, ErrSameTribe.Error())
	case errors.Is(err, ErrInvalidWindow):
		writeErr(w, http.StatusBadRequest, ErrInvalidWindow.Error())
	case errors.Is(err, ErrInvalidIlCode):
		writeErr(w, http.StatusBadRequest, ErrInvalidIlCode.Error())
	case errors.Is(err, ErrInvalidInput):
		writeErr(w, http.StatusBadRequest, ErrInvalidInput.Error())
	case errors.Is(err, ErrTribeNotFound):
		writeErr(w, http.StatusBadRequest, ErrTribeNotFound.Error())
	case errors.Is(err, ErrInactiveTribe):
		writeErr(w, http.StatusBadRequest, ErrInactiveTribe.Error())
	default:
		writeErr(w, http.StatusInternalServerError, "error_internal")
	}
}

// ForceResolve handles POST /v1/admin/derbies/{id}/force-resolve.
func (h *Handler) ForceResolve(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserIDFromContext(r.Context()); !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_derby_id")
		return
	}
	d, err := h.Service.ForceResolve(r.Context(), id)
	if err != nil {
		switch {
		case errors.Is(err, db.ErrWritePathDegraded):
			writeErr(w, http.StatusServiceUnavailable, db.ErrWritePathDegraded.Error())
		case errors.Is(err, ErrNotFound):
			writeErr(w, http.StatusNotFound, ErrNotFound.Error())
		case errors.Is(err, ErrAlreadyResolved):
			writeErr(w, http.StatusConflict, ErrAlreadyResolved.Error())
		default:
			writeErr(w, http.StatusInternalServerError, "error_internal")
		}
		return
	}
	writeJSON(w, http.StatusOK, d)
}

// List handles GET /v1/derbies.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserIDFromContext(r.Context()); !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	list, err := h.Service.List(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if list == nil {
		list = []Derby{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"derbies": list})
}

// Get handles GET /v1/derbies/{id}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserIDFromContext(r.Context()); !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_derby_id")
		return
	}
	d, err := h.Service.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			writeErr(w, http.StatusNotFound, ErrNotFound.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func writeErr(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, errorBody{Error: code})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
