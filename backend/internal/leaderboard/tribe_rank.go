package leaderboard

import (
	"context"
	"fmt"
	"net/http"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/auth"
)

const tribeRankBootKey = "lb:tribe_rank:bootstrapped"

// TribeRankEntry is one row on the most-supported-tribes board.
type TribeRankEntry struct {
	Rank           int       `json:"rank"`
	TribeID        uuid.UUID `json:"tribe_id"`
	Slug           string    `json:"slug"`
	DisplayName    string    `json:"display_name"`
	ShortName      string    `json:"short_name"`
	PrimaryColor   string    `json:"primary_color"`
	SecondaryColor string    `json:"secondary_color"`
	Score          float64   `json:"score"`
}

type tribeRankResponse struct {
	Entries []TribeRankEntry `json:"entries"`
	Limit   int              `json:"limit"`
	Me      *MeRank          `json:"me,omitempty"`
}

type tribeMeta struct {
	Slug           string
	DisplayName    string
	ShortName      string
	PrimaryColor   string
	SecondaryColor string
}

// TribeRank handles GET /v1/leaderboards/tribe-rank.
func (h *Handler) TribeRank(w http.ResponseWriter, r *http.Request) {
	viewerID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if err := h.ensureTribeRankSeeded(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	limit := parseLimit(r)
	raw, err := h.Store.Top(r.Context(), TribeRankKey(), int64(limit))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	ids := make([]uuid.UUID, 0, len(raw))
	for _, e := range raw {
		id, perr := uuid.Parse(e.Member)
		if perr != nil {
			continue
		}
		ids = append(ids, id)
	}
	meta, err := h.loadTribeMeta(r.Context(), ids)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	entries := make([]TribeRankEntry, 0, len(raw))
	for _, e := range raw {
		id, perr := uuid.Parse(e.Member)
		if perr != nil {
			continue
		}
		info, ok := meta[id]
		if !ok {
			continue
		}
		entries = append(entries, TribeRankEntry{
			Rank:           len(entries) + 1,
			TribeID:        id,
			Slug:           info.Slug,
			DisplayName:    info.DisplayName,
			ShortName:      info.ShortName,
			PrimaryColor:   info.PrimaryColor,
			SecondaryColor: info.SecondaryColor,
			Score:          e.Score,
		})
	}
	resp := tribeRankResponse{Entries: entries, Limit: limit}
	if tribeID, ok := h.viewerTribeID(r.Context(), viewerID); ok {
		if me, ok := h.viewerMe(r, TribeRankKey(), tribeID); ok {
			resp.Me = &me
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) ensureTribeRankSeeded(ctx context.Context) error {
	if h == nil || h.Store == nil || h.Store.RDB == nil || h.Pool == nil {
		return nil
	}
	n, err := h.Store.RDB.ZCard(ctx, TribeRankKey()).Result()
	if err != nil {
		return fmt.Errorf("tribe rank zcard: %w", err)
	}
	if n > 0 {
		return nil
	}
	ok, err := h.Store.RDB.SetNX(ctx, tribeRankBootKey, "1", 0).Result()
	if err != nil {
		return fmt.Errorf("tribe rank bootstrap: %w", err)
	}
	if !ok {
		return nil
	}
	rows, err := h.Pool.Query(ctx, `
		SELECT tribe_id, SUM(effective_support_sum)
		FROM tribe_province_scores
		GROUP BY tribe_id
	`)
	if err != nil {
		return fmt.Errorf("tribe rank seed query: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var tribeID uuid.UUID
		var sum float64
		if err := rows.Scan(&tribeID, &sum); err != nil {
			return fmt.Errorf("tribe rank seed scan: %w", err)
		}
		if tribeID == uuid.Nil || sum == 0 {
			continue
		}
		if err := h.Store.Incr(ctx, TribeRankKey(), tribeID.String(), sum); err != nil {
			return err
		}
	}
	return rows.Err()
}

func (h *Handler) loadTribeMeta(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]tribeMeta, error) {
	out := make(map[uuid.UUID]tribeMeta, len(ids))
	if h.Pool == nil || len(ids) == 0 {
		return out, nil
	}
	rows, err := h.Pool.Query(ctx, `
		SELECT id, slug, display_name, short_name, primary_color, secondary_color
		FROM tribes
		WHERE id = ANY($1)
	`, ids)
	if err != nil {
		return nil, fmt.Errorf("tribe meta: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var m tribeMeta
		if err := rows.Scan(&id, &m.Slug, &m.DisplayName, &m.ShortName, &m.PrimaryColor, &m.SecondaryColor); err != nil {
			return nil, fmt.Errorf("tribe meta scan: %w", err)
		}
		out[id] = m
	}
	return out, rows.Err()
}

func (h *Handler) viewerTribeID(ctx context.Context, userID uuid.UUID) (uuid.UUID, bool) {
	if h.Pool == nil {
		return uuid.Nil, false
	}
	var tribeID *uuid.UUID
	err := h.Pool.QueryRow(ctx, `SELECT tribe_id FROM users WHERE id = $1`, userID).Scan(&tribeID)
	if err != nil || tribeID == nil || *tribeID == uuid.Nil {
		return uuid.Nil, false
	}
	return *tribeID, true
}
