package progression

import (
	"encoding/json"
	"fmt"
	"time"
)

// Criteria types supported by the generic evaluator.
const (
	CriteriaSupportCount = "support_count"
	CriteriaDerbySupport = "derby_support"
	CriteriaStreak       = "streak"
)

// ScopeProvince counts distinct provinces for support_count quests.
const ScopeProvince = "province"

// Criteria is the JSONB shape stored on quest_templates.
type Criteria struct {
	Type   string `json:"type"`
	Target int    `json:"target"`
	Scope  string `json:"scope,omitempty"`
}

// ParseCriteria unmarshals quest_templates.criteria JSONB.
func ParseCriteria(raw []byte) (Criteria, error) {
	var c Criteria
	if err := json.Unmarshal(raw, &c); err != nil {
		return Criteria{}, fmt.Errorf("parse criteria: %w", err)
	}
	if c.Type == "" {
		return Criteria{}, fmt.Errorf("criteria type required")
	}
	if c.Target <= 0 {
		return Criteria{}, fmt.Errorf("criteria target must be positive")
	}
	return c, nil
}

// QuestEvent is a normalized domain event for the evaluator.
type QuestEvent struct {
	Kind          string // support_applied | derby_resolved | streak_updated
	IlCode        string
	DerbyIDSet    bool
	CurrentStreak int
}

// ProgressState is the mutable progress snapshot for one period.
type ProgressState struct {
	Progress int
	// Provinces tracks distinct il_codes for scope=province (from progress_meta).
	Provinces map[string]struct{}
}

// ApplyEvent advances progress for criteria against a domain event.
// Returns the updated state and whether the quest is newly complete (progress crossed target).
// Already-complete callers should not invoke this; the engine skips completed rows.
func ApplyEvent(criteria Criteria, state ProgressState, ev QuestEvent) (ProgressState, bool) {
	out := state
	if out.Provinces == nil {
		out.Provinces = map[string]struct{}{}
	}

	switch criteria.Type {
	case CriteriaSupportCount:
		if ev.Kind != "support_applied" {
			return out, false
		}
		if criteria.Scope == ScopeProvince {
			if ev.IlCode == "" {
				return out, false
			}
			if _, seen := out.Provinces[ev.IlCode]; seen {
				return out, false
			}
			out.Provinces[ev.IlCode] = struct{}{}
			out.Progress = len(out.Provinces)
		} else {
			out.Progress++
		}
	case CriteriaDerbySupport:
		if ev.Kind != "support_applied" || !ev.DerbyIDSet {
			return out, false
		}
		out.Progress++
	case CriteriaStreak:
		if ev.Kind != "streak_updated" {
			return out, false
		}
		if ev.CurrentStreak > out.Progress {
			out.Progress = ev.CurrentStreak
		}
	default:
		// Unknown types are ignored so new template rows with known types stay evaluable;
		// unknown types simply never advance (content authors use documented types).
		return out, false
	}

	complete := out.Progress >= criteria.Target
	return out, complete
}

// PeriodKey returns the Istanbul calendar key for a quest period.
// daily: 2006-01-02; weekly: 2006-W02 (ISO week).
func PeriodKey(period string, now time.Time) string {
	in := now.In(istanbul)
	switch period {
	case "weekly":
		year, week := in.ISOWeek()
		return fmt.Sprintf("%04d-W%02d", year, week)
	default: // daily
		return in.Format("2006-01-02")
	}
}

// ProvincesFromMeta extracts the province set from progress_meta JSON.
func ProvincesFromMeta(meta map[string]any) map[string]struct{} {
	out := map[string]struct{}{}
	raw, ok := meta["provinces"]
	if !ok || raw == nil {
		return out
	}
	switch v := raw.(type) {
	case []any:
		for _, item := range v {
			if s, ok := item.(string); ok && s != "" {
				out[s] = struct{}{}
			}
		}
	case []string:
		for _, s := range v {
			if s != "" {
				out[s] = struct{}{}
			}
		}
	}
	return out
}

// MetaFromProvinces builds progress_meta for persistence.
func MetaFromProvinces(provinces map[string]struct{}) map[string]any {
	list := make([]string, 0, len(provinces))
	for p := range provinces {
		list = append(list, p)
	}
	return map[string]any{"provinces": list}
}
