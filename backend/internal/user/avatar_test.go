package user_test

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/user"
)

// 1x1 transparent PNG.
var png1x1 = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
	0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
	0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
	0x42, 0x60, 0x82,
}

func TestResolveAvatarURL_NeverNull(t *testing.T) {
	id := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	got := user.ResolveAvatarURL(id, nil)
	want := user.CanonicalAvatarURL(id)
	if got != want {
		t.Fatalf("nil stored: %q want %q", got, want)
	}
	empty := ""
	if user.ResolveAvatarURL(id, &empty) != want {
		t.Fatal("empty stored should fall back")
	}
	stored := "https://cdn.example/a.png"
	if user.ResolveAvatarURL(id, &stored) != stored {
		t.Fatalf("stored url not used: %q", user.ResolveAvatarURL(id, &stored))
	}
}

func TestCanonicalAvatarURL_Deterministic(t *testing.T) {
	id := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	a := user.CanonicalAvatarURL(id)
	b := user.CanonicalAvatarURL(id)
	if a != b {
		t.Fatalf("not deterministic: %q vs %q", a, b)
	}
	if !strings.Contains(a, id.String()) {
		t.Fatalf("url %q missing user id", a)
	}
}

func TestInitials_TurkishUpper(t *testing.T) {
	if got := user.Initials("istanbul"); got != "İS" {
		t.Fatalf("Initials(istanbul)=%q want İS", got)
	}
	if got := user.Initials("a"); got != "A" {
		t.Fatalf("Initials(a)=%q want A", got)
	}
}

func TestGenerateSVG_DeterministicColor(t *testing.T) {
	id := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	a := string(user.GenerateSVG(id, "ab"))
	b := string(user.GenerateSVG(id, "ab"))
	if a != b {
		t.Fatal("svg not deterministic")
	}
	if !strings.Contains(a, "AB") {
		t.Fatalf("svg missing initials: %s", a)
	}
	hue := user.HueFromUserID(id)
	if hue < 0 || hue >= 360 {
		t.Fatalf("hue=%d", hue)
	}
	other := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	if user.HueFromUserID(id) == user.HueFromUserID(other) {
		t.Fatal("expected distinct hues for distinct ids")
	}
}

func TestValidateAvatarBytes(t *testing.T) {
	if err := user.ValidateAvatarBytes(png1x1); err != nil {
		t.Fatalf("valid png: %v", err)
	}
	if err := user.ValidateAvatarBytes([]byte("hello")); err == nil {
		t.Fatal("plain text accepted")
	}
	tooBig := bytes.Repeat([]byte("x"), user.MaxAvatarBytes+1)
	if err := user.ValidateAvatarBytes(tooBig); err == nil {
		t.Fatal("oversized accepted")
	}
	if err := user.ValidateAvatarBytes(nil); err == nil {
		t.Fatal("empty accepted")
	}
}

func TestPostAvatar_RejectsInvalidWithoutAuthPool(t *testing.T) {
	h := &user.Handler{}
	body := &bytes.Buffer{}
	w := multipart.NewWriter(body)
	fw, err := w.CreateFormFile("avatar", "x.txt")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = fw.Write([]byte("not an image"))
	_ = w.Close()

	req := httptest.NewRequest(http.MethodPost, "/v1/me/avatar", body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	rec := httptest.NewRecorder()
	h.PostAvatar(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no session status=%d want 401", rec.Code)
	}
}
