package monetization

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/auth"
)

const (
	auditActionPromoActivate   = "promo_activate"
	auditActionPromoDeactivate = "promo_deactivate"
	auditTargetTypePromo       = "purchase_promo"
)

type activatePromoRequest struct {
	BonusPercent int64 `json:"bonus_percent"`
}

func promoAdminDTO(p Promo) map[string]any {
	return map[string]any{
		"id":            p.ID.String(),
		"bonus_percent": p.BonusPercent,
		"active":        p.Active,
		"created_at":    p.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	}
}

// GetPromo handles GET /v1/admin/promos.
func (h *Handler) GetPromo(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserIDFromContext(r.Context()); !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.Promos == nil {
		writeJSON(w, http.StatusOK, map[string]any{"promo": nil})
		return
	}
	p, err := h.Promos.Active(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if !p.Active {
		writeJSON(w, http.StatusOK, map[string]any{"promo": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"promo": promoAdminDTO(p)})
}

// ActivatePromo handles POST /v1/admin/promos.
func (h *Handler) ActivatePromo(w http.ResponseWriter, r *http.Request) {
	adminID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.Promos == nil {
		writeErr(w, http.StatusServiceUnavailable, ErrVerifierUnavailable.Error())
		return
	}
	var req activatePromoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input")
		return
	}
	p, err := h.Promos.Activate(r.Context(), adminID, req.BonusPercent)
	if err != nil {
		writeIAPErr(w, err)
		return
	}
	h.auditPromo(r, adminID, auditActionPromoActivate, p)
	writeJSON(w, http.StatusOK, map[string]any{"promo": promoAdminDTO(p)})
}

// DeactivatePromo handles POST /v1/admin/promos/deactivate.
func (h *Handler) DeactivatePromo(w http.ResponseWriter, r *http.Request) {
	adminID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.Promos == nil {
		writeErr(w, http.StatusServiceUnavailable, ErrVerifierUnavailable.Error())
		return
	}
	p, err := h.Promos.Deactivate(r.Context(), adminID)
	if err != nil {
		writeIAPErr(w, err)
		return
	}
	h.auditPromo(r, adminID, auditActionPromoDeactivate, p)
	writeJSON(w, http.StatusOK, map[string]any{"promo": promoAdminDTO(p)})
}

func (h *Handler) auditPromo(r *http.Request, adminID uuid.UUID, action string, p Promo) {
	if h.Audit == nil {
		return
	}
	_ = h.Audit.Insert(r.Context(), adminID, action, auditTargetTypePromo, p.ID, map[string]any{
		"bonus_percent": p.BonusPercent,
	})
}
