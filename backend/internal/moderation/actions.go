package moderation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// User account statuses (users.status).
const (
	StatusActive       = "active"
	StatusBanned       = "banned"
	StatusShadowBanned = "shadow_banned"
)

// Audit action names written for moderator status changes.
const (
	ActionUserBanned       = "user_banned"
	ActionUserShadowBanned = "user_shadow_banned"
	ActionUserUnbanned     = "user_unbanned"

	TargetTypeUser = "user"
)

var (
	// ErrUserNotFound is returned when the target user does not exist.
	ErrUserNotFound = errors.New("error_not_found")
	// ErrInvalidStatus is returned when an unknown status is requested.
	ErrInvalidStatus = errors.New("error_invalid_status")
)

type auditDB interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// Actions applies ban / shadow-ban / unban and records audit_log in the same TX.
type Actions struct {
	Pool *pgxpool.Pool
}

// Ban sets users.status=banned.
func (a *Actions) Ban(ctx context.Context, actorID, userID uuid.UUID) error {
	return a.setStatus(ctx, actorID, userID, StatusBanned, ActionUserBanned)
}

// ShadowBan sets users.status=shadow_banned.
//
// Inert support behavior (08.4): shadow-banned users pass auth. POST /v1/support
// returns a normal 200-shaped Result but does not debit the ledger, insert a
// supports row, mutate tribe_province_scores, publish support_applied, or call
// OnSupportApplied. Balance and public control/leaderboards stay unchanged.
// Never return a distinct error code that would tip the user off.
func (a *Actions) ShadowBan(ctx context.Context, actorID, userID uuid.UUID) error {
	return a.setStatus(ctx, actorID, userID, StatusShadowBanned, ActionUserShadowBanned)
}

// Unban restores users.status=active.
func (a *Actions) Unban(ctx context.Context, actorID, userID uuid.UUID) error {
	return a.setStatus(ctx, actorID, userID, StatusActive, ActionUserUnbanned)
}

func (a *Actions) setStatus(ctx context.Context, actorID, userID uuid.UUID, status, action string) error {
	if a == nil || a.Pool == nil {
		return errors.New("moderation actions not configured")
	}
	if !validUserStatus(status) {
		return ErrInvalidStatus
	}

	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var prev string
	err = tx.QueryRow(ctx, `
		SELECT status FROM users WHERE id = $1 FOR UPDATE
	`, userID).Scan(&prev)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrUserNotFound
	}
	if err != nil {
		return fmt.Errorf("load user status: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE users SET status = $2 WHERE id = $1
	`, userID, status); err != nil {
		return fmt.Errorf("update user status: %w", err)
	}

	if err := insertAudit(ctx, tx, actorID, action, TargetTypeUser, userID, map[string]any{
		"from": prev,
		"to":   status,
	}); err != nil {
		return fmt.Errorf("audit: %w", err)
	}

	return tx.Commit(ctx)
}

func insertAudit(ctx context.Context, q auditDB, actorID uuid.UUID, action, targetType string, targetID uuid.UUID, metadata map[string]any) error {
	if metadata == nil {
		metadata = map[string]any{}
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `
		INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
		VALUES ($1, $2, $3, $4, $5::jsonb)
	`, actorID, action, targetType, targetID, raw)
	return err
}

func validUserStatus(s string) bool {
	switch s {
	case StatusActive, StatusBanned, StatusShadowBanned:
		return true
	default:
		return false
	}
}
