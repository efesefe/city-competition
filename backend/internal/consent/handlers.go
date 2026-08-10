package consent

import (
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/auth"
)

// Handler exposes consent status and grant endpoints.
type Handler struct {
	Store Store
	RDB   redis.Cmdable // optional; required for synchronous location withdraw
}

type errorBody struct {
	Error string `json:"error"`
}

type grantBody struct {
	ConsentType    string `json:"consent_type"`
	ConsentVersion string `json:"consent_version"`
	Granted        *bool  `json:"granted"`
}

type statusTypeView struct {
	PublishedVersion string     `json:"published_version"`
	BodyText         string     `json:"body_text"`
	Granted          *bool      `json:"granted"`
	ConsentVersion   *string    `json:"consent_version"`
	GrantedAt        *time.Time `json:"granted_at"`
}

// Status handles GET /v1/consent/status
func (h *Handler) Status(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}

	published, err := h.Store.PublishedVersions(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	latest, err := h.Store.LatestEvents(r.Context(), userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}

	out := make(map[string]statusTypeView, len(published))
	for _, p := range published {
		view := statusTypeView{
			PublishedVersion: p.Version,
			BodyText:         p.BodyText,
		}
		if ev, ok := latest[p.ConsentType]; ok && ev != nil {
			g := ev.Granted
			v := ev.ConsentVersion
			t := ev.CreatedAt
			view.Granted = &g
			view.ConsentVersion = &v
			view.GrantedAt = &t
		}
		out[string(p.ConsentType)] = view
	}
	writeJSON(w, http.StatusOK, map[string]any{"consents": out})
}

// Grant handles POST /v1/consent/grant
func (h *Handler) Grant(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}

	var body grantBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}

	ct := ConsentType(body.ConsentType)
	if !validType(ct) {
		writeErr(w, http.StatusBadRequest, "error_invalid_consent_type")
		return
	}
	if body.ConsentVersion == "" {
		writeErr(w, http.StatusBadRequest, "error_invalid_consent_version")
		return
	}

	published, err := h.Store.PublishedVersion(r.Context(), ct)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if body.ConsentVersion != published.Version {
		writeErr(w, http.StatusConflict, ErrVersionOutdated.Error())
		return
	}

	granted := true
	if body.Granted != nil {
		granted = *body.Granted
	}

	var ipPtr *string
	if ip := clientIP(r); ip != "" {
		ipPtr = &ip
	}
	var uaPtr *string
	if ua := r.Header.Get("User-Agent"); ua != "" {
		uaPtr = &ua
	}

	if err := h.Store.InsertEvent(r.Context(), InsertEvent{
		UserID:         userID,
		ConsentType:    ct,
		ConsentVersion: body.ConsentVersion,
		Granted:        granted,
		IPAddress:      ipPtr,
		UserAgent:      uaPtr,
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"consent_type":    string(ct),
		"consent_version": body.ConsentVersion,
		"granted":         granted,
	})
}

func validType(t ConsentType) bool {
	for _, known := range AllTypes {
		if t == known {
			return true
		}
	}
	return false
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		candidate := strings.TrimSpace(parts[0])
		if net.ParseIP(candidate) != nil {
			return candidate
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		if net.ParseIP(r.RemoteAddr) != nil {
			return r.RemoteAddr
		}
		return ""
	}
	if net.ParseIP(host) != nil {
		return host
	}
	return ""
}

func writeErr(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, errorBody{Error: code})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
