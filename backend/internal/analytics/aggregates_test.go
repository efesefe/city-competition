package analytics

import (
	"strings"
	"testing"
	"unicode"
)

func TestDashboardQueriesHaveNoPII(t *testing.T) {
	forbiddenColumns := []string{
		"user_id",
		"actor_id",
		"phone",
		"ip_address",
		"user_agent",
		"username",
		"birth_date",
	}
	forbiddenTables := []string{
		"supports",
		"consent_events",
		"users",
		"activity_events",
	}

	for _, q := range DashboardQueries() {
		normalized := normalizeSQL(q)
		for _, col := range forbiddenColumns {
			if strings.Contains(normalized, col) {
				t.Fatalf("dashboard SQL must not reference %q:\n%s", col, q)
			}
		}
		for _, table := range forbiddenTables {
			// Word-boundary-ish: table name as identifier token.
			if containsIdent(normalized, table) {
				t.Fatalf("dashboard SQL must not scan raw table %q:\n%s", table, q)
			}
		}
	}
}

func normalizeSQL(q string) string {
	var b strings.Builder
	prevSpace := false
	for _, r := range strings.ToLower(q) {
		if unicode.IsSpace(r) {
			if !prevSpace {
				b.WriteByte(' ')
				prevSpace = true
			}
			continue
		}
		prevSpace = false
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}

func containsIdent(sql, ident string) bool {
	ident = strings.ToLower(ident)
	start := 0
	for {
		i := strings.Index(sql[start:], ident)
		if i < 0 {
			return false
		}
		i += start
		beforeOK := i == 0 || !isIdentChar(rune(sql[i-1]))
		after := i + len(ident)
		afterOK := after >= len(sql) || !isIdentChar(rune(sql[after]))
		if beforeOK && afterOK {
			return true
		}
		start = i + 1
	}
}

func isIdentChar(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_'
}
