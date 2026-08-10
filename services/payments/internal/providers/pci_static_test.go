package providers_test

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

var forbidden = regexp.MustCompile(`(?i)\b(pan|cvv|card_number|cardNumber|cvc)\b`)

func TestNoPANOrCVVInPaymentsSources(t *testing.T) {
	root := filepath.Join("..", "..")
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			base := info.Name()
			if base == ".git" || base == "vendor" {
				return filepath.SkipDir
			}
			return nil
		}
		ext := filepath.Ext(path)
		switch ext {
		case ".go", ".sql", ".md":
		default:
			return nil
		}
		// Allow this test file to mention the forbidden tokens.
		if strings.HasSuffix(path, "pci_static_test.go") || strings.HasSuffix(path, "signature_test.go") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if forbidden.Find(data) != nil {
			t.Errorf("forbidden PAN/CVV-like token in %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
