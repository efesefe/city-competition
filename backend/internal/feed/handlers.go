package feed

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/auth"
)

// Handler exposes read endpoints for the activity feed.
type Handler struct {
	Store Store
	Pool  *pgxpool.Pool
}

// EventView is a feed row plus a backend-rendered localized message.
type EventView struct {
	ID               uuid.UUID  `json:"id"`
	EventType        EventType  `json:"event_type"`
	ActorID          uuid.UUID  `json:"actor_id"`
	ActorDisplayName string     `json:"actor_display_name"`
	PlaceName        string     `json:"place_name"`
	PlaceType        PlaceType  `json:"place_type"`
	TribeID          *uuid.UUID `json:"tribe_id,omitempty"`
	CreatedAt        string     `json:"created_at"`
	Message          string     `json:"message"`
}

// List handles GET /v1/feed — structured events with read-time Render() messages.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserIDFromContext(r.Context()); !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}

	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = n
		}
	}

	events, err := h.Store.ListRecent(r.Context(), limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}

	names, err := h.actorNames(r.Context(), events)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}

	out := make([]EventView, 0, len(events))
	for _, e := range events {
		display := names[e.ActorID]
		if display == "" {
			display = e.ActorID.String()
		}
		out = append(out, EventView{
			ID:               e.ID,
			EventType:        e.EventType,
			ActorID:          e.ActorID,
			ActorDisplayName: display,
			PlaceName:        e.PlaceName,
			PlaceType:        e.PlaceType,
			TribeID:          e.TribeID,
			CreatedAt:        e.CreatedAt.UTC().Format(time.RFC3339),
			Message:          Render(e, display),
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"events": out})
}

func (h *Handler) actorNames(ctx context.Context, events []Event) (map[uuid.UUID]string, error) {
	if h.Pool == nil {
		return map[uuid.UUID]string{}, nil
	}
	ids := make([]uuid.UUID, 0, len(events))
	seen := map[uuid.UUID]struct{}{}
	for _, e := range events {
		if _, ok := seen[e.ActorID]; ok {
			continue
		}
		seen[e.ActorID] = struct{}{}
		ids = append(ids, e.ActorID)
	}
	if len(ids) == 0 {
		return map[uuid.UUID]string{}, nil
	}

	rows, err := h.Pool.Query(ctx, `
		SELECT id, username FROM users WHERE id = ANY($1)
	`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[uuid.UUID]string, len(ids))
	for rows.Next() {
		var id uuid.UUID
		var username string
		if err := rows.Scan(&id, &username); err != nil {
			return nil, err
		}
		out[id] = username
	}
	return out, rows.Err()
}

type errorBody struct {
	Error string `json:"error"`
}

func writeErr(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(errorBody{Error: code})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
