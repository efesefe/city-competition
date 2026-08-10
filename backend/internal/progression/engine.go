package progression

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/derby"
	"github.com/city-competition-remastered/backend/internal/support"
)

// Engine applies XP and quest progress from domain events (no polling).
type Engine struct {
	Pool   *pgxpool.Pool
	Store  *Store
	Logger *slog.Logger
	Now    func() time.Time
}

func (e *Engine) store() *Store {
	if e.Store != nil {
		return e.Store
	}
	return &Store{Pool: e.Pool}
}

func (e *Engine) now() time.Time {
	if e.Now != nil {
		return e.Now()
	}
	return time.Now().UTC()
}

func (e *Engine) log() *slog.Logger {
	if e.Logger != nil {
		return e.Logger
	}
	return slog.Default()
}

// OnSupportApplied awards support XP and evaluates support_count / derby_support quests.
func (e *Engine) OnSupportApplied(ctx context.Context, ev support.SupportAppliedEvent) {
	if e == nil || e.Pool == nil {
		return
	}
	if _, err := e.store().AwardXP(ctx, ev.UserID, XPSupportApplied, "support_applied"); err != nil {
		e.log().Warn("progression award support xp", "err", err, "user_id", ev.UserID)
	}
	qev := QuestEvent{
		Kind:       "support_applied",
		IlCode:     ev.IlCode,
		DerbyIDSet: ev.DerbyID != nil,
	}
	if err := e.applyQuests(ctx, ev.UserID, qev); err != nil {
		e.log().Warn("progression quests support", "err", err, "user_id", ev.UserID)
	}
}

// OnStreakUpdated awards streak XP when current streak advances and evaluates streak quests.
func (e *Engine) OnStreakUpdated(ctx context.Context, ev support.StreakUpdatedEvent) {
	if e == nil || e.Pool == nil {
		return
	}
	if ev.CurrentStreak > ev.PreviousStreak {
		if _, err := e.store().AwardXP(ctx, ev.UserID, XPStreakAdvance, "streak_updated"); err != nil {
			e.log().Warn("progression award streak xp", "err", err, "user_id", ev.UserID)
		}
	}
	qev := QuestEvent{
		Kind:          "streak_updated",
		CurrentStreak: ev.CurrentStreak,
	}
	if err := e.applyQuests(ctx, ev.UserID, qev); err != nil {
		e.log().Warn("progression quests streak", "err", err, "user_id", ev.UserID)
	}
}

// OnDerbyResolved awards derby XP to distinct supporters of the resolved derby.
func (e *Engine) OnDerbyResolved(ctx context.Context, ev derby.ResolvedEvent) {
	if e == nil || e.Pool == nil {
		return
	}
	rows, err := e.Pool.Query(ctx, `
		SELECT DISTINCT user_id FROM supports WHERE derby_id = $1
	`, ev.DerbyID)
	if err != nil {
		e.log().Warn("progression derby supporters", "err", err, "derby_id", ev.DerbyID)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var userID uuid.UUID
		if err := rows.Scan(&userID); err != nil {
			e.log().Warn("progression scan derby supporter", "err", err)
			continue
		}
		if _, err := e.store().AwardXP(ctx, userID, XPDerbyResolved, "derby_resolved"); err != nil {
			e.log().Warn("progression award derby xp", "err", err, "user_id", userID)
		}
	}
	if err := rows.Err(); err != nil {
		e.log().Warn("progression derby supporters rows", "err", err)
	}
}

type questTemplateRow struct {
	ID       uuid.UUID
	Period   string
	Criteria []byte
	XPReward int
}

func (e *Engine) applyQuests(ctx context.Context, userID uuid.UUID, ev QuestEvent) error {
	rows, err := e.Pool.Query(ctx, `
		SELECT id, period, criteria, xp_reward
		FROM quest_templates
		WHERE active = true
	`)
	if err != nil {
		return fmt.Errorf("load quest_templates: %w", err)
	}
	defer rows.Close()

	var templates []questTemplateRow
	for rows.Next() {
		var t questTemplateRow
		if err := rows.Scan(&t.ID, &t.Period, &t.Criteria, &t.XPReward); err != nil {
			return fmt.Errorf("scan quest_template: %w", err)
		}
		templates = append(templates, t)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	now := e.now()
	for _, t := range templates {
		criteria, err := ParseCriteria(t.Criteria)
		if err != nil {
			e.log().Warn("skip bad quest criteria", "template_id", t.ID, "err", err)
			continue
		}
		if !criteriaMatchesEvent(criteria.Type, ev.Kind) {
			continue
		}
		if err := e.applyOneQuest(ctx, userID, t, criteria, ev, now); err != nil {
			return err
		}
	}
	return nil
}

func criteriaMatchesEvent(criteriaType, eventKind string) bool {
	switch criteriaType {
	case CriteriaSupportCount, CriteriaDerbySupport:
		return eventKind == "support_applied"
	case CriteriaStreak:
		return eventKind == "streak_updated"
	default:
		return false
	}
}

func (e *Engine) applyOneQuest(
	ctx context.Context,
	userID uuid.UUID,
	t questTemplateRow,
	criteria Criteria,
	ev QuestEvent,
	now time.Time,
) error {
	periodKey := PeriodKey(t.Period, now)

	tx, err := e.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin quest tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var (
		progressID uuid.UUID
		progress   int
		metaBytes  []byte
		status     string
	)
	err = tx.QueryRow(ctx, `
		SELECT id, progress, progress_meta, status
		FROM user_quest_progress
		WHERE user_id = $1 AND template_id = $2 AND period_key = $3
		FOR UPDATE
	`, userID, t.ID, periodKey).Scan(&progressID, &progress, &metaBytes, &status)
	if err == pgx.ErrNoRows {
		metaBytes = []byte(`{}`)
		err = tx.QueryRow(ctx, `
			INSERT INTO user_quest_progress (user_id, template_id, period_key, progress, progress_meta, status)
			VALUES ($1, $2, $3, 0, '{}'::jsonb, 'active')
			RETURNING id, progress, progress_meta, status
		`, userID, t.ID, periodKey).Scan(&progressID, &progress, &metaBytes, &status)
	}
	if err != nil {
		return fmt.Errorf("ensure quest progress: %w", err)
	}
	if status == "completed" {
		return tx.Commit(ctx)
	}

	var meta map[string]any
	if len(metaBytes) > 0 {
		_ = json.Unmarshal(metaBytes, &meta)
	}
	if meta == nil {
		meta = map[string]any{}
	}

	state := ProgressState{
		Progress:  progress,
		Provinces: ProvincesFromMeta(meta),
	}
	newState, complete := ApplyEvent(criteria, state, ev)

	wasComplete := progress >= criteria.Target
	progressChanged := newState.Progress != progress
	provincesChanged := !sameProvinceSet(state.Provinces, newState.Provinces)
	if !progressChanged && !provincesChanged && !(complete && !wasComplete) {
		return tx.Commit(ctx)
	}

	newMeta := meta
	if criteria.Type == CriteriaSupportCount && criteria.Scope == ScopeProvince {
		newMeta = MetaFromProvinces(newState.Provinces)
	}
	rawMeta, err := json.Marshal(newMeta)
	if err != nil {
		return fmt.Errorf("marshal progress_meta: %w", err)
	}

	newStatus := status
	var completedAt *time.Time
	if complete {
		newStatus = "completed"
		ts := now
		completedAt = &ts
	}

	_, err = tx.Exec(ctx, `
		UPDATE user_quest_progress
		SET progress = $2,
		    progress_meta = $3::jsonb,
		    status = $4,
		    completed_at = COALESCE($5, completed_at),
		    updated_at = now()
		WHERE id = $1
	`, progressID, newState.Progress, string(rawMeta), newStatus, completedAt)
	if err != nil {
		return fmt.Errorf("update quest progress: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit quest tx: %w", err)
	}

	if complete && !wasComplete && t.XPReward > 0 {
		if _, err := e.store().AwardXP(ctx, userID, t.XPReward, "quest:"+t.ID.String()); err != nil {
			return fmt.Errorf("quest xp reward: %w", err)
		}
	}
	return nil
}

func sameProvinceSet(a, b map[string]struct{}) bool {
	if len(a) != len(b) {
		return false
	}
	for k := range a {
		if _, ok := b[k]; !ok {
			return false
		}
	}
	return true
}
