package support

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/credits"
)

// Handler exposes support spend, province control, and personal history APIs.
type Handler struct {
	Service *Service
	Summary *SummaryStore
	History *HistoryStore
}

type errorBody struct {
	Error string `json:"error"`
}

type createRequest struct {
	IlCode  string `json:"il_code"`
	Credits int64  `json:"credits"`
}

// Create handles POST /v1/support.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}

	var req createRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}

	result, err := h.Service.Apply(r.Context(), userID, req.IlCode, req.Credits)
	if err != nil {
		writeSupportErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// Control handles GET /v1/provinces/control — all ils from province_control_summary.
func (h *Handler) Control(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserIDFromContext(r.Context()); !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.Summary == nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	rows, err := h.Summary.ListControl(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if rows == nil {
		rows = []ProvinceControlRow{}
	}
	writeJSON(w, http.StatusOK, controlListResponse{Provinces: rows})
}

// ListMine handles GET /v1/me/supports — session user's history only.
// Query params: limit (default 20, max 100), offset (default 0).
// Any client-supplied user_id is ignored.
func (h *Handler) ListMine(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.History == nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}

	q := r.URL.Query()
	_ = q.Get("user_id") // explicitly ignored — session identity only
	limit := parseHistoryLimit(q.Get("limit"))
	offset := parseHistoryOffset(q.Get("offset"))

	items, err := h.History.ListMine(r.Context(), userID, limit, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if items == nil {
		items = []SupportHistoryItem{}
	}

	resp := historyListResponse{Supports: items}
	if len(items) == limit {
		next := offset + limit
		resp.NextOffset = &next
	}
	writeJSON(w, http.StatusOK, resp)
}

func writeSupportErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrTribeRequired):
		writeErr(w, http.StatusConflict, ErrTribeRequired.Error())
	case errors.Is(err, ErrInvalidIlCode):
		writeErr(w, http.StatusBadRequest, ErrInvalidIlCode.Error())
	case errors.Is(err, ErrInvalidCredits):
		writeErr(w, http.StatusBadRequest, ErrInvalidCredits.Error())
	case errors.Is(err, credits.ErrInsufficientCredits):
		writeErr(w, http.StatusPaymentRequired, credits.ErrInsufficientCredits.Error())
	case errors.Is(err, credits.ErrIdempotencyConflict):
		writeErr(w, http.StatusConflict, credits.ErrIdempotencyConflict.Error())
	case errors.Is(err, credits.ErrInvalidAmount), errors.Is(err, credits.ErrInvalidIdempotencyKey):
		writeErr(w, http.StatusBadRequest, err.Error())
	default:
		writeErr(w, http.StatusInternalServerError, "error_internal")
	}
}

func writeErr(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, errorBody{Error: code})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
