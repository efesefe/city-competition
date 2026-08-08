// Package i18n reserves golang.org/x/text for Turkish casing (İ/ı, etc.).
// Prefer cases.Caser with language.Turkish over strings.ToLower/ToUpper.
package i18n

import (
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

var turkishLower = cases.Lower(language.Turkish)

// ToLower applies Turkish-aware lowercasing (placeholder for later username work).
func ToLower(s string) string {
	return turkishLower.String(s)
}
