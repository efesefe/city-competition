package i18n_test

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"

	"github.com/city-competition-remastered/backend/internal/i18n"
)

func TestLocative_ProvinceNames(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		// -de (front vowel, voiced / vowel-final)
		{"İzmir", "İzmir'de"},
		{"Eskişehir", "Eskişehir'de"},
		{"Rize", "Rize'de"},
		{"Artvin", "Artvin'de"},
		{"Çanakkale", "Çanakkale'de"},
		{"Mersin", "Mersin'de"},
		{"Denizli", "Denizli'de"},
		// -da (back vowel, voiced / vowel-final)
		{"Ankara", "Ankara'da"},
		{"İstanbul", "İstanbul'da"},
		{"Bursa", "Bursa'da"},
		{"Trabzon", "Trabzon'da"},
		{"Aydın", "Aydın'da"},
		{"Antalya", "Antalya'da"},
		{"Giresun", "Giresun'da"},
		{"Bolu", "Bolu'da"},
		{"Van", "Van'da"},
		{"Tekirdağ", "Tekirdağ'da"},
		// -ta (back vowel, voiceless final consonant)
		{"Kars", "Kars'ta"},
		{"Muş", "Muş'ta"},
		// -te (front vowel, voiceless final consonant)
		{"Bitlis", "Bitlis'te"},
		{"Siirt", "Siirt'te"},
	}

	for _, tc := range cases {
		got := i18n.Locative(tc.in)
		if got != tc.want {
			t.Errorf("Locative(%q)=%q want %q", tc.in, got, tc.want)
		}
	}
}

func TestLocative_ProperNounApostrophe(t *testing.T) {
	cases := []string{"İzmir", "Ankara", "Kars", "Bitlis"}
	for _, name := range cases {
		got := i18n.Locative(name)
		idx := strings.LastIndex(got, "'")
		if idx < 0 {
			t.Errorf("Locative(%q)=%q: missing apostrophe", name, got)
			continue
		}
		if got[:idx] != name {
			t.Errorf("Locative(%q)=%q: stem before apostrophe want %q", name, got, name)
		}
		suffix := got[idx+1:]
		switch suffix {
		case "de", "da", "te", "ta":
			// ok
		default:
			t.Errorf("Locative(%q)=%q: unexpected suffix %q after apostrophe", name, got, suffix)
		}
	}
}

func TestLocative_UnrecognizedFallback(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelWarn})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	cases := []string{"", "   ", "bcd", "xyz", "123"}
	for _, in := range cases {
		buf.Reset()
		got := i18n.Locative(in)
		if !strings.HasSuffix(got, "'da") {
			t.Errorf("Locative(%q)=%q: want suffix 'da", in, got)
		}
		logged := buf.String()
		if !strings.Contains(logged, "unclassifiable locative") {
			t.Errorf("Locative(%q): expected slog.Warn, got log %q", in, logged)
		}
	}
}
