package moderation_test

import (
	"testing"

	"github.com/city-competition-remastered/backend/internal/moderation"
)

func TestNormalizeForMatch_TurkishIAndLeet(t *testing.T) {
	// İ folds to i under Turkish Lower; leet 1→i so both normalize similarly.
	a := moderation.NormalizeForMatch("SİK")
	b := moderation.NormalizeForMatch("s1k")
	if a == "" || b == "" {
		t.Fatal("expected non-empty normalized forms")
	}
	if a != moderation.NormalizeForMatch("sik") {
		t.Fatalf("Turkish fold: got %q want sik-folded", a)
	}
	if b != moderation.NormalizeForMatch("sik") {
		t.Fatalf("leet: got %q want sik-folded", b)
	}
}

func TestContainsProfanity_FlaggedAndClean(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"merhaba nasılsın", false},
		{"güzel bir gün", false},
		{"siktir git", true},
		{"SİK", true},
		{"s1ktir", true},
		{"o r o s p u", true},
		{"a.q", true},
	}
	for _, tc := range cases {
		got := moderation.ContainsProfanity(tc.in)
		if got != tc.want {
			t.Errorf("ContainsProfanity(%q)=%v want %v", tc.in, got, tc.want)
		}
	}
}
