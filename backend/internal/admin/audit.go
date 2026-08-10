package admin

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/moderation"
)

const (
	ActionReportReviewed    = "report_reviewed"
	ActionReportDismissed   = "report_dismissed"
	ActionFlagReviewed      = "flag_reviewed"
	ActionFlagDismissed     = "flag_dismissed"
	ActionAppealReviewed    = moderation.ActionAppealReviewed
	ActionAppealDismissed   = moderation.ActionAppealDismissed
	ActionDerbyForceResolve = "derby_force_resolve"

	TargetTypeReport = "user_report"
	TargetTypeFlag   = "flagged_user"
	TargetTypeAppeal = moderation.TargetTypeAppeal
	TargetTypeDerby  = "derby"
)

// Writer appends immutable audit_log rows.
type Writer interface {
	Insert(ctx context.Context, actorID uuid.UUID, action, targetType string, targetID uuid.UUID, metadata map[string]any) error
}

// PoolWriter writes audit_log via pgxpool.
type PoolWriter struct {
	Pool *pgxpool.Pool
}

type auditDB interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// Insert appends one audit_log row. metadata may be nil.
func (w *PoolWriter) Insert(ctx context.Context, actorID uuid.UUID, action, targetType string, targetID uuid.UUID, metadata map[string]any) error {
	if w == nil || w.Pool == nil {
		return errors.New("audit writer not configured")
	}
	return insertAudit(ctx, w.Pool, actorID, action, targetType, targetID, metadata)
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
