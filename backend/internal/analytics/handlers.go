package analytics

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/city-competition-remastered/backend/internal/auth"
)

// Handler serves admin analytics dashboard APIs.
type Handler struct {
	Store *Store
}

type errorBody struct {
	Error string `json:"error"`
}

// Funnel handles GET /v1/admin/analytics/funnel?from=&to=
func (h *Handler) Funnel(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserIDFromContext(r.Context()); !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	from, to, ok := parseDateRange(w, r)
	if !ok {
		return
	}
	rows, err := h.Store.ListFunnel(r.Context(), from, to)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if rows == nil {
		rows = []FunnelDay{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"days": rows})
}

// Cohorts handles GET /v1/admin/analytics/cohorts?from=&to=
func (h *Handler) Cohorts(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserIDFromContext(r.Context()); !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	from, to, ok := parseDateRange(w, r)
	if !ok {
		return
	}
	rows, err := h.Store.ListCohorts(r.Context(), from, to)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if rows == nil {
		rows = []CohortDay{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"cohorts": rows})
}

// Heatmap handles GET /v1/admin/analytics/heatmap
func (h *Handler) Heatmap(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserIDFromContext(r.Context()); !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	rows, err := h.Store.ListHeatmap(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if rows == nil {
		rows = []HeatmapRow{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"provinces": rows})
}

func parseDateRange(w http.ResponseWriter, r *http.Request) (from, to time.Time, ok bool) {
	now := time.Now().UTC()
	to = truncateUTCDate(now)
	from = to.AddDate(0, 0, -29)

	if raw := r.URL.Query().Get("from"); raw != "" {
		parsed, err := time.Parse("2006-01-02", raw)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "error_invalid_from")
			return time.Time{}, time.Time{}, false
		}
		from = truncateUTCDate(parsed)
	}
	if raw := r.URL.Query().Get("to"); raw != "" {
		parsed, err := time.Parse("2006-01-02", raw)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "error_invalid_to")
			return time.Time{}, time.Time{}, false
		}
		to = truncateUTCDate(parsed)
	}
	if to.Before(from) {
		writeErr(w, http.StatusBadRequest, "error_invalid_range")
		return time.Time{}, time.Time{}, false
	}
	return from, to, true
}

func writeErr(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, errorBody{Error: code})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
