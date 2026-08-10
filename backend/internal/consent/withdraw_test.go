package consent_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/consent"
)

type stubConsentStore struct {
	version string
}

func (s stubConsentStore) PublishedVersions(context.Context) ([]consent.PublishedVersion, error) {
	return nil, nil
}
func (s stubConsentStore) PublishedVersion(ctx context.Context, t consent.ConsentType) (consent.PublishedVersion, error) {
	return consent.PublishedVersion{ConsentType: t, Version: s.version, BodyText: "x"}, nil
}
func (s stubConsentStore) LatestEvents(context.Context, uuid.UUID) (map[consent.ConsentType]*consent.Event, error) {
	return nil, nil
}
func (s stubConsentStore) InsertEvent(context.Context, consent.InsertEvent) error { return nil }
func (s stubConsentStore) CountEvents(context.Context, uuid.UUID, consent.ConsentType) (int, error) {
	return 0, nil
}

func TestWithdraw_SetsLocationTrackingDisabledSynchronously(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})

	userID := uuid.New()
	h := &consent.Handler{
		Store: stubConsentStore{version: "v1"},
		RDB:   rdb,
	}
	body := `{"consent_type":"acik_riza_location","consent_version":"v1"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/consent/withdraw", strings.NewReader(body))
	req = req.WithContext(auth.ContextWithUserID(req.Context(), userID))
	rr := httptest.NewRecorder()
	h.Withdraw(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	disabled, err := consent.IsLocationTrackingDisabled(context.Background(), rdb, userID)
	if err != nil || !disabled {
		t.Fatalf("disabled=%v err=%v", disabled, err)
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp["granted"] != false {
		t.Fatalf("resp=%v", resp)
	}
}
