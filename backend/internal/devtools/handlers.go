package devtools

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/auth"
)

var (
	errMissingIdentity = errors.New("error_missing_identity")
	errInvalidUserID   = errors.New("error_invalid_user_id")
)

// Handler serves local-only login-as and QA persona endpoints.
type Handler struct {
	Pool     *pgxpool.Pool
	Users    auth.UserStore
	Sessions *auth.SessionService
	Enabled  bool
}

type loginAsBody struct {
	Phone    string `json:"phone"`
	UserID   string `json:"user_id"`
	Username string `json:"username"`
}

type errorBody struct {
	Error string `json:"error"`
}

// LoginAs handles POST /v1/dev/login-as.
func (h *Handler) LoginAs(w http.ResponseWriter, r *http.Request) {
	if !h.Enabled {
		writeErr(w, http.StatusNotFound, "error_not_found")
		return
	}
	var body loginAsBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}

	matched, ok, err := h.resolveUser(r, body)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if !ok {
		writeErr(w, http.StatusNotFound, "error_user_not_found")
		return
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
	})
}

func (h *Handler) resolveUser(r *http.Request, body loginAsBody) (auth.MatchUser, bool, error) {
	switch {
	case strings.TrimSpace(body.UserID) != "":
		id, err := uuid.Parse(strings.TrimSpace(body.UserID))
		if err != nil {
			return auth.MatchUser{}, false, errInvalidUserID
		}
		return h.Users.FindByID(r.Context(), id)
	case strings.TrimSpace(body.Phone) != "":
		phone, err := auth.NormalizeAndValidatePhone(body.Phone)
		if err != nil {
			return auth.MatchUser{}, false, err
		}
		return h.Users.FindByPhone(r.Context(), phone)
	case strings.TrimSpace(body.Username) != "":
		return h.Users.FindByUsername(r.Context(), strings.TrimSpace(body.Username))
	default:
		return auth.MatchUser{}, false, errMissingIdentity
	}
}

// Persona is one seeded QA account.
type Persona struct {
	ID        string  `json:"id"`
	Username  string  `json:"username"`
	Phone     *string `json:"phone,omitempty"`
	IsAdmin   bool    `json:"is_admin"`
	TribeID   *string `json:"tribe_id,omitempty"`
	TribeSlug *string `json:"tribe_slug,omitempty"`
	TribeName *string `json:"tribe_name,omitempty"`
}

// ListQAPersonas handles GET /v1/dev/qa-personas.
func (h *Handler) ListQAPersonas(w http.ResponseWriter, r *http.Request) {
	if !h.Enabled {
		writeErr(w, http.StatusNotFound, "error_not_found")
		return
	}
	rows, err := h.Pool.Query(r.Context(), `
		SELECT u.id, u.username, u.phone, u.is_admin, u.tribe_id,
		       t.slug, t.display_name
		FROM users u
		LEFT JOIN tribes t ON t.id = u.tribe_id
		WHERE u.username LIKE 'qa\_%' ESCAPE '\'
		ORDER BY u.is_admin DESC, u.username ASC
	`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	defer rows.Close()

	out := make([]Persona, 0)
	for rows.Next() {
		var (
			id       uuid.UUID
			username string
			phone    *string
			isAdmin  bool
			tribeID  *uuid.UUID
			slug     *string
			name     *string
		)
		if err := rows.Scan(&id, &username, &phone, &isAdmin, &tribeID, &slug, &name); err != nil {
			writeErr(w, http.StatusInternalServerError, "error_internal")
			return
		}
		p := Persona{
			ID:        id.String(),
			Username:  username,
			Phone:     phone,
			IsAdmin:   isAdmin,
			TribeSlug: slug,
			TribeName: name,
		}
		if tribeID != nil {
			s := tribeID.String()
			p.TribeID = &s
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"personas": out})
}

// SimulateIyzicoHandler proxies to the payments service simulate endpoint.
type SimulateIyzicoHandler struct {
	PaymentsURL   string
	InternalToken string
	Enabled       bool
	HTTP          *http.Client
}

type simulateBody struct {
	PaymentIntentID string `json:"payment_intent_id"`
}

// ServeHTTP handles POST /v1/dev/payments/simulate-iyzico.
func (h *SimulateIyzicoHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !h.Enabled {
		writeErr(w, http.StatusNotFound, "error_not_found")
		return
	}
	if h.PaymentsURL == "" || h.InternalToken == "" {
		writeErr(w, http.StatusServiceUnavailable, "error_payments_unavailable")
		return
	}
	var body simulateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.PaymentIntentID == "" {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}
	client := h.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	payload, _ := json.Marshal(map[string]string{"payment_intent_id": body.PaymentIntentID})
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost,
		strings.TrimRight(h.PaymentsURL, "/")+"/v1/dev/simulate-iyzico-webhook",
		bytes.NewReader(payload),
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", h.InternalToken)
	res, err := client.Do(req)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "error_payments_unavailable")
		return
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(res.StatusCode)
	if len(raw) == 0 {
		_, _ = w.Write([]byte(`{"status":"ok"}`))
		return
	}
	_, _ = w.Write(raw)
}

func writeErr(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, errorBody{Error: code})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
