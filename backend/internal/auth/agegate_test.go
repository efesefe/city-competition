package auth_test

import (
	"testing"
	"time"

	"github.com/city-competition-remastered/backend/internal/auth"
)

func TestIsRestrictedAge_Under18(t *testing.T) {
	istanbul, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 8, 12, 0, 0, 0, istanbul)
	// Under 18: born 2008-08-09 → age 17 on 2026-08-08
	birth := time.Date(2008, 8, 9, 0, 0, 0, 0, istanbul)
	if !auth.IsRestrictedAge(birth, now) {
		t.Fatal("expected restricted for under-18")
	}
}

func TestIsRestrictedAge_Exactly18(t *testing.T) {
	istanbul, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 8, 12, 0, 0, 0, istanbul)
	birth := time.Date(2008, 8, 8, 0, 0, 0, 0, istanbul)
	if auth.IsRestrictedAge(birth, now) {
		t.Fatal("expected not restricted on 18th birthday")
	}
}

func TestIsRestrictedAge_DayBefore18(t *testing.T) {
	istanbul, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 7, 12, 0, 0, 0, istanbul)
	birth := time.Date(2008, 8, 8, 0, 0, 0, 0, istanbul)
	if !auth.IsRestrictedAge(birth, now) {
		t.Fatal("expected restricted day before 18th birthday")
	}
}

func TestIsRestrictedAge_Adult(t *testing.T) {
	istanbul, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 8, 12, 0, 0, 0, istanbul)
	birth := time.Date(1990, 1, 1, 0, 0, 0, 0, istanbul)
	if auth.IsRestrictedAge(birth, now) {
		t.Fatal("expected adult not restricted")
	}
}

func TestParseBirthDate(t *testing.T) {
	_, err := auth.ParseBirthDate("")
	if err != auth.ErrInvalidBirthDate {
		t.Fatalf("empty: got %v", err)
	}
	_, err = auth.ParseBirthDate("not-a-date")
	if err != auth.ErrInvalidBirthDate {
		t.Fatalf("bad: got %v", err)
	}
	d, err := auth.ParseBirthDate("2000-05-15")
	if err != nil {
		t.Fatal(err)
	}
	if d.Year() != 2000 || d.Month() != 5 || d.Day() != 15 {
		t.Fatalf("parsed %v", d)
	}
}

func TestRestrictedModeFromBirthDate_Under18SetsTrue(t *testing.T) {
	// Deterministic via IsRestrictedAge; also ensure RestrictedModeFromBirthDate agrees for a clearly under-18 DOB.
	under := time.Now().AddDate(-10, 0, 0)
	if !auth.IsRestrictedAge(under, time.Now()) {
		t.Fatal("expected under-18")
	}
	if !auth.RestrictedModeFromBirthDate(under) {
		t.Fatal("expected restricted_mode=true for under-18 birth date")
	}
	adult := time.Now().AddDate(-25, 0, 0)
	if auth.RestrictedModeFromBirthDate(adult) {
		t.Fatal("expected restricted_mode=false for adult")
	}
}
