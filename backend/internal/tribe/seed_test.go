package tribe_test

import (
	"testing"

	"github.com/city-competition-remastered/backend/internal/tribe"
)

func TestLoadSeedTribes(t *testing.T) {
	tribes, err := tribe.LoadSeedTribes()
	if err != nil {
		t.Fatalf("LoadSeedTribes: %v", err)
	}
	if len(tribes) != 10 {
		t.Fatalf("expected 10 tribes, got %d", len(tribes))
	}
	seen := make(map[string]struct{}, len(tribes))
	for _, tr := range tribes {
		if tr.DisplayName == "" {
			t.Fatalf("empty display_name for slug %q", tr.Slug)
		}
		if tr.Slug == "" {
			t.Fatal("empty slug")
		}
		if _, ok := seen[tr.Slug]; ok {
			t.Fatalf("duplicate slug %q", tr.Slug)
		}
		seen[tr.Slug] = struct{}{}
	}
}

func TestValidateSeedTribesRejectsDuplicates(t *testing.T) {
	base, err := tribe.LoadSeedTribes()
	if err != nil {
		t.Fatal(err)
	}
	base[1].Slug = base[0].Slug
	if err := tribe.ValidateSeedTribes(base); err == nil {
		t.Fatal("expected duplicate slug error")
	}
}
