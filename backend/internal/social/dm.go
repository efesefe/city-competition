package social

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/moderation"
	"github.com/city-competition-remastered/backend/internal/realtime"
)

const (
	MessageKindDM    = "dm"
	MessageKindTribe = "tribe"
)

var (
	ErrEmptyBody = errors.New("error_empty_body")
)

// Message is a persisted DM or tribe chat row.
type Message struct {
	ID          uuid.UUID  `json:"id"`
	Kind        string     `json:"kind"`
	SenderID    uuid.UUID  `json:"sender_id"`
	RecipientID *uuid.UUID `json:"recipient_id,omitempty"`
	TribeID     *uuid.UUID `json:"tribe_id,omitempty"`
	Body        string     `json:"body"`
	Flagged     bool       `json:"flagged"`
	CreatedAt   time.Time  `json:"created_at"`
}

// InsertMessage persists a message row and returns the stored record.
func (s *PoolStore) InsertMessage(ctx context.Context, msg Message) (Message, error) {
	var out Message
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO messages (kind, sender_id, recipient_id, tribe_id, body, flagged)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, kind, sender_id, recipient_id, tribe_id, body, flagged, created_at
	`, msg.Kind, msg.SenderID, msg.RecipientID, msg.TribeID, msg.Body, msg.Flagged,
	).Scan(&out.ID, &out.Kind, &out.SenderID, &out.RecipientID, &out.TribeID, &out.Body, &out.Flagged, &out.CreatedAt)
	return out, err
}

// SendDM writes a direct message then best-effort broadcasts when not flagged.
func (h *Handler) SendDM(ctx context.Context, from, to uuid.UUID, body string) (Message, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return Message{}, ErrEmptyBody
	}
	if from == to {
		return Message{}, ErrSelfRelation
	}
	exists, err := h.Store.UserExists(ctx, to)
	if err != nil {
		return Message{}, err
	}
	if !exists {
		return Message{}, ErrUserNotFound
	}

	blocked, err := IsBlocked(ctx, h.Store, from, to)
	if err != nil {
		return Message{}, err
	}
	if blocked {
		return Message{}, ErrBlocked
	}

	if h.Users != nil {
		restricted, err := h.Users.IsRestricted(ctx, from)
		if err != nil {
			return Message{}, err
		}
		if restricted {
			if h.RestrictedDMDisabled {
				return Message{}, auth.ErrRestrictedMode
			}
			friends, err := h.Store.AreFriends(ctx, from, to)
			if err != nil {
				return Message{}, err
			}
			if !friends {
				return Message{}, ErrNotFriends
			}
		}
	}

	flagged := moderation.ContainsProfanity(body)
	toCopy := to
	msg, err := h.Store.InsertMessage(ctx, Message{
		Kind:        MessageKindDM,
		SenderID:    from,
		RecipientID: &toCopy,
		Body:        body,
		Flagged:     flagged,
	})
	if err != nil {
		return Message{}, err
	}

	if !flagged {
		h.broadcastDM(ctx, msg)
	}
	return msg, nil
}

func (h *Handler) broadcastDM(ctx context.Context, msg Message) {
	if h.Broadcaster == nil || msg.RecipientID == nil {
		return
	}
	payload, err := json.Marshal(map[string]any{
		"type":         "dm",
		"id":           msg.ID,
		"sender_id":    msg.SenderID,
		"recipient_id": *msg.RecipientID,
		"body":         msg.Body,
		"created_at":   msg.CreatedAt,
	})
	if err != nil {
		return
	}
	_ = h.Broadcaster.Publish(ctx, realtime.DMChannel(*msg.RecipientID), string(payload))
	_ = h.Broadcaster.Publish(ctx, realtime.DMChannel(msg.SenderID), string(payload))
}

type sendDMBody struct {
	UserID uuid.UUID `json:"user_id"`
	Body   string    `json:"body"`
}

// CreateDM handles POST /v1/dms.
func (h *Handler) CreateDM(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	var body sendDMBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == uuid.Nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}
	msg, err := h.SendDM(r.Context(), userID, body.UserID, body.Body)
	if err != nil {
		mapDMError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"message": msg})
}

func mapDMError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrBlocked):
		writeErr(w, http.StatusForbidden, ErrBlocked.Error())
	case errors.Is(err, auth.ErrRestrictedMode):
		writeErr(w, http.StatusForbidden, auth.ErrRestrictedMode.Error())
	case errors.Is(err, ErrNotFriends):
		writeErr(w, http.StatusForbidden, ErrNotFriends.Error())
	case errors.Is(err, ErrSelfRelation):
		writeErr(w, http.StatusBadRequest, ErrSelfRelation.Error())
	case errors.Is(err, ErrEmptyBody):
		writeErr(w, http.StatusBadRequest, ErrEmptyBody.Error())
	case errors.Is(err, ErrUserNotFound):
		writeErr(w, http.StatusNotFound, ErrUserNotFound.Error())
	default:
		writeErr(w, http.StatusInternalServerError, "error_internal")
	}
}
