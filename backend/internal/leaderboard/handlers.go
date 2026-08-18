package leaderboard

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/derby"
	"github.com/city-competition-remastered/backend/internal/support"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultLimit = 50
	maxLimit     = 100
	// Over-fetch from Redis so restricted members can be filtered while still
	// filling the requested public page size.
	fetchMultiplier = 3
)

// Handler serves supporter boards and standings reads.
type Handler struct {
	Store    *LeaderboardStore
	Profiles ProfileLookup
	Control  *support.ControlCache
	Derbies  *derby.Service
	Pool     *pgxpool.Pool
}

type errorBody struct {
	Error string `json:"error"`
}

// PublicEntry is one visible leaderboard row after restricted-mode filtering.
type PublicEntry struct {
	Rank     int       `json:"rank"`
	UserID   uuid.UUID `json:"user_id"`
	Username string    `json:"username"`
	Score    float64   `json:"score"`
}

// MeRank is the caller's personal rank/score on a board (unfiltered Redis rank).
type MeRank struct {
	Rank  int64   `json:"rank"`
	Score float64 `json:"score"`
}

type boardResponse struct {
	Entries []PublicEntry `json:"entries"`
	Limit   int           `json:"limit"`
	Me      *MeRank       `json:"me,omitempty"`
}

// Global handles GET /v1/leaderboards/global.
func (h *Handler) Global(w http.ResponseWriter, r *http.Request) {
	h.serveBoard(w, r, GlobalKey())
}

// Tribe handles GET /v1/leaderboards/tribes/{tribe_id}.
func (h *Handler) Tribe(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("tribe_id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_tribe_id")
		return
	}
	h.serveBoard(w, r, TribeKey(id))
}

// Province handles GET /v1/leaderboards/provinces/{il_code}.
func (h *Handler) Province(w http.ResponseWriter, r *http.Request) {
	il := r.PathValue("il_code")
	if il == "" {
		writeErr(w, http.StatusBadRequest, "invalid_il_code")
		return
	}
	h.serveBoard(w, r, ProvinceKey(il))
}

// DerbySupporters handles GET /v1/leaderboards/derbies/{derby_id}.
func (h *Handler) DerbySupporters(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("derby_id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_derby_id")
		return
	}
	h.serveBoard(w, r, DerbyKey(id))
}

// Me handles GET /v1/leaderboards/me?scope=global|tribe|province|derby&id=...
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	key, err := resolveScopeKey(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	rank, err := h.Store.Rank(r.Context(), key, userID.String())
	if err != nil {
		if errors.Is(err, redis.Nil) {
			writeJSON(w, http.StatusOK, map[string]any{"me": nil})
			return
		}
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	// ZREVRANK is 0-based; expose 1-based for API consumers.
	writeJSON(w, http.StatusOK, map[string]any{
		"me": MeRank{Rank: rank.Rank + 1, Score: rank.Score},
	})
}

// ProvinceStandings handles GET /v1/provinces/{il_code}/standings (05.4).
func (h *Handler) ProvinceStandings(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserIDFromContext(r.Context()); !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.Control == nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	il := r.PathValue("il_code")
	pc, err := h.Control.Get(r.Context(), il)
	if err != nil {
		if errors.Is(err, support.ErrInvalidIlCode) {
			writeErr(w, http.StatusBadRequest, support.ErrInvalidIlCode.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, pc)
}

// DerbyStandings handles GET /v1/derbies/{id}/standings (05.5).
func (h *Handler) DerbyStandings(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserIDFromContext(r.Context()); !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.Derbies == nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_derby_id")
		return
	}
	d, err := h.Derbies.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, derby.ErrNotFound) {
			writeErr(w, http.StatusNotFound, derby.ErrNotFound.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"derby_id":              d.ID,
		"il_code":               d.IlCode,
		"status":                d.Status,
		"host_tribe_id":         d.HostTribeID,
		"guest_tribe_id":        d.GuestTribeID,
		"host_effective_total":  d.HostEffectiveTotal,
		"guest_effective_total": d.GuestEffectiveTotal,
	})
}

func (h *Handler) serveBoard(w http.ResponseWriter, r *http.Request, key string) {
	viewerID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	limit := parseLimit(r)
	fetchN := int64(limit * fetchMultiplier)
	if fetchN < int64(limit) {
		fetchN = int64(limit)
	}
	raw, err := h.Store.Top(r.Context(), key, fetchN)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}

	members := make([]string, len(raw))
	for i, e := range raw {
		members[i] = e.Member
	}
	ids := parseUserIDs(members)
	profiles, err := h.Profiles.Profiles(r.Context(), ids)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}

	entries := make([]PublicEntry, 0, limit)
	for _, e := range raw {
		uid, err := uuid.Parse(e.Member)
		if err != nil {
			continue
		}
		profile, ok := profiles[uid]
		if !ok || !PublicVisible(profile) {
			continue
		}
		entries = append(entries, PublicEntry{
			Rank:     len(entries) + 1,
			UserID:   uid,
			Username: profile.Username,
			Score:    e.Score,
		})
		if len(entries) >= limit {
			break
		}
	}

	resp := boardResponse{Entries: entries, Limit: limit}
	if me, ok := h.viewerMe(r, key, viewerID); ok {
		resp.Me = &me
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) viewerMe(r *http.Request, key string, viewerID uuid.UUID) (MeRank, bool) {
	rank, err := h.Store.Rank(r.Context(), key, viewerID.String())
	if err != nil {
		return MeRank{}, false
	}
	return MeRank{Rank: rank.Rank + 1, Score: rank.Score}, true
}

func parseLimit(r *http.Request) int {
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return defaultLimit
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultLimit
	}
	if n > maxLimit {
		return maxLimit
	}
	return n
}

func resolveScopeKey(r *http.Request) (string, error) {
	scope := r.URL.Query().Get("scope")
	switch scope {
	case "global", "":
		return GlobalKey(), nil
	case "tribe":
		id, err := uuid.Parse(r.URL.Query().Get("id"))
		if err != nil {
			return "", errors.New("invalid_tribe_id")
		}
		return TribeKey(id), nil
	case "province":
		il := r.URL.Query().Get("id")
		if il == "" {
			il = r.URL.Query().Get("il_code")
		}
		if il == "" {
			return "", errors.New("invalid_il_code")
		}
		return ProvinceKey(il), nil
	case "derby":
		id, err := uuid.Parse(r.URL.Query().Get("id"))
		if err != nil {
			return "", errors.New("invalid_derby_id")
		}
		return DerbyKey(id), nil
	default:
		return "", errors.New("invalid_scope")
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
