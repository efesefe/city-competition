package progression_test

import (
	"testing"
	"time"

	"github.com/city-competition-remastered/backend/internal/progression"
)

func TestApplyEvent_SupportCount_CompletesAfterN(t *testing.T) {
	criteria := progression.Criteria{
		Type:   progression.CriteriaSupportCount,
		Target: 3,
	}
	state := progression.ProgressState{}
	var complete bool
	for i := 0; i < 3; i++ {
		state, complete = progression.ApplyEvent(criteria, state, progression.QuestEvent{
			Kind:   "support_applied",
			IlCode: "34",
		})
		if i < 2 && complete {
			t.Fatalf("completed early at event %d progress=%d", i+1, state.Progress)
		}
	}
	if !complete {
		t.Fatalf("expected complete after 3 events, progress=%d", state.Progress)
	}
	if state.Progress != 3 {
		t.Fatalf("progress=%d want 3", state.Progress)
	}
}

func TestApplyEvent_SupportCount_ProvinceDistinct(t *testing.T) {
	criteria := progression.Criteria{
		Type:   progression.CriteriaSupportCount,
		Target: 3,
		Scope:  progression.ScopeProvince,
	}
	state := progression.ProgressState{}
	var complete bool

	state, complete = progression.ApplyEvent(criteria, state, progression.QuestEvent{
		Kind: "support_applied", IlCode: "34",
	})
	if complete || state.Progress != 1 {
		t.Fatalf("after 34: progress=%d complete=%v", state.Progress, complete)
	}
	// Same province again — no advance.
	state, complete = progression.ApplyEvent(criteria, state, progression.QuestEvent{
		Kind: "support_applied", IlCode: "34",
	})
	if complete || state.Progress != 1 {
		t.Fatalf("repeat 34: progress=%d complete=%v", state.Progress, complete)
	}
	state, _ = progression.ApplyEvent(criteria, state, progression.QuestEvent{
		Kind: "support_applied", IlCode: "06",
	})
	state, complete = progression.ApplyEvent(criteria, state, progression.QuestEvent{
		Kind: "support_applied", IlCode: "35",
	})
	if !complete || state.Progress != 3 {
		t.Fatalf("after 3 provinces: progress=%d complete=%v", state.Progress, complete)
	}
}

func TestApplyEvent_DerbySupport(t *testing.T) {
	criteria := progression.Criteria{Type: progression.CriteriaDerbySupport, Target: 1}
	state, complete := progression.ApplyEvent(criteria, progression.ProgressState{}, progression.QuestEvent{
		Kind: "support_applied", DerbyIDSet: false,
	})
	if complete || state.Progress != 0 {
		t.Fatalf("without derby: progress=%d complete=%v", state.Progress, complete)
	}
	state, complete = progression.ApplyEvent(criteria, state, progression.QuestEvent{
		Kind: "support_applied", DerbyIDSet: true,
	})
	if !complete || state.Progress != 1 {
		t.Fatalf("with derby: progress=%d complete=%v", state.Progress, complete)
	}
}

func TestApplyEvent_StreakAbsolute(t *testing.T) {
	criteria := progression.Criteria{Type: progression.CriteriaStreak, Target: 5}
	state, complete := progression.ApplyEvent(criteria, progression.ProgressState{}, progression.QuestEvent{
		Kind: "streak_updated", CurrentStreak: 3,
	})
	if complete || state.Progress != 3 {
		t.Fatalf("streak 3: progress=%d complete=%v", state.Progress, complete)
	}
	state, complete = progression.ApplyEvent(criteria, state, progression.QuestEvent{
		Kind: "streak_updated", CurrentStreak: 5,
	})
	if !complete || state.Progress != 5 {
		t.Fatalf("streak 5: progress=%d complete=%v", state.Progress, complete)
	}
}

func TestPeriodKey_DailyWeeklyIstanbul(t *testing.T) {
	loc := progression.Istanbul()
	now := time.Date(2026, 8, 10, 23, 30, 0, 0, loc)
	if got := progression.PeriodKey("daily", now); got != "2026-08-10" {
		t.Fatalf("daily: got %q", got)
	}
	// ISO week for 2026-08-10 is week 33.
	if got := progression.PeriodKey("weekly", now); got != "2026-W33" {
		t.Fatalf("weekly: got %q want 2026-W33", got)
	}
}
