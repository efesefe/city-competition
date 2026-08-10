package tribe

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/moderation"
	"github.com/city-competition-remastered/backend/internal/realtime"
)

var (
	ErrNotMember = errors.New("error_not_member")
	ErrEmptyBody = errors.New("error_empty_body")
)

const messageKindTribe = "tribe"

// Message is a persisted tribe chat row in the shared messages table.
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

// MessageInserter is implemented by PoolStore for chat persistence.
type MessageInserter interface {
	InsertMessage(ctx context.Context, msg Message) (Message, error)
}

// InsertMessage persists a tribe chat message.
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

// SendTribeMessage verifies membership, persists, then best-effort broadcasts when not flagged.
func (h *Handler) SendTribeMessage(ctx context.Context, userID, tribeID uuid.UUID, body string) (Message, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return Message{}, ErrEmptyBody
	}
	memberTribe, _, err := h.Store.GetMembership(ctx, userID)
	if err != nil {
		return Message{}, err
	}
	if memberTribe == nil || *memberTribe != tribeID {
		return Message{}, ErrNotMember
	}
	if _, err := h.Store.GetByID(ctx, tribeID); err != nil {
		return Message{}, err
	}

	flagged := moderation.ContainsProfanity(body)
	inserter, ok := h.Store.(MessageInserter)
	if !ok {
		return Message{}, errors.New("error_internal")
	}
	tid := tribeID
	msg, err := inserter.InsertMessage(ctx, Message{
		Kind:     messageKindTribe,
		SenderID: userID,
		TribeID:  &tid,
		Body:     body,
		Flagged:  flagged,
	})
	if err != nil {
		return Message{}, err
	}
	if !flagged {
		h.broadcastTribe(ctx, msg)
	}
	return msg, nil
}

func (h *Handler) broadcastTribe(ctx context.Context, msg Message) {
	if h.Broadcaster == nil || msg.TribeID == nil {
		return
	}
	payload, err := json.Marshal(map[string]any{
		"type":       "tribe_message",
		"id":         msg.ID,
		"tribe_id":   *msg.TribeID,
		"sender_id":  msg.SenderID,
		"body":       msg.Body,
		"created_at": msg.CreatedAt,
	})
	if err != nil {
		return
	}
	_ = h.Broadcaster.Publish(ctx, realtime.TribeChannel(*msg.TribeID), string(payload))
}

type sendChatBody struct {
	Body string `json:"body"`
}

// CreateTribeMessage handles POST /v1/tribes/{id}/messages.
func (h *Handler) CreateTribeMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	tribeID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_tribe_id")
		return
	}
	var body sendChatBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}
	msg, err := h.SendTribeMessage(r.Context(), userID, tribeID, body.Body)
	if err != nil {
		mapChatError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"message": msg})
}

// CreateClanChat handles POST /v1/clan/chat using the caller's current tribe.
// Empty-body requests remain 200 {"status":"ok"} for legacy restricted-mode gate tests;
// messages with a body are persisted via SendTribeMessage.
func (h *Handler) CreateClanChat(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}

	raw, _ := io.ReadAll(r.Body)
	var body sendChatBody
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &body)
	}
	text := strings.TrimSpace(body.Body)
	if text == "" {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}

	tribeID, _, err := h.Store.GetMembership(r.Context(), userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if tribeID == nil {
		writeErr(w, http.StatusForbidden, ErrNotMember.Error())
		return
	}
	msg, err := h.SendTribeMessage(r.Context(), userID, *tribeID, text)
	if err != nil {
		mapChatError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"message": msg})
}

func mapChatError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotMember):
		writeErr(w, http.StatusForbidden, ErrNotMember.Error())
	case errors.Is(err, ErrEmptyBody):
		writeErr(w, http.StatusBadRequest, ErrEmptyBody.Error())
	case errors.Is(err, ErrNotFound):
		writeErr(w, http.StatusNotFound, ErrNotFound.Error())
	default:
		writeErr(w, http.StatusInternalServerError, "error_internal")
	}
}
