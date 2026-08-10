package moderation

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	AppealStatusPending   = "pending"
	AppealStatusReviewed  = "reviewed"
	AppealStatusDismissed = "dismissed"

	ActionAppealReviewed  = "appeal_reviewed"
	ActionAppealDismissed = "appeal_dismissed"

	TargetTypeAppeal = "appeal"
)

var (
	// ErrAppealNotEligible is returned when the user is not banned, shadow-banned, or flagged.
	ErrAppealNotEligible = errors.New("error_forbidden")
	// ErrAppealAlreadyPending is returned when the user already has a pending appeal.
	ErrAppealAlreadyPending = errors.New("error_already_pending")
	// ErrAppealNotFound is returned when the appeal id does not exist.
	ErrAppealNotFound = errors.New("error_not_found")
	// ErrAppealAlreadyResolved is returned when resolving a non-pending appeal.
	ErrAppealAlreadyResolved = errors.New("error_already_resolved")
	// ErrEmptyAppealReason is returned when reason is blank.
	ErrEmptyAppealReason = errors.New("error_empty_reason")
)

// Appeal is one row in the appeals moderator queue.
type Appeal struct {
	ID        uuid.UUID `json:"id"`
	UserID    uuid.UUID `json:"user_id"`
	Reason    string    `json:"reason"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

// Appeals persists player appeals and audit-only resolutions.
type Appeals struct {
	Pool *pgxpool.Pool
}

// Create inserts a pending appeal if the user is eligible.
func (a *Appeals) Create(ctx context.Context, userID uuid.UUID, reason string) (Appeal, error) {
	if a == nil || a.Pool == nil {
		return Appeal{}, errors.New("appeals not configured")
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return Appeal{}, ErrEmptyAppealReason
	}

	ok, err := a.eligible(ctx, userID)
	if err != nil {
		return Appeal{}, err
	}
	if !ok {
		return Appeal{}, ErrAppealNotEligible
	}

	var out Appeal
	err = a.Pool.QueryRow(ctx, `
		INSERT INTO appeals (user_id, reason, status)
		VALUES ($1, $2, $3)
		RETURNING id, user_id, reason, status, created_at
	`, userID, reason, AppealStatusPending).Scan(
		&out.ID, &out.UserID, &out.Reason, &out.Status, &out.CreatedAt,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return Appeal{}, ErrAppealAlreadyPending
		}
		return Appeal{}, fmt.Errorf("insert appeal: %w", err)
	}
	return out, nil
}

// List returns appeals filtered by status (newest first, capped at 200).
func (a *Appeals) List(ctx context.Context, status string) ([]Appeal, error) {
	if a == nil || a.Pool == nil {
		return nil, errors.New("appeals not configured")
	}
	if status == "" {
		status = AppealStatusPending
	}
	rows, err := a.Pool.Query(ctx, `
		SELECT id, user_id, reason, status, created_at
		FROM appeals
		WHERE status = $1
		ORDER BY created_at DESC
		LIMIT 200
	`, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Appeal
	for rows.Next() {
		var ap Appeal
		if err := rows.Scan(&ap.ID, &ap.UserID, &ap.Reason, &ap.Status, &ap.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, ap)
	}
	return out, rows.Err()
}

// Resolve marks a pending appeal reviewed or dismissed and writes audit_log.
// Does not change users.status (unban remains a separate admin action).
func (a *Appeals) Resolve(ctx context.Context, actorID, appealID uuid.UUID, newStatus, action string) (Appeal, error) {
	if a == nil || a.Pool == nil {
		return Appeal{}, errors.New("appeals not configured")
	}
	switch newStatus {
	case AppealStatusReviewed, AppealStatusDismissed:
	default:
		return Appeal{}, ErrInvalidStatus
	}

	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return Appeal{}, err
	}
	defer tx.Rollback(ctx)

	var ap Appeal
	err = tx.QueryRow(ctx, `
		SELECT id, user_id, reason, status, created_at
		FROM appeals
		WHERE id = $1
		FOR UPDATE
	`, appealID).Scan(&ap.ID, &ap.UserID, &ap.Reason, &ap.Status, &ap.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Appeal{}, ErrAppealNotFound
	}
	if err != nil {
		return Appeal{}, err
	}
	if ap.Status != AppealStatusPending {
		return Appeal{}, ErrAppealAlreadyResolved
	}

	err = tx.QueryRow(ctx, `
		UPDATE appeals SET status = $2 WHERE id = $1
		RETURNING id, user_id, reason, status, created_at
	`, appealID, newStatus).Scan(&ap.ID, &ap.UserID, &ap.Reason, &ap.Status, &ap.CreatedAt)
	if err != nil {
		return Appeal{}, err
	}

	if err := insertAudit(ctx, tx, actorID, action, TargetTypeAppeal, appealID, map[string]any{
		"status":  newStatus,
		"user_id": ap.UserID.String(),
	}); err != nil {
		return Appeal{}, fmt.Errorf("audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Appeal{}, err
	}
	return ap, nil
}

func (a *Appeals) eligible(ctx context.Context, userID uuid.UUID) (bool, error) {
	var status string
	err := a.Pool.QueryRow(ctx, `SELECT status FROM users WHERE id = $1`, userID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrUserNotFound
	}
	if err != nil {
		return false, err
	}
	if status == StatusBanned || status == StatusShadowBanned {
		return true, nil
	}

	var n int
	err = a.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM flagged_users
		WHERE user_id = $1 AND status = 'pending'
	`, userID).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}
