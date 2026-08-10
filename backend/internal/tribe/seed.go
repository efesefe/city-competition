package tribe

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	_ "embed"
)

//go:embed seed/parody_tribes.json
var parodyTribesJSON []byte

// SeedTribe is one row from parody_tribes.json (fiction names only).
type SeedTribe struct {
	Slug           string `json:"slug"`
	DisplayName    string `json:"display_name"`
	ShortName      string `json:"short_name"`
	PrimaryColor   string `json:"primary_color"`
	SecondaryColor string `json:"secondary_color"`
}

// LoadSeedTribes parses and validates the embedded parody tribe seed.
// Tribe names are never hardcoded in Go source — only in the JSON file.
func LoadSeedTribes() ([]SeedTribe, error) {
	var tribes []SeedTribe
	if err := json.Unmarshal(parodyTribesJSON, &tribes); err != nil {
		return nil, fmt.Errorf("parse parody_tribes.json: %w", err)
	}
	if err := ValidateSeedTribes(tribes); err != nil {
		return nil, err
	}
	return tribes, nil
}

// ValidateSeedTribes ensures exactly 10 tribes with unique slugs and non-empty names.
func ValidateSeedTribes(tribes []SeedTribe) error {
	if len(tribes) != 10 {
		return fmt.Errorf("expected exactly 10 seed tribes, got %d", len(tribes))
	}
	seen := make(map[string]struct{}, len(tribes))
	for i, t := range tribes {
		if strings.TrimSpace(t.Slug) == "" {
			return fmt.Errorf("seed tribe[%d]: empty slug", i)
		}
		if strings.TrimSpace(t.DisplayName) == "" {
			return fmt.Errorf("seed tribe[%d]: empty display_name", i)
		}
		if strings.TrimSpace(t.ShortName) == "" {
			return fmt.Errorf("seed tribe[%d]: empty short_name", i)
		}
		if strings.TrimSpace(t.PrimaryColor) == "" || strings.TrimSpace(t.SecondaryColor) == "" {
			return fmt.Errorf("seed tribe[%d]: empty color", i)
		}
		if _, ok := seen[t.Slug]; ok {
			return fmt.Errorf("duplicate seed slug: %s", t.Slug)
		}
		seen[t.Slug] = struct{}{}
	}
	return nil
}

// SeedUpserter persists seed tribes (typically by unique slug).
type SeedUpserter interface {
	UpsertSeedTribe(ctx context.Context, t SeedTribe) error
}

// EnsureSeeded upserts all embedded parody tribes. Safe to call on every boot.
func EnsureSeeded(ctx context.Context, store SeedUpserter) error {
	tribes, err := LoadSeedTribes()
	if err != nil {
		return err
	}
	for _, t := range tribes {
		if err := store.UpsertSeedTribe(ctx, t); err != nil {
			return fmt.Errorf("upsert seed tribe %q: %w", t.Slug, err)
		}
	}
	return nil
}
