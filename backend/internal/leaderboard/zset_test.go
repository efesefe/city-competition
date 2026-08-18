package leaderboard

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func mustRequest(t *testing.T, rawURL string) *http.Request {
	t.Helper()
	return httptest.NewRequest(http.MethodGet, rawURL, nil)
}

func TestScopeKeys(t *testing.T) {
	tribeID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	derbyID := uuid.MustParse("22222222-2222-2222-2222-222222222222")

	if got := GlobalKey(); got != "lb:global:supporters" {
		t.Fatalf("global=%q", got)
	}
	if got := TribeKey(tribeID); got != "lb:tribe:11111111-1111-1111-1111-111111111111:supporters" {
		t.Fatalf("tribe=%q", got)
	}
	if got := ProvinceKey("34"); got != "lb:province:34:supporters" {
		t.Fatalf("province=%q", got)
	}
	if got := DerbyKey(derbyID); got != "lb:derby:22222222-2222-2222-2222-222222222222:supporters" {
		t.Fatalf("derby=%q", got)
	}
	if got := TribeRankKey(); got != "lb:tribe_rank:supporters" {
		t.Fatalf("tribe rank=%q", got)
	}
}

func TestPublicVisible(t *testing.T) {
	if !PublicVisible(UserProfile{RestrictedMode: false, Status: "active"}) {
		t.Fatal("expected non-restricted visible")
	}
	if PublicVisible(UserProfile{RestrictedMode: true, Status: "active"}) {
		t.Fatal("expected restricted hidden")
	}
	if PublicVisible(UserProfile{RestrictedMode: false, Status: "shadow_banned"}) {
		t.Fatal("expected shadow_banned hidden")
	}
	if PublicVisible(UserProfile{RestrictedMode: false, Status: "banned"}) {
		t.Fatal("expected banned hidden")
	}
}

func TestResolveScopeKey(t *testing.T) {
	r := mustRequest(t, "/v1/leaderboards/me?scope=global")
	key, err := resolveScopeKey(r)
	if err != nil || key != GlobalKey() {
		t.Fatalf("global key=%q err=%v", key, err)
	}

	tribeID := uuid.New()
	r = mustRequest(t, "/v1/leaderboards/me?scope=tribe&id="+tribeID.String())
	key, err = resolveScopeKey(r)
	if err != nil || key != TribeKey(tribeID) {
		t.Fatalf("tribe key=%q err=%v", key, err)
	}

	r = mustRequest(t, "/v1/leaderboards/me?scope=province&id=34")
	key, err = resolveScopeKey(r)
	if err != nil || key != ProvinceKey("34") {
		t.Fatalf("province key=%q err=%v", key, err)
	}

	r = mustRequest(t, "/v1/leaderboards/me?scope=nope")
	if _, err := resolveScopeKey(r); err == nil {
		t.Fatal("expected invalid_scope")
	}
}
