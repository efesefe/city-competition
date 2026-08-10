package social

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/auth"
)

var (
	ErrEventNotFound    = errors.New("error_event_not_found")
	ErrReactionNotFound = errors.New("error_reaction_not_found")
	ErrInvalidEmoji     = errors.New("error_invalid_emoji")
)

// Reaction is an event_reactions row.
type Reaction struct {
	ID        uuid.UUID `json:"id"`
	EventID   uuid.UUID `json:"event_id"`
	UserID    uuid.UUID `json:"user_id"`
	Emoji     string    `json:"emoji"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// UpsertReaction inserts or updates the user's emoji on an activity event.
func (s *PoolStore) UpsertReaction(ctx context.Context, eventID, userID uuid.UUID, emoji string) (Reaction, error) {
	emoji = strings.TrimSpace(emoji)
	if emoji == "" || utf8.RuneCountInString(emoji) > 16 {
		return Reaction{}, ErrInvalidEmoji
	}

	var exists bool
	if err := s.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM activity_events WHERE id = $1)`, eventID).Scan(&exists); err != nil {
		return Reaction{}, err
	}
	if !exists {
		return Reaction{}, ErrEventNotFound
	}

	var r Reaction
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO event_reactions (event_id, user_id, emoji)
		VALUES ($1, $2, $3)
		ON CONFLICT (event_id, user_id) DO UPDATE SET
			emoji = EXCLUDED.emoji,
			updated_at = now()
		RETURNING id, event_id, user_id, emoji, created_at, updated_at
	`, eventID, userID, emoji).Scan(
		&r.ID, &r.EventID, &r.UserID, &r.Emoji, &r.CreatedAt, &r.UpdatedAt,
	)
	return r, err
}

// DeleteReaction removes the user's reaction from an event.
func (s *PoolStore) DeleteReaction(ctx context.Context, eventID, userID uuid.UUID) error {
	tag, err := s.Pool.Exec(ctx, `
		DELETE FROM event_reactions WHERE event_id = $1 AND user_id = $2
	`, eventID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrReactionNotFound
	}
	return nil
}

type reactionBody struct {
	Emoji string `json:"emoji"`
}

// PutReaction handles PUT /v1/feed/events/{id}/reactions.
func (h *Handler) PutReaction(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	eventID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_id")
		return
	}
	var body reactionBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}
	store, ok := h.Store.(*PoolStore)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	reaction, err := store.UpsertReaction(r.Context(), eventID, userID, body.Emoji)
	if err != nil {
		switch {
		case errors.Is(err, ErrEventNotFound):
			writeErr(w, http.StatusNotFound, err.Error())
		case errors.Is(err, ErrInvalidEmoji):
			writeErr(w, http.StatusBadRequest, err.Error())
		default:
			writeErr(w, http.StatusInternalServerError, "error_internal")
		}
		return
	}
	writeJSON(w, http.StatusOK, reaction)
}

// DeleteReaction handles DELETE /v1/feed/events/{id}/reactions.
func (h *Handler) DeleteReaction(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	eventID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_id")
		return
	}
	store, ok := h.Store.(*PoolStore)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if err := store.DeleteReaction(r.Context(), eventID, userID); err != nil {
		if errors.Is(err, ErrReactionNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
