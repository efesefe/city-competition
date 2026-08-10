package social

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/cache"
	"github.com/city-competition-remastered/backend/internal/moderation"
)

const (
	RelationFriendRequest = "friend_request"
	RelationFriend        = "friend"
	RelationBlocked       = "blocked"
	RelationMuted         = "muted"
)

var (
	ErrBlocked          = errors.New("error_blocked")
	ErrSelfRelation     = errors.New("error_self_relation")
	ErrAlreadyFriends   = errors.New("error_already_friends")
	ErrAlreadyRequested = errors.New("error_already_requested")
	ErrRequestNotFound  = errors.New("error_request_not_found")
	ErrNotAllowed       = errors.New("error_not_allowed")
	ErrUserNotFound     = errors.New("error_user_not_found")
	ErrAlreadyBlocked   = errors.New("error_already_blocked")
	ErrAlreadyMuted     = errors.New("error_already_muted")
	ErrRelationNotFound = errors.New("error_relation_not_found")
	ErrInvalidInput     = errors.New("error_invalid_input")
	ErrNotFriends       = errors.New("error_not_friends")
)

// Relation is a directed user_relations row.
type Relation struct {
	ID         uuid.UUID `json:"id"`
	FromUserID uuid.UUID `json:"from_user_id"`
	ToUserID   uuid.UUID `json:"to_user_id"`
	Type       string    `json:"type"`
	CreatedAt  time.Time `json:"created_at"`
}

// FriendSummary is a friend list entry (other user).
type FriendSummary struct {
	UserID    uuid.UUID `json:"user_id"`
	CreatedAt time.Time `json:"created_at"`
}

// Store persists relationship state and reports.
type Store interface {
	IsBlocked(ctx context.Context, a, b uuid.UUID) (bool, error)
	AreFriends(ctx context.Context, a, b uuid.UUID) (bool, error)
	UserExists(ctx context.Context, id uuid.UUID) (bool, error)
	InsertMessage(ctx context.Context, msg Message) (Message, error)

	CreateFriendRequest(ctx context.Context, from, to uuid.UUID) (Relation, error)
	ListFriendRequests(ctx context.Context, userID uuid.UUID) (incoming, outgoing []Relation, err error)
	GetFriendRequest(ctx context.Context, id uuid.UUID) (Relation, error)
	AcceptFriendRequest(ctx context.Context, requestID, actorID uuid.UUID) error
	RejectFriendRequest(ctx context.Context, requestID, actorID uuid.UUID) error
	CancelFriendRequest(ctx context.Context, requestID, actorID uuid.UUID) error
	ListFriends(ctx context.Context, userID uuid.UUID) ([]FriendSummary, error)
	Unfriend(ctx context.Context, userID, otherID uuid.UUID) error

	Block(ctx context.Context, from, to uuid.UUID) (Relation, error)
	ListBlocks(ctx context.Context, userID uuid.UUID) ([]Relation, error)
	Unblock(ctx context.Context, from, to uuid.UUID) error

	Mute(ctx context.Context, from, to uuid.UUID) (Relation, error)
	ListMutes(ctx context.Context, userID uuid.UUID) ([]Relation, error)
	Unmute(ctx context.Context, from, to uuid.UUID) error

	CreateReport(ctx context.Context, reporterID, reportedID uuid.UUID, reason string, contextType *string, contextID *uuid.UUID) (Report, error)
}

// PoolStore implements Store with pgxpool.
type PoolStore struct {
	Pool *pgxpool.Pool
}

// IsBlocked reports whether a block exists in either direction between a and b.
func (s *PoolStore) IsBlocked(ctx context.Context, a, b uuid.UUID) (bool, error) {
	var exists bool
	err := s.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM user_relations
			WHERE type = 'blocked'
			  AND (
			    (from_user_id = $1 AND to_user_id = $2)
			    OR (from_user_id = $2 AND to_user_id = $1)
			  )
		)
	`, a, b).Scan(&exists)
	return exists, err
}

// IsBlocked is a package-level helper for DM/feed/referral surfaces.
func IsBlocked(ctx context.Context, store Store, a, b uuid.UUID) (bool, error) {
	return store.IsBlocked(ctx, a, b)
}

func (s *PoolStore) UserExists(ctx context.Context, id uuid.UUID) (bool, error) {
	var exists bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE id = $1)`, id).Scan(&exists)
	return exists, err
}

// AreFriends reports whether a directed friend relation exists from a to b
// (accept inserts both directions, so either order works for mutual friends).
func (s *PoolStore) AreFriends(ctx context.Context, a, b uuid.UUID) (bool, error) {
	var exists bool
	err := s.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM user_relations
			WHERE type = 'friend' AND from_user_id = $1 AND to_user_id = $2
		)
	`, a, b).Scan(&exists)
	return exists, err
}

func (s *PoolStore) CreateFriendRequest(ctx context.Context, from, to uuid.UUID) (Relation, error) {
	if from == to {
		return Relation{}, ErrSelfRelation
	}
	blocked, err := s.IsBlocked(ctx, from, to)
	if err != nil {
		return Relation{}, err
	}
	if blocked {
		return Relation{}, ErrBlocked
	}
	friends, err := s.AreFriends(ctx, from, to)
	if err != nil {
		return Relation{}, err
	}
	if friends {
		return Relation{}, ErrAlreadyFriends
	}

	var rel Relation
	err = s.Pool.QueryRow(ctx, `
		INSERT INTO user_relations (from_user_id, to_user_id, type)
		VALUES ($1, $2, 'friend_request')
		RETURNING id, from_user_id, to_user_id, type::text, created_at
	`, from, to).Scan(&rel.ID, &rel.FromUserID, &rel.ToUserID, &rel.Type, &rel.CreatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return Relation{}, ErrAlreadyRequested
		}
		return Relation{}, err
	}
	return rel, nil
}

func (s *PoolStore) ListFriendRequests(ctx context.Context, userID uuid.UUID) (incoming, outgoing []Relation, err error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, from_user_id, to_user_id, type::text, created_at
		FROM user_relations
		WHERE type = 'friend_request' AND (to_user_id = $1 OR from_user_id = $1)
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	incoming = []Relation{}
	outgoing = []Relation{}
	for rows.Next() {
		var rel Relation
		if err := rows.Scan(&rel.ID, &rel.FromUserID, &rel.ToUserID, &rel.Type, &rel.CreatedAt); err != nil {
			return nil, nil, err
		}
		if rel.ToUserID == userID {
			incoming = append(incoming, rel)
		} else {
			outgoing = append(outgoing, rel)
		}
	}
	return incoming, outgoing, rows.Err()
}

func (s *PoolStore) GetFriendRequest(ctx context.Context, id uuid.UUID) (Relation, error) {
	var rel Relation
	err := s.Pool.QueryRow(ctx, `
		SELECT id, from_user_id, to_user_id, type::text, created_at
		FROM user_relations
		WHERE id = $1 AND type = 'friend_request'
	`, id).Scan(&rel.ID, &rel.FromUserID, &rel.ToUserID, &rel.Type, &rel.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Relation{}, ErrRequestNotFound
	}
	return rel, err
}

func (s *PoolStore) AcceptFriendRequest(ctx context.Context, requestID, actorID uuid.UUID) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var fromID, toID uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT from_user_id, to_user_id
		FROM user_relations
		WHERE id = $1 AND type = 'friend_request'
		FOR UPDATE
	`, requestID).Scan(&fromID, &toID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrRequestNotFound
	}
	if err != nil {
		return err
	}
	if toID != actorID {
		return ErrNotAllowed
	}

	blocked, err := s.isBlockedTx(ctx, tx, fromID, toID)
	if err != nil {
		return err
	}
	if blocked {
		return ErrBlocked
	}

	_, err = tx.Exec(ctx, `DELETE FROM user_relations WHERE id = $1`, requestID)
	if err != nil {
		return err
	}
	// Also clear any reverse pending request between the pair.
	_, err = tx.Exec(ctx, `
		DELETE FROM user_relations
		WHERE type = 'friend_request'
		  AND from_user_id = $1 AND to_user_id = $2
	`, toID, fromID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO user_relations (from_user_id, to_user_id, type)
		VALUES ($1, $2, 'friend'), ($2, $1, 'friend')
		ON CONFLICT (from_user_id, to_user_id, type) DO NOTHING
	`, fromID, toID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *PoolStore) isBlockedTx(ctx context.Context, tx pgx.Tx, a, b uuid.UUID) (bool, error) {
	var exists bool
	err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM user_relations
			WHERE type = 'blocked'
			  AND (
			    (from_user_id = $1 AND to_user_id = $2)
			    OR (from_user_id = $2 AND to_user_id = $1)
			  )
		)
	`, a, b).Scan(&exists)
	return exists, err
}

func (s *PoolStore) RejectFriendRequest(ctx context.Context, requestID, actorID uuid.UUID) error {
	tag, err := s.Pool.Exec(ctx, `
		DELETE FROM user_relations
		WHERE id = $1 AND type = 'friend_request' AND to_user_id = $2
	`, requestID, actorID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrRequestNotFound
	}
	return nil
}

func (s *PoolStore) CancelFriendRequest(ctx context.Context, requestID, actorID uuid.UUID) error {
	tag, err := s.Pool.Exec(ctx, `
		DELETE FROM user_relations
		WHERE id = $1 AND type = 'friend_request' AND from_user_id = $2
	`, requestID, actorID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrRequestNotFound
	}
	return nil
}

func (s *PoolStore) ListFriends(ctx context.Context, userID uuid.UUID) ([]FriendSummary, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT to_user_id, created_at
		FROM user_relations
		WHERE from_user_id = $1 AND type = 'friend'
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []FriendSummary{}
	for rows.Next() {
		var f FriendSummary
		if err := rows.Scan(&f.UserID, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (s *PoolStore) Unfriend(ctx context.Context, userID, otherID uuid.UUID) error {
	tag, err := s.Pool.Exec(ctx, `
		DELETE FROM user_relations
		WHERE type = 'friend'
		  AND (
		    (from_user_id = $1 AND to_user_id = $2)
		    OR (from_user_id = $2 AND to_user_id = $1)
		  )
	`, userID, otherID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFriends
	}
	return nil
}

func (s *PoolStore) Block(ctx context.Context, from, to uuid.UUID) (Relation, error) {
	if from == to {
		return Relation{}, ErrSelfRelation
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Relation{}, err
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `
		DELETE FROM user_relations
		WHERE type IN ('friend', 'friend_request', 'muted')
		  AND (
		    (from_user_id = $1 AND to_user_id = $2)
		    OR (from_user_id = $2 AND to_user_id = $1)
		  )
	`, from, to)
	if err != nil {
		return Relation{}, err
	}

	var rel Relation
	err = tx.QueryRow(ctx, `
		INSERT INTO user_relations (from_user_id, to_user_id, type)
		VALUES ($1, $2, 'blocked')
		RETURNING id, from_user_id, to_user_id, type::text, created_at
	`, from, to).Scan(&rel.ID, &rel.FromUserID, &rel.ToUserID, &rel.Type, &rel.CreatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return Relation{}, ErrAlreadyBlocked
		}
		return Relation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Relation{}, err
	}
	return rel, nil
}

func (s *PoolStore) ListBlocks(ctx context.Context, userID uuid.UUID) ([]Relation, error) {
	return s.listByTypeFrom(ctx, userID, RelationBlocked)
}

func (s *PoolStore) Unblock(ctx context.Context, from, to uuid.UUID) error {
	tag, err := s.Pool.Exec(ctx, `
		DELETE FROM user_relations
		WHERE from_user_id = $1 AND to_user_id = $2 AND type = 'blocked'
	`, from, to)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrRelationNotFound
	}
	return nil
}

func (s *PoolStore) Mute(ctx context.Context, from, to uuid.UUID) (Relation, error) {
	if from == to {
		return Relation{}, ErrSelfRelation
	}
	var rel Relation
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO user_relations (from_user_id, to_user_id, type)
		VALUES ($1, $2, 'muted')
		RETURNING id, from_user_id, to_user_id, type::text, created_at
	`, from, to).Scan(&rel.ID, &rel.FromUserID, &rel.ToUserID, &rel.Type, &rel.CreatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return Relation{}, ErrAlreadyMuted
		}
		return Relation{}, err
	}
	return rel, nil
}

func (s *PoolStore) ListMutes(ctx context.Context, userID uuid.UUID) ([]Relation, error) {
	return s.listByTypeFrom(ctx, userID, RelationMuted)
}

func (s *PoolStore) Unmute(ctx context.Context, from, to uuid.UUID) error {
	tag, err := s.Pool.Exec(ctx, `
		DELETE FROM user_relations
		WHERE from_user_id = $1 AND to_user_id = $2 AND type = 'muted'
	`, from, to)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrRelationNotFound
	}
	return nil
}

func (s *PoolStore) listByTypeFrom(ctx context.Context, userID uuid.UUID, relType string) ([]Relation, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, from_user_id, to_user_id, type::text, created_at
		FROM user_relations
		WHERE from_user_id = $1 AND type = $2::user_relation_type
		ORDER BY created_at DESC
	`, userID, relType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Relation{}
	for rows.Next() {
		var rel Relation
		if err := rows.Scan(&rel.ID, &rel.FromUserID, &rel.ToUserID, &rel.Type, &rel.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, rel)
	}
	return out, rows.Err()
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// Handler exposes friend/block/mute HTTP endpoints.
type Handler struct {
	Store                Store
	Users                auth.RestrictedLookup
	Broadcaster          cache.Broadcaster
	RestrictedDMDisabled bool
	Referrals            *ReferralService
	Classifier           moderation.ContentClassifier
}

type errorBody struct {
	Error string `json:"error"`
}

type userIDBody struct {
	UserID uuid.UUID `json:"user_id"`
}

// CreateFriendRequest handles POST /v1/friends/requests.
func (h *Handler) CreateFriendRequest(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	var body userIDBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == uuid.Nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}
	exists, err := h.Store.UserExists(r.Context(), body.UserID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if !exists {
		writeErr(w, http.StatusNotFound, ErrUserNotFound.Error())
		return
	}

	rel, err := h.Store.CreateFriendRequest(r.Context(), userID, body.UserID)
	if err != nil {
		writeRelationErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, rel)
}

// ListFriendRequests handles GET /v1/friends/requests.
func (h *Handler) ListFriendRequests(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	incoming, outgoing, err := h.Store.ListFriendRequests(r.Context(), userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"incoming": incoming,
		"outgoing": outgoing,
	})
}

// AcceptFriendRequest handles POST /v1/friends/requests/{id}/accept.
func (h *Handler) AcceptFriendRequest(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_id")
		return
	}
	if err := h.Store.AcceptFriendRequest(r.Context(), id, userID); err != nil {
		writeRelationErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "accepted"})
}

// RejectFriendRequest handles POST /v1/friends/requests/{id}/reject.
func (h *Handler) RejectFriendRequest(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_id")
		return
	}
	if err := h.Store.RejectFriendRequest(r.Context(), id, userID); err != nil {
		writeRelationErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "rejected"})
}

// CancelFriendRequest handles DELETE /v1/friends/requests/{id}.
func (h *Handler) CancelFriendRequest(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_id")
		return
	}
	if err := h.Store.CancelFriendRequest(r.Context(), id, userID); err != nil {
		writeRelationErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
}

// ListFriends handles GET /v1/friends.
func (h *Handler) ListFriends(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	friends, err := h.Store.ListFriends(r.Context(), userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"friends": friends})
}

// Unfriend handles DELETE /v1/friends/{user_id}.
func (h *Handler) Unfriend(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	otherID, err := uuid.Parse(r.PathValue("user_id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_id")
		return
	}
	if err := h.Store.Unfriend(r.Context(), userID, otherID); err != nil {
		writeRelationErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "unfriended"})
}

// CreateBlock handles POST /v1/blocks.
func (h *Handler) CreateBlock(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	var body userIDBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == uuid.Nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}
	exists, err := h.Store.UserExists(r.Context(), body.UserID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if !exists {
		writeErr(w, http.StatusNotFound, ErrUserNotFound.Error())
		return
	}
	rel, err := h.Store.Block(r.Context(), userID, body.UserID)
	if err != nil {
		writeRelationErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, rel)
}

// ListBlocks handles GET /v1/blocks.
func (h *Handler) ListBlocks(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	blocks, err := h.Store.ListBlocks(r.Context(), userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"blocks": blocks})
}

// DeleteBlock handles DELETE /v1/blocks/{user_id}.
func (h *Handler) DeleteBlock(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	otherID, err := uuid.Parse(r.PathValue("user_id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_id")
		return
	}
	if err := h.Store.Unblock(r.Context(), userID, otherID); err != nil {
		writeRelationErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "unblocked"})
}

// CreateMute handles POST /v1/mutes.
func (h *Handler) CreateMute(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	var body userIDBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == uuid.Nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}
	exists, err := h.Store.UserExists(r.Context(), body.UserID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if !exists {
		writeErr(w, http.StatusNotFound, ErrUserNotFound.Error())
		return
	}
	rel, err := h.Store.Mute(r.Context(), userID, body.UserID)
	if err != nil {
		writeRelationErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, rel)
}

// ListMutes handles GET /v1/mutes.
func (h *Handler) ListMutes(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	mutes, err := h.Store.ListMutes(r.Context(), userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mutes": mutes})
}

// DeleteMute handles DELETE /v1/mutes/{user_id}.
func (h *Handler) DeleteMute(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	otherID, err := uuid.Parse(r.PathValue("user_id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_id")
		return
	}
	if err := h.Store.Unmute(r.Context(), userID, otherID); err != nil {
		writeRelationErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "unmuted"})
}

func writeRelationErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrBlocked):
		writeErr(w, http.StatusForbidden, ErrBlocked.Error())
	case errors.Is(err, ErrSelfRelation):
		writeErr(w, http.StatusBadRequest, ErrSelfRelation.Error())
	case errors.Is(err, ErrAlreadyFriends), errors.Is(err, ErrAlreadyRequested),
		errors.Is(err, ErrAlreadyBlocked), errors.Is(err, ErrAlreadyMuted):
		writeErr(w, http.StatusConflict, err.Error())
	case errors.Is(err, ErrRequestNotFound), errors.Is(err, ErrRelationNotFound),
		errors.Is(err, ErrNotFriends), errors.Is(err, ErrUserNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrNotAllowed):
		writeErr(w, http.StatusForbidden, ErrNotAllowed.Error())
	case errors.Is(err, ErrInvalidInput):
		writeErr(w, http.StatusBadRequest, ErrInvalidInput.Error())
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
