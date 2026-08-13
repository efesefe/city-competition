// Package erasure implements KVKK right-to-erasure cascade jobs (01.6).
package erasure

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/logging"
)

// Job statuses.
const (
	StatusPending        = "pending"
	StatusRunning        = "running"
	StatusPartialFailure = "partial_failure"
	StatusCompleted      = "completed"
	StatusFailed         = "failed"
)

// Step names executed in order.
const (
	StepLocationHistory = "location_history"
	StepTileOwnership   = "tile_ownership"
	StepPostgresCascade = "postgres_cascade"
	StepRedisCleanup    = "redis_cleanup"
	StepObjectStorage   = "object_storage"
	StepAnonymizeUser   = "anonymize_user"
	StepPayments        = "payments"
	StepAnalyticsEvent  = "analytics_deletion_event"
)

// OrderedSteps is the cascade order.
var OrderedSteps = []string{
	StepLocationHistory,
	StepTileOwnership,
	StepPostgresCascade,
	StepRedisCleanup,
	StepObjectStorage,
	StepAnonymizeUser,
	StepPayments,
	StepAnalyticsEvent,
}

// Job is one erasure_jobs row.
type Job struct {
	ID             uuid.UUID
	UserID         uuid.UUID
	Status         string
	RequestID      string
	CompletedSteps []string
	LastError      *string
	RequestedAt    time.Time
	UpdatedAt      time.Time
	CompletedAt    *time.Time
}

// ObjectStorage deletes user objects; stub is acceptable when no bucket exists.
type ObjectStorage interface {
	DeleteUserObjects(ctx context.Context, userID uuid.UUID) error
}

// StubObjectStorage no-ops deletions.
type StubObjectStorage struct{}

// DeleteUserObjects implements ObjectStorage.
func (StubObjectStorage) DeleteUserObjects(context.Context, uuid.UUID) error { return nil }

// Store persists erasure jobs.
type Store struct {
	Pool *pgxpool.Pool
}

// Enqueue inserts a pending job and returns it.
func (s *Store) Enqueue(ctx context.Context, userID uuid.UUID, requestID string) (Job, error) {
	var j Job
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO erasure_jobs (user_id, status, request_id)
		VALUES ($1, $2, $3)
		RETURNING id, user_id, status, request_id, completed_steps, last_error,
		          requested_at, updated_at, completed_at
	`, userID, StatusPending, requestID).Scan(
		&j.ID, &j.UserID, &j.Status, &j.RequestID, &j.CompletedSteps, &j.LastError,
		&j.RequestedAt, &j.UpdatedAt, &j.CompletedAt,
	)
	if err != nil {
		return Job{}, err
	}
	if j.CompletedSteps == nil {
		j.CompletedSteps = []string{}
	}
	return j, nil
}

// ClaimNext picks the oldest pending/partial_failure job for processing.
func (s *Store) ClaimNext(ctx context.Context) (Job, bool, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Job{}, false, err
	}
	defer tx.Rollback(ctx)

	var j Job
	err = tx.QueryRow(ctx, `
		SELECT id, user_id, status, request_id, completed_steps, last_error,
		       requested_at, updated_at, completed_at
		FROM erasure_jobs
		WHERE status IN ($1, $2)
		ORDER BY requested_at ASC
		FOR UPDATE SKIP LOCKED
		LIMIT 1
	`, StatusPending, StatusPartialFailure).Scan(
		&j.ID, &j.UserID, &j.Status, &j.RequestID, &j.CompletedSteps, &j.LastError,
		&j.RequestedAt, &j.UpdatedAt, &j.CompletedAt,
	)
	if err == pgx.ErrNoRows {
		return Job{}, false, nil
	}
	if err != nil {
		return Job{}, false, err
	}
	if j.CompletedSteps == nil {
		j.CompletedSteps = []string{}
	}
	_, err = tx.Exec(ctx, `
		UPDATE erasure_jobs SET status = $2, updated_at = now() WHERE id = $1
	`, j.ID, StatusRunning)
	if err != nil {
		return Job{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Job{}, false, err
	}
	j.Status = StatusRunning
	return j, true, nil
}

// MarkStepDone appends a completed step.
func (s *Store) MarkStepDone(ctx context.Context, jobID uuid.UUID, step string) error {
	_, err := s.Pool.Exec(ctx, `
		UPDATE erasure_jobs
		SET completed_steps = array_append(completed_steps, $2),
		    last_error = NULL,
		    updated_at = now()
		WHERE id = $1 AND NOT ($2 = ANY(completed_steps))
	`, jobID, step)
	return err
}

// MarkPartialFailure records a step error.
func (s *Store) MarkPartialFailure(ctx context.Context, jobID uuid.UUID, errMsg string) error {
	_, err := s.Pool.Exec(ctx, `
		UPDATE erasure_jobs
		SET status = $2, last_error = $3, updated_at = now()
		WHERE id = $1
	`, jobID, StatusPartialFailure, errMsg)
	return err
}

// MarkCompleted sets terminal completed status.
func (s *Store) MarkCompleted(ctx context.Context, jobID uuid.UUID) error {
	_, err := s.Pool.Exec(ctx, `
		UPDATE erasure_jobs
		SET status = $2, completed_at = now(), updated_at = now(), last_error = NULL
		WHERE id = $1
	`, jobID, StatusCompleted)
	return err
}

// Get returns a job by id.
func (s *Store) Get(ctx context.Context, id uuid.UUID) (Job, error) {
	var j Job
	err := s.Pool.QueryRow(ctx, `
		SELECT id, user_id, status, request_id, completed_steps, last_error,
		       requested_at, updated_at, completed_at
		FROM erasure_jobs WHERE id = $1
	`, id).Scan(
		&j.ID, &j.UserID, &j.Status, &j.RequestID, &j.CompletedSteps, &j.LastError,
		&j.RequestedAt, &j.UpdatedAt, &j.CompletedAt,
	)
	if j.CompletedSteps == nil {
		j.CompletedSteps = []string{}
	}
	return j, err
}

// ListStale returns non-terminal jobs older than age.
func (s *Store) ListStale(ctx context.Context, age time.Duration) ([]Job, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, user_id, status, request_id, completed_steps, last_error,
		       requested_at, updated_at, completed_at
		FROM erasure_jobs
		WHERE status NOT IN ($1, $2)
		  AND requested_at < now() - $3::interval
	`, StatusCompleted, StatusFailed, fmt.Sprintf("%f seconds", age.Seconds()))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Job
	for rows.Next() {
		var j Job
		if err := rows.Scan(
			&j.ID, &j.UserID, &j.Status, &j.RequestID, &j.CompletedSteps, &j.LastError,
			&j.RequestedAt, &j.UpdatedAt, &j.CompletedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

// Worker runs bounded concurrent erasure jobs.
type Worker struct {
	Store         *Store
	RDB           redis.Cmdable
	Sessions      *auth.SessionService
	ObjectStorage ObjectStorage
	PaymentsPool  *pgxpool.Pool // optional
	Logger        *slog.Logger
	Concurrency   int
	PollInterval  time.Duration
	SLAWarnAge    time.Duration
}

func (w *Worker) log() *slog.Logger {
	if w.Logger != nil {
		return w.Logger
	}
	return slog.Default()
}

func (w *Worker) concurrency() int {
	if w.Concurrency > 0 {
		return w.Concurrency
	}
	return 10
}

func (w *Worker) pollInterval() time.Duration {
	if w.PollInterval > 0 {
		return w.PollInterval
	}
	return 2 * time.Second
}

func (w *Worker) slaWarnAge() time.Duration {
	if w.SLAWarnAge > 0 {
		return w.SLAWarnAge
	}
	return 25 * 24 * time.Hour
}

func stepDone(completed []string, step string) bool {
	for _, s := range completed {
		if s == step {
			return true
		}
	}
	return false
}

// Run blocks until ctx is cancelled, claiming and processing jobs.
func (w *Worker) Run(ctx context.Context) {
	sem := make(chan struct{}, w.concurrency())
	ticker := time.NewTicker(w.pollInterval())
	defer ticker.Stop()
	slaTicker := time.NewTicker(time.Hour)
	defer slaTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-slaTicker.C:
			w.warnStale(ctx)
		case <-ticker.C:
			for {
				job, ok, err := w.Store.ClaimNext(ctx)
				if err != nil {
					w.log().Error("erasure claim failed", "error", err)
					break
				}
				if !ok {
					break
				}
				sem <- struct{}{}
				go func(j Job) {
					defer func() { <-sem }()
					w.ProcessJob(ctx, j)
				}(job)
			}
		}
	}
}

func (w *Worker) warnStale(ctx context.Context) {
	jobs, err := w.Store.ListStale(ctx, w.slaWarnAge())
	if err != nil {
		w.log().Error("erasure SLA scan failed", "error", err)
		return
	}
	for _, j := range jobs {
		w.log().Warn("erasure job past 25-day SLA warning",
			"job_id", j.ID.String(),
			"user_id", j.UserID.String(),
			"status", j.Status,
			"requested_at", j.RequestedAt,
		)
	}
}

// ProcessJob runs remaining steps for a claimed job.
func (w *Worker) ProcessJob(ctx context.Context, job Job) {
	if job.RequestID != "" {
		ctx = logging.WithRequestID(ctx, job.RequestID)
	}
	log := logging.FromContext(ctx, w.log()).With(
		slog.String("job_id", job.ID.String()),
		slog.String("user_id", job.UserID.String()),
	)

	for _, step := range OrderedSteps {
		if stepDone(job.CompletedSteps, step) {
			continue
		}
		if err := w.runStep(ctx, job, step); err != nil {
			log.Error("erasure step failed", "step", step, "error", err)
			_ = w.Store.MarkPartialFailure(ctx, job.ID, fmt.Sprintf("%s: %v", step, err))
			return
		}
		if err := w.Store.MarkStepDone(ctx, job.ID, step); err != nil {
			log.Error("erasure mark step failed", "step", step, "error", err)
			_ = w.Store.MarkPartialFailure(ctx, job.ID, fmt.Sprintf("mark %s: %v", step, err))
			return
		}
		job.CompletedSteps = append(job.CompletedSteps, step)
		log.Info("erasure step completed", "step", step)
	}
	if err := w.Store.MarkCompleted(ctx, job.ID); err != nil {
		log.Error("erasure mark completed failed", "error", err)
		return
	}
	log.Info("erasure job completed")
}

func (w *Worker) runStep(ctx context.Context, job Job, step string) error {
	switch step {
	case StepLocationHistory, StepTileOwnership:
		// Legacy GPS stores are not present in the province-support product.
		return nil
	case StepPostgresCascade:
		return w.deletePostgresCascade(ctx, job.UserID)
	case StepRedisCleanup:
		return w.cleanupRedis(ctx, job.UserID)
	case StepObjectStorage:
		storage := w.ObjectStorage
		if storage == nil {
			storage = StubObjectStorage{}
		}
		return storage.DeleteUserObjects(ctx, job.UserID)
	case StepAnonymizeUser:
		return w.anonymizeUser(ctx, job.UserID)
	case StepPayments:
		return w.purgePayments(ctx, job.UserID)
	case StepAnalyticsEvent:
		return w.emitAnalyticsDeletion(ctx, job)
	default:
		return fmt.Errorf("unknown step %q", step)
	}
}

func (w *Worker) deletePostgresCascade(ctx context.Context, userID uuid.UUID) error {
	tx, err := w.Store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	stmts := []string{
		`DELETE FROM credit_ledger WHERE user_id = $1`,
		`DELETE FROM credit_accounts WHERE user_id = $1`,
		`DELETE FROM supports WHERE user_id = $1`,
		`DELETE FROM user_support_streaks WHERE user_id = $1`,
		`DELETE FROM iap_purchases WHERE user_id = $1`,
		`DELETE FROM web_purchases WHERE user_id = $1`,
		`DELETE FROM invoices WHERE user_id = $1`,
		`DELETE FROM appeals WHERE user_id = $1`,
		`DELETE FROM device_push_tokens WHERE user_id = $1`,
		`DELETE FROM social_identities WHERE user_id = $1`,
		`DELETE FROM user_xp WHERE user_id = $1`,
		`DELETE FROM user_quest_progress WHERE user_id = $1`,
		`DELETE FROM user_cosmetics WHERE user_id = $1`,
		`DELETE FROM user_battle_pass_claims WHERE user_id = $1`,
		`DELETE FROM user_battle_pass WHERE user_id = $1`,
		`DELETE FROM event_reactions WHERE user_id = $1`,
		`DELETE FROM referral_redemptions WHERE referrer_id = $1 OR referee_id = $1`,
		`DELETE FROM referral_codes WHERE user_id = $1`,
		`DELETE FROM flagged_users WHERE user_id = $1`,
		`DELETE FROM user_device_fingerprints WHERE user_id = $1`,
		`DELETE FROM achievements WHERE user_id = $1`,
		`DELETE FROM activity_events WHERE actor_id = $1`,
		`DELETE FROM messages WHERE sender_id = $1 OR recipient_id = $1`,
		`DELETE FROM user_relations WHERE from_user_id = $1 OR to_user_id = $1`,
		`DELETE FROM user_reports WHERE reporter_id = $1 OR reported_id = $1`,
		// derbies.created_by_admin_id is NOT NULL; tombstoned admin UUID remains a valid FK.
		`UPDATE tribes SET created_by_admin_id = NULL WHERE created_by_admin_id = $1`,
	}
	for _, q := range stmts {
		if _, err := tx.Exec(ctx, q, userID); err != nil {
			return fmt.Errorf("%s: %w", q, err)
		}
	}
	return tx.Commit(ctx)
}

func (w *Worker) cleanupRedis(ctx context.Context, userID uuid.UUID) error {
	uid := userID.String()
	patterns := []string{
		fmt.Sprintf("ratelimit:%s:*", uid),
		fmt.Sprintf("notif_push:*:%s:*", uid),
		fmt.Sprintf("notif_rl:*:%s:*", uid),
		fmt.Sprintf("user:%s:*", uid),
	}
	for _, pattern := range patterns {
		if err := scanDelete(ctx, w.RDB, pattern); err != nil {
			return err
		}
	}
	if err := w.RDB.Set(ctx, fmt.Sprintf("location_tracking_disabled:%s", uid), "1", 0).Err(); err != nil {
		return fmt.Errorf("location flag: %w", err)
	}
	if w.Sessions != nil {
		if err := w.Sessions.RevokeAll(ctx, userID); err != nil {
			return fmt.Errorf("revoke sessions: %w", err)
		}
	}
	if err := zremUserFromLeaderboards(ctx, w.RDB, uid); err != nil {
		return err
	}
	return nil
}

// scanDelete deletes keys matching pattern via SCAN (never KEYS).
func scanDelete(ctx context.Context, rdb redis.Cmdable, pattern string) error {
	var cursor uint64
	for {
		keys, next, err := rdb.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			return fmt.Errorf("scan %s: %w", pattern, err)
		}
		if len(keys) > 0 {
			if err := rdb.Del(ctx, keys...).Err(); err != nil {
				return fmt.Errorf("del: %w", err)
			}
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	return nil
}

func zremUserFromLeaderboards(ctx context.Context, rdb redis.Cmdable, userID string) error {
	patterns := []string{
		"lb:global:supporters",
		"lb:tribe:*:supporters",
		"lb:province:*:supporters",
		"lb:derby:*:supporters",
	}
	for _, pattern := range patterns {
		if pattern == "lb:global:supporters" {
			if err := rdb.ZRem(ctx, pattern, userID).Err(); err != nil {
				return err
			}
			continue
		}
		var cursor uint64
		for {
			keys, next, err := rdb.Scan(ctx, cursor, pattern, 50).Result()
			if err != nil {
				return err
			}
			for _, key := range keys {
				if err := rdb.ZRem(ctx, key, userID).Err(); err != nil {
					return err
				}
			}
			cursor = next
			if cursor == 0 {
				break
			}
		}
	}
	return nil
}

func (w *Worker) anonymizeUser(ctx context.Context, userID uuid.UUID) error {
	// Username max 24 chars (users_username_len).
	hex := strings.ReplaceAll(userID.String(), "-", "")
	tombstone := "e" + hex
	if len(tombstone) > 24 {
		tombstone = tombstone[:24]
	}
	_, err := w.Store.Pool.Exec(ctx, `
		UPDATE consent_events
		SET ip_address = NULL, user_agent = NULL
		WHERE user_id = $1
	`, userID)
	if err != nil {
		return fmt.Errorf("anonymize consent: %w", err)
	}
	_, err = w.Store.Pool.Exec(ctx, `
		UPDATE users
		SET phone = NULL,
		    email = NULL,
		    username = $2,
		    birth_date = DATE '1900-01-01',
		    status = 'erased',
		    tribe_id = NULL,
		    avatar_url = NULL
		WHERE id = $1
	`, userID, tombstone)
	if err != nil {
		return fmt.Errorf("tombstone user: %w", err)
	}
	return nil
}

func (w *Worker) purgePayments(ctx context.Context, userID uuid.UUID) error {
	if w.PaymentsPool == nil {
		return nil
	}
	_, err := w.PaymentsPool.Exec(ctx, `DELETE FROM payment_intents WHERE user_id = $1`, userID)
	if err != nil {
		return fmt.Errorf("payments purge: %w", err)
	}
	return nil
}

func (w *Worker) emitAnalyticsDeletion(ctx context.Context, job Job) error {
	_, err := w.Store.Pool.Exec(ctx, `
		INSERT INTO analytics_deletion_events (user_id, job_id, request_id)
		VALUES ($1, $2, $3)
	`, job.UserID, job.ID, job.RequestID)
	return err
}

// ProcessOnce claims and processes a single job (tests).
func (w *Worker) ProcessOnce(ctx context.Context) (bool, error) {
	job, ok, err := w.Store.ClaimNext(ctx)
	if err != nil || !ok {
		return ok, err
	}
	w.ProcessJob(ctx, job)
	return true, nil
}
