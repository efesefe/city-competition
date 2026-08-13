package conquest

import (
	"testing"
	"time"
)

func TestContestTension(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		first  float64
		second float64
		want   float64
	}{
		{name: "no leader", first: 0, second: 10, want: 0},
		{name: "no challenger", first: 100, second: 0, want: 0},
		{name: "near flip", first: 100, second: 99, want: 0.99},
		{name: "tied", first: 50, second: 50, want: 1},
		{name: "second exceeds", first: 100, second: 150, want: 1},
		{name: "after overshoot", first: 299, second: 100, want: 100.0 / 299.0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ContestTension(tc.first, tc.second)
			if got != tc.want {
				t.Fatalf("ContestTension(%v, %v)=%v want %v", tc.first, tc.second, got, tc.want)
			}
		})
	}
}

func TestStreakDays_IstanbulCalendar(t *testing.T) {
	t.Parallel()
	loc := Istanbul()
	dayD := time.Date(2026, 3, 15, 18, 30, 0, 0, loc)
	sameDayMorning := time.Date(2026, 3, 15, 0, 0, 0, 0, loc)
	nextMidnight := time.Date(2026, 3, 16, 0, 0, 0, 0, loc)
	fiveDaysLater := time.Date(2026, 3, 20, 12, 0, 0, 0, loc)

	if got := streakDays(sameDayMorning, dayD); got != 0 {
		t.Fatalf("same calendar day streak=%d want 0", got)
	}
	if got := streakDays(dayD, dayD); got != 0 {
		t.Fatalf("capture instant streak=%d want 0", got)
	}
	if got := streakDays(nextMidnight, dayD); got != 1 {
		t.Fatalf("next Istanbul midnight streak=%d want 1", got)
	}
	if got := streakDays(fiveDaysLater, dayD); got != 5 {
		t.Fatalf("five days later streak=%d want 5", got)
	}
}

func TestIstanbulDayBounds_DoesNotIncludeNextMidnight(t *testing.T) {
	t.Parallel()
	loc := Istanbul()
	now := time.Date(2026, 3, 15, 23, 59, 0, 0, loc)
	start, end := istanbulDayBounds(now)
	flipToday := time.Date(2026, 3, 15, 0, 0, 0, 0, loc)
	flipTomorrow := time.Date(2026, 3, 16, 0, 0, 0, 0, loc)
	if !flipToday.Equal(start) && !flipToday.After(start) {
		t.Fatalf("today start=%s want <= %s", start, flipToday)
	}
	if !flipToday.Before(end) {
		t.Fatalf("today 00:00 should be in window, end=%s", end)
	}
	if !flipTomorrow.Equal(end) && flipTomorrow.Before(end) {
		t.Fatalf("tomorrow 00:00 must be excluded, end=%s", end)
	}
	if !flipTomorrow.Equal(end) {
		t.Fatalf("end=%s want %s", end, flipTomorrow)
	}
}
