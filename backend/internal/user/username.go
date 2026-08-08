package user

import (
	"errors"
	"unicode"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

// ErrInvalidUsername is returned when a username fails validation rules.
var ErrInvalidUsername = errors.New("error_invalid_username")

// turkishFold is a Turkish-aware caser.
// Note: cases.Fold() is language-independent and cannot take a tr tag;
// Lower(language.Turkish) is the correct Turkish-aware fold for İ/ı.
var turkishFold = cases.Lower(language.Turkish)

// FoldUsername applies Turkish-aware case folding. Do not use strings.ToLower/ToUpper.
func FoldUsername(s string) string {
	return turkishFold.String(s)
}

// ValidateUsername checks length/charset and returns the original username if valid.
// Uniqueness comparisons should use FoldUsername (and DB ICU collation).
func ValidateUsername(raw string) (string, error) {
	if len([]rune(raw)) < 3 || len([]rune(raw)) > 24 {
		return "", ErrInvalidUsername
	}
	runes := []rune(raw)
	if runes[0] == '_' || runes[len(runes)-1] == '_' {
		return "", ErrInvalidUsername
	}
	for _, r := range runes {
		if r == '_' || unicode.IsDigit(r) {
			continue
		}
		if unicode.IsLetter(r) {
			continue
		}
		return "", ErrInvalidUsername
	}
	return raw, nil
}
