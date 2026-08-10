package progression_test

import (
	"testing"

	"github.com/city-competition-remastered/backend/internal/progression"
)

func TestLookupRank_ThresholdBoundaries(t *testing.T) {
	tiers := []progression.RankTier{
		{MinXP: 0, BadgeName: "Çaylak", SortOrder: 1},
		{MinXP: 100, BadgeName: "Destekçi", SortOrder: 2},
		{MinXP: 500, BadgeName: "Veteran", SortOrder: 3},
		{MinXP: 2000, BadgeName: "Efsane", SortOrder: 4},
	}

	cases := []struct {
		xp   int
		want string
	}{
		{0, "Çaylak"},
		{99, "Çaylak"},
		{100, "Destekçi"}, // exact threshold
		{101, "Destekçi"},
		{499, "Destekçi"},
		{500, "Veteran"},
		{1999, "Veteran"},
		{2000, "Efsane"},
		{99999, "Efsane"},
	}
	for _, tc := range cases {
		got := progression.LookupRank(tiers, tc.xp)
		if got.BadgeName != tc.want {
			t.Fatalf("xp=%d: badge=%q want %q", tc.xp, got.BadgeName, tc.want)
		}
	}
}

func TestLookupRank_EmptyTiers(t *testing.T) {
	got := progression.LookupRank(nil, 100)
	if got.BadgeName != "" || got.MinXP != 0 {
		t.Fatalf("empty tiers: got %+v", got)
	}
}

func TestLookupRank_UnsortedInput(t *testing.T) {
	tiers := []progression.RankTier{
		{MinXP: 500, BadgeName: "Veteran", SortOrder: 3},
		{MinXP: 0, BadgeName: "Çaylak", SortOrder: 1},
		{MinXP: 100, BadgeName: "Destekçi", SortOrder: 2},
	}
	got := progression.LookupRank(tiers, 100)
	if got.BadgeName != "Destekçi" {
		t.Fatalf("unsorted: got %q want Destekçi", got.BadgeName)
	}
}
