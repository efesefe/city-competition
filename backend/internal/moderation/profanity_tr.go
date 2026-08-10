package moderation

import (
	"bufio"
	"embed"
	"strings"
	"sync"
	"unicode"

	"github.com/city-competition-remastered/backend/internal/user"
)

//go:embed data/tr_wordlist.txt
var wordlistFS embed.FS

var (
	loadOnce sync.Once
	terms    []string
)

func loadTerms() {
	loadOnce.Do(func() {
		f, err := wordlistFS.Open("data/tr_wordlist.txt")
		if err != nil {
			return
		}
		defer f.Close()
		sc := bufio.NewScanner(f)
		seen := make(map[string]struct{})
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			n := NormalizeForMatch(line)
			if n == "" {
				continue
			}
			if _, ok := seen[n]; ok {
				continue
			}
			seen[n] = struct{}{}
			terms = append(terms, n)
		}
	})
}

// leetMap maps common leetspeak / obfuscation runes to letters before Turkish fold.
var leetMap = map[rune]rune{
	'0': 'o',
	'1': 'i',
	'3': 'e',
	'4': 'a',
	'5': 's',
	'7': 't',
	'8': 'b',
	'@': 'a',
	'$': 's',
	'!': 'i',
}

// NormalizeForMatch applies leetspeak substitution then Turkish-aware case fold.
// Spaces and punctuation are stripped so obfuscations like "o r o s p u" still match.
func NormalizeForMatch(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if mapped, ok := leetMap[r]; ok {
			r = mapped
		}
		if unicode.IsSpace(r) || unicode.IsPunct(r) {
			continue
		}
		b.WriteRune(r)
	}
	return user.FoldUsername(b.String())
}

func normalizedTokens(s string) []string {
	var out []string
	var cur strings.Builder
	flush := func() {
		if cur.Len() == 0 {
			return
		}
		n := NormalizeForMatch(cur.String())
		cur.Reset()
		if n != "" {
			out = append(out, n)
		}
	}
	for _, r := range s {
		if unicode.IsSpace(r) || unicode.IsPunct(r) {
			flush()
			continue
		}
		cur.WriteRune(r)
	}
	flush()
	return out
}

// ContainsProfanity reports whether s matches any term in the Turkish wordlist
// after NormalizeForMatch. Terms of length <= 2 require an exact token match;
// longer terms also match as substrings of the fully stripped normalized text.
func ContainsProfanity(s string) bool {
	loadTerms()
	full := NormalizeForMatch(s)
	if full == "" {
		return false
	}
	tokens := normalizedTokens(s)
	tokenSet := make(map[string]struct{}, len(tokens))
	for _, tok := range tokens {
		tokenSet[tok] = struct{}{}
	}
	for _, term := range terms {
		if term == "" {
			continue
		}
		runes := []rune(term)
		if len(runes) <= 2 {
			if _, ok := tokenSet[term]; ok {
				return true
			}
			// Obfuscation that strips to exactly the short term (e.g. "a.q" → "aq").
			if full == term {
				return true
			}
			continue
		}
		if strings.Contains(full, term) {
			return true
		}
	}
	return false
}
