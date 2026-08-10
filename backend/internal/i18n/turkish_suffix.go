package i18n

import (
	"log/slog"
	"strings"
	"unicode"
)

// Locative returns name with a proper-noun apostrophe and the vowel-harmony
// locative suffix (-de/-da/-te/-ta). Unclassifiable names get "'da" (most
// common surface form) plus slog.Warn; never panics.
func Locative(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		slog.Warn("i18n: unclassifiable locative", "name", name)
		return name + "'da"
	}

	lower := ToLower(trimmed)
	runes := []rune(lower)

	vowel, ok := lastVowel(runes)
	if !ok {
		slog.Warn("i18n: unclassifiable locative", "name", name)
		return trimmed + "'da"
	}

	front := isFrontVowel(vowel)
	voiceless := lastConsonantVoiceless(runes)

	var suffix string
	switch {
	case front && voiceless:
		suffix = "te"
	case front && !voiceless:
		suffix = "de"
	case !front && voiceless:
		suffix = "ta"
	default:
		suffix = "da"
	}

	return trimmed + "'" + suffix
}

func lastVowel(runes []rune) (rune, bool) {
	for i := len(runes) - 1; i >= 0; i-- {
		r := runes[i]
		if isTurkishVowel(r) {
			return r, true
		}
	}
	return 0, false
}

func isTurkishVowel(r rune) bool {
	switch r {
	case 'a', 'e', 'ı', 'i', 'o', 'ö', 'u', 'ü':
		return true
	default:
		return false
	}
}

func isFrontVowel(r rune) bool {
	switch r {
	case 'e', 'i', 'ö', 'ü':
		return true
	default:
		return false
	}
}

// lastConsonantVoiceless reports whether the stem's final letter is a voiceless
// consonant (triggers -t*). Stems ending in a vowel or voiced consonant use -d*.
func lastConsonantVoiceless(runes []rune) bool {
	if len(runes) == 0 {
		return false
	}
	r := runes[len(runes)-1]
	if isTurkishVowel(r) || !unicode.IsLetter(r) {
		return false
	}
	return isVoicelessConsonant(r)
}

func isVoicelessConsonant(r rune) bool {
	switch r {
	case 'p', 'ç', 't', 'k', 'f', 'h', 's', 'ş':
		return true
	default:
		return false
	}
}
