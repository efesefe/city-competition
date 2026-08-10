package engagement_test

import (
	"testing"
	"time"

	"github.com/city-competition-remastered/backend/internal/engagement"
)

func TestNextStreak_ConsecutiveIstanbulDays_Increments(t *testing.T) {
	loc := engagement.Istanbul()
	day1 := time.Date(2026, 3, 10, 22, 0, 0, 0, loc)
	day2 := time.Date(2026, 3, 11, 1, 0, 0, 0, loc)

	s1 := engagement.NextStreak(engagement.StreakState{}, day1)
	if s1.CurrentStreak != 1 || s1.LongestStreak != 1 {
		t.Fatalf("day1: current=%d longest=%d want 1/1", s1.CurrentStreak, s1.LongestStreak)
	}

	s2 := engagement.NextStreak(s1, day2)
	if s2.CurrentStreak != 2 || s2.LongestStreak != 2 {
		t.Fatalf("day2: current=%d longest=%d want 2/2", s2.CurrentStreak, s2.LongestStreak)
	}
}

func TestNextStreak_SkipDay_ResetsTo1(t *testing.T) {
	loc := engagement.Istanbul()
	day1 := time.Date(2026, 3, 10, 12, 0, 0, 0, loc)
	day3 := time.Date(2026, 3, 12, 12, 0, 0, 0, loc)

	s1 := engagement.NextStreak(engagement.StreakState{}, day1)
	s3 := engagement.NextStreak(s1, day3)
	if s3.CurrentStreak != 1 {
		t.Fatalf("after skip: current=%d want 1", s3.CurrentStreak)
	}
	if s3.LongestStreak != 1 {
		t.Fatalf("after skip: longest=%d want 1", s3.LongestStreak)
	}
}

func TestNextStreak_SameDay_NoChange(t *testing.T) {
	loc := engagement.Istanbul()
	morning := time.Date(2026, 3, 10, 9, 0, 0, 0, loc)
	evening := time.Date(2026, 3, 10, 23, 30, 0, 0, loc)

	s1 := engagement.NextStreak(engagement.StreakState{}, morning)
	s2 := engagement.NextStreak(s1, evening)
	if s2.CurrentStreak != 1 || s2.LongestStreak != 1 {
		t.Fatalf("same day: current=%d longest=%d want 1/1", s2.CurrentStreak, s2.LongestStreak)
	}
}

func TestNextStreak_LongestPreservedOnReset(t *testing.T) {
	loc := engagement.Istanbul()
	d1 := time.Date(2026, 3, 1, 12, 0, 0, 0, loc)
	d2 := time.Date(2026, 3, 2, 12, 0, 0, 0, loc)
	d3 := time.Date(2026, 3, 3, 12, 0, 0, 0, loc)
	d5 := time.Date(2026, 3, 5, 12, 0, 0, 0, loc)

	s := engagement.NextStreak(engagement.StreakState{}, d1)
	s = engagement.NextStreak(s, d2)
	s = engagement.NextStreak(s, d3)
	if s.CurrentStreak != 3 || s.LongestStreak != 3 {
		t.Fatalf("before skip: current=%d longest=%d want 3/3", s.CurrentStreak, s.LongestStreak)
	}
	s = engagement.NextStreak(s, d5)
	if s.CurrentStreak != 1 {
		t.Fatalf("after skip: current=%d want 1", s.CurrentStreak)
	}
	if s.LongestStreak != 3 {
		t.Fatalf("after skip: longest=%d want 3", s.LongestStreak)
	}
}

func TestNextStreak_UTCNearMidnight_UsesIstanbulCalendar(t *testing.T) {
	// 2026-03-10 22:00 UTC == 2026-03-11 01:00 Istanbul — counts as March 11.
	utcEvening := time.Date(2026, 3, 10, 22, 0, 0, 0, time.UTC)
	prevDate := time.Date(2026, 3, 10, 0, 0, 0, 0, engagement.Istanbul())
	prev := engagement.StreakState{
		CurrentStreak:   1,
		LongestStreak:   1,
		LastSupportDate: &prevDate,
	}
	next := engagement.NextStreak(prev, utcEvening)
	if next.CurrentStreak != 2 {
		t.Fatalf("UTC near midnight: current=%d want 2 (Istanbul next day)", next.CurrentStreak)
	}
}
