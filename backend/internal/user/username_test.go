package user_test

import (
	"strings"
	"testing"

	"github.com/city-competition-remastered/backend/internal/user"
)

func TestFoldUsername_TurkishI(t *testing.T) {
	dotted := "İstanbul"
	lower := "istanbul"
	allCaps := "ISTANBUL"

	// Raw forms are distinct.
	if dotted == lower {
		t.Fatal("İstanbul and istanbul must be distinct as raw strings")
	}

	// Turkish fold: dotted İ → i
	if got := user.FoldUsername(dotted); got != "istanbul" {
		t.Fatalf("FoldUsername(%q) = %q, want istanbul", dotted, got)
	}
	if got := user.FoldUsername(lower); got != "istanbul" {
		t.Fatalf("FoldUsername(%q) = %q, want istanbul", lower, got)
	}

	// Turkish fold: undotted I → ı (not ASCII i) — no false duplicate with istanbul.
	foldedCaps := user.FoldUsername(allCaps)
	if foldedCaps != "ıstanbul" {
		t.Fatalf("FoldUsername(%q) = %q, want ıstanbul", allCaps, foldedCaps)
	}
	if foldedCaps == user.FoldUsername(lower) {
		t.Fatal("ISTANBUL must not falsely collide with istanbul under Turkish fold")
	}
}

func TestNaiveToLowerMishandlesTurkishI(t *testing.T) {
	// Document why strings.ToLower is forbidden on this path.
	naive := strings.ToLower("İstanbul")
	folded := user.FoldUsername("İstanbul")
	if naive == folded {
		// Depending on Go version, naive may still differ; assert path divergence intent.
		t.Logf("strings.ToLower(%q)=%q FoldUsername=%q", "İstanbul", naive, folded)
	}
	// ASCII ToLower maps I→i, which is wrong for Turkish (should be ı).
	if strings.ToLower("ISTANBUL") != "istanbul" {
		t.Fatal("sanity: English ToLower maps ISTANBUL→istanbul")
	}
	if user.FoldUsername("ISTANBUL") == "istanbul" {
		t.Fatal("Turkish fold must not map undotted I to dotted i")
	}
}

func TestValidateUsername(t *testing.T) {
	if _, err := user.ValidateUsername("ab"); err == nil {
		t.Fatal("expected too-short rejection")
	}
	if _, err := user.ValidateUsername("_abc"); err == nil {
		t.Fatal("expected leading underscore rejection")
	}
	ok, err := user.ValidateUsername("Oyuncu_01")
	if err != nil || ok != "Oyuncu_01" {
		t.Fatalf("ValidateUsername = %q, %v", ok, err)
	}
}
