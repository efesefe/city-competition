package tribe

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/cache"
	"github.com/city-competition-remastered/backend/internal/moderation"
)

var hexColor = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

// Handler exposes tribe list/join/switch and admin CRUD endpoints.
type Handler struct {
	Store       Store
	Cooldown    time.Duration
	Now         func() time.Time
	Broadcaster cache.Broadcaster
	Classifier  moderation.ContentClassifier
}

func (h *Handler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now().UTC()
}

type errorBody struct {
	Error string `json:"error"`
}

// List handles GET /v1/tribes.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}

	tribes, err := h.Store.ListActive(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if tribes == nil {
		tribes = []Tribe{}
	}

	tribeID, switchedAt, err := h.Store.GetMembership(r.Context(), userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}

	membership := Membership{
		TribeID:         tribeID,
		TribeSwitchedAt: switchedAt,
	}
	if switchedAt != nil {
		available := switchedAt.Add(h.Cooldown)
		membership.SwitchAvailableAt = &available
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"tribes":     tribes,
		"membership": membership,
	})
}

// Get handles GET /v1/tribes/{id}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_tribe_id")
		return
	}

	t, err := h.Store.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			writeErr(w, http.StatusNotFound, ErrNotFound.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if !t.IsActive {
		writeErr(w, http.StatusNotFound, ErrNotFound.Error())
		return
	}
	writeJSON(w, http.StatusOK, t)
}

// Join handles POST /v1/tribes/{id}/join.
// Restricted-mode users may join; tribe chat remains gated separately.
func (h *Handler) Join(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_tribe_id")
		return
	}

	err = h.Store.Join(r.Context(), userID, id, h.now())
	if err != nil {
		writeJoinSwitchErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tribe_id": id})
}

// Switch handles POST /v1/tribes/{id}/switch.
// Only updates users.tribe_id / tribe_switched_at; does not rewrite support history.
func (h *Handler) Switch(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_tribe_id")
		return
	}

	err = h.Store.Switch(r.Context(), userID, id, h.now(), h.Cooldown)
	if err != nil {
		writeJoinSwitchErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tribe_id": id})
}

func writeJoinSwitchErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		writeErr(w, http.StatusNotFound, ErrNotFound.Error())
	case errors.Is(err, ErrInactiveTribe):
		writeErr(w, http.StatusNotFound, ErrNotFound.Error())
	case errors.Is(err, ErrAlreadyInTribe):
		writeErr(w, http.StatusConflict, ErrAlreadyInTribe.Error())
	case errors.Is(err, ErrSwitchCooldown):
		writeErr(w, http.StatusTooManyRequests, ErrSwitchCooldown.Error())
	default:
		writeErr(w, http.StatusInternalServerError, "error_internal")
	}
}

type createBody struct {
	Slug           string `json:"slug"`
	DisplayName    string `json:"display_name"`
	ShortName      string `json:"short_name"`
	PrimaryColor   string `json:"primary_color"`
	SecondaryColor string `json:"secondary_color"`
}

type patchBody struct {
	DisplayName    *string `json:"display_name"`
	ShortName      *string `json:"short_name"`
	PrimaryColor   *string `json:"primary_color"`
	SecondaryColor *string `json:"secondary_color"`
	IsActive       *bool   `json:"is_active"`
}

// Create handles POST /v1/admin/tribes.
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
	body.Slug = strings.TrimSpace(body.Slug)
	body.DisplayName = strings.TrimSpace(body.DisplayName)
	body.ShortName = strings.TrimSpace(body.ShortName)
	if body.Slug == "" || body.DisplayName == "" || body.ShortName == "" {
		writeErr(w, http.StatusBadRequest, ErrInvalidInput.Error())
		return
	}
	if !hexColor.MatchString(body.PrimaryColor) || !hexColor.MatchString(body.SecondaryColor) {
		writeErr(w, http.StatusBadRequest, ErrInvalidColor.Error())
		return
	}

	t, err := h.Store.Create(r.Context(), CreateTribeInput{
		Slug:             body.Slug,
		DisplayName:      body.DisplayName,
		ShortName:        body.ShortName,
		PrimaryColor:     body.PrimaryColor,
		SecondaryColor:   body.SecondaryColor,
		CreatedByAdminID: adminID,
	})
	if err != nil {
		if errors.Is(err, ErrSlugTaken) {
			writeErr(w, http.StatusConflict, ErrSlugTaken.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

// Patch handles PATCH /v1/admin/tribes/{id}.
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_tribe_id")
		return
	}

	var body patchBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, ErrInvalidInput.Error())
		return
	}
	if body.DisplayName != nil {
		v := strings.TrimSpace(*body.DisplayName)
		if v == "" {
			writeErr(w, http.StatusBadRequest, ErrInvalidInput.Error())
			return
		}
		body.DisplayName = &v
	}
	if body.ShortName != nil {
		v := strings.TrimSpace(*body.ShortName)
		if v == "" {
			writeErr(w, http.StatusBadRequest, ErrInvalidInput.Error())
			return
		}
		body.ShortName = &v
	}
	if body.PrimaryColor != nil && !hexColor.MatchString(*body.PrimaryColor) {
		writeErr(w, http.StatusBadRequest, ErrInvalidColor.Error())
		return
	}
	if body.SecondaryColor != nil && !hexColor.MatchString(*body.SecondaryColor) {
		writeErr(w, http.StatusBadRequest, ErrInvalidColor.Error())
		return
	}

	t, err := h.Store.Update(r.Context(), id, UpdateTribeInput{
		DisplayName:    body.DisplayName,
		ShortName:      body.ShortName,
		PrimaryColor:   body.PrimaryColor,
		SecondaryColor: body.SecondaryColor,
		IsActive:       body.IsActive,
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			writeErr(w, http.StatusNotFound, ErrNotFound.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func writeErr(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, errorBody{Error: code})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
