package moderation

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Spend-anomaly defaults: ≥N supports or ≥M credit grants in a sliding window.
const (
	DefaultSupportBurstLimit = 20
	DefaultGrantBurstLimit   = 5
	DefaultAnomalyWindow     = 5 * time.Minute

	ReasonSpendAnomaly = "spend_anomaly"
)

// SpendAnomalyDetector flags sudden support / grant bursts into flagged_users.
type SpendAnomalyDetector struct {
	Pool               *pgxpool.Pool
	SupportBurstLimit  int
	GrantBurstLimit    int
	Window             time.Duration
	Now                func() time.Time
}

func (d *SpendAnomalyDetector) supportLimit() int {
	if d != nil && d.SupportBurstLimit > 0 {
		return d.SupportBurstLimit
	}
	return DefaultSupportBurstLimit
}

func (d *SpendAnomalyDetector) grantLimit() int {
	if d != nil && d.GrantBurstLimit > 0 {
		return d.GrantBurstLimit
	}
	return DefaultGrantBurstLimit
}

func (d *SpendAnomalyDetector) window() time.Duration {
	if d != nil && d.Window > 0 {
		return d.Window
	}
	return DefaultAnomalyWindow
}

func (d *SpendAnomalyDetector) now() time.Time {
	if d != nil && d.Now != nil {
		return d.Now()
	}
	return time.Now().UTC()
}

// CheckAfterSupport counts recent supports; flags when over the burst limit.
// Best-effort: errors are returned to the caller for logging, never fail the spend.
func (d *SpendAnomalyDetector) CheckAfterSupport(ctx context.Context, userID uuid.UUID) error {
	if d == nil || d.Pool == nil || userID == uuid.Nil {
		return nil
	}
	since := d.now().Add(-d.window())
	var n int
	if err := d.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM supports
		WHERE user_id = $1 AND created_at >= $2
	`, userID, since).Scan(&n); err != nil {
		return fmt.Errorf("count supports: %w", err)
	}
	if n < d.supportLimit() {
		return nil
	}
	return d.flag(ctx, userID, "support_burst")
}

// CheckAfterGrant counts recent positive credit_ledger grants; flags when over limit.
func (d *SpendAnomalyDetector) CheckAfterGrant(ctx context.Context, userID uuid.UUID) error {
	if d == nil || d.Pool == nil || userID == uuid.Nil {
		return nil
	}
	since := d.now().Add(-d.window())
	var n int
	if err := d.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM credit_ledger
		WHERE user_id = $1 AND delta > 0 AND created_at >= $2
	`, userID, since).Scan(&n); err != nil {
		return fmt.Errorf("count grants: %w", err)
	}
	if n < d.grantLimit() {
		return nil
	}
	return d.flag(ctx, userID, "grant_burst")
}

func (d *SpendAnomalyDetector) flag(ctx context.Context, userID uuid.UUID, contextType string) error {
	// Avoid duplicate pending spend_anomaly rows for the same user.
	var exists bool
	if err := d.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM flagged_users
			WHERE user_id = $1 AND reason = $2 AND status = 'pending'
		)
	`, userID, ReasonSpendAnomaly).Scan(&exists); err != nil {
		return fmt.Errorf("check pending flag: %w", err)
	}
	if exists {
		return nil
	}

	_, err := d.Pool.Exec(ctx, `
		INSERT INTO flagged_users (user_id, reason, context_type, status)
		VALUES ($1, $2, $3, 'pending')
	`, userID, ReasonSpendAnomaly, contextType)
	if err != nil {
		return fmt.Errorf("insert flagged_users: %w", err)
	}
	return nil
}
