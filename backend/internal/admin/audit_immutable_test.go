package admin_test

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

var (
	auditUpdateRe = regexp.MustCompile(`(?i)UPDATE\s+audit_log\b`)
	auditDeleteRe = regexp.MustCompile(`(?i)DELETE\s+FROM\s+audit_log\b`)
	auditRouteRe  = regexp.MustCompile(`(?i)(PUT|PATCH|DELETE)\s+/v1/admin/[^\s"]*audit`)
)

func TestAuditLogImmutable_NoMutatingSQLOrRoutes(t *testing.T) {
	root := filepath.Join("..", "..")
	var offenders []string

	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			base := d.Name()
			if base == "vendor" || base == ".git" || base == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		// Allow this test file and cleanup DELETEs in integration tests (test-only).
		base := filepath.Base(path)
		if strings.HasSuffix(base, "_test.go") {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		content := string(raw)
		rel, _ := filepath.Rel(root, path)
		if auditUpdateRe.MatchString(content) {
			offenders = append(offenders, rel+": UPDATE audit_log")
		}
		if auditDeleteRe.MatchString(content) {
			offenders = append(offenders, rel+": DELETE FROM audit_log")
		}
		if auditRouteRe.MatchString(content) {
			offenders = append(offenders, rel+": mutating audit route")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	if len(offenders) > 0 {
		t.Fatalf("audit_log must be append-only; found:\n%s", strings.Join(offenders, "\n"))
	}
}
