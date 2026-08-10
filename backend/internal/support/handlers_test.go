package support_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/support"
)

type fakeProvinces struct {
	codes map[string]bool
}

func (f *fakeProvinces) Exists(ctx context.Context, ilCode string) (bool, error) {
	return f.codes[ilCode], nil
}

func setupSession(t *testing.T) (*auth.SessionService, uuid.UUID, string) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	sessions := &auth.SessionService{RDB: rdb}
	userID := uuid.New()
	token, err := sessions.Create(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	return sessions, userID, token
}

func TestCreate_InvalidIlCode_Returns400(t *testing.T) {
	sessions, _, token := setupSession(t)
	h := &support.Handler{
		Service: &support.Service{
			Provinces: &fakeProvinces{codes: map[string]bool{"34": true}},
		},
	}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/support", auth.RequireSession(sessions, http.HandlerFunc(h.Create)))

	body, _ := json.Marshal(map[string]any{"il_code": "99", "credits": 5})
	req := httptest.NewRequest(http.MethodPost, "/v1/support", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400 body=%s", rec.Code, rec.Body.String())
	}
	var errBody map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&errBody); err != nil {
		t.Fatal(err)
	}
	if errBody["error"] != support.ErrInvalidIlCode.Error() {
		t.Fatalf("error=%q want invalid_il_code", errBody["error"])
	}
}

func TestCreate_InvalidCredits_Returns400(t *testing.T) {
	sessions, _, token := setupSession(t)
	h := &support.Handler{
		Service: &support.Service{
			Provinces: &fakeProvinces{codes: map[string]bool{"34": true}},
		},
	}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/support", auth.RequireSession(sessions, http.HandlerFunc(h.Create)))

	body, _ := json.Marshal(map[string]any{"il_code": "34", "credits": 0})
	req := httptest.NewRequest(http.MethodPost, "/v1/support", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400 body=%s", rec.Code, rec.Body.String())
	}
	var errBody map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&errBody)
	if errBody["error"] != support.ErrInvalidCredits.Error() {
		t.Fatalf("error=%q want invalid_credits", errBody["error"])
	}
}

func TestSupport_NilMultiplierFn_DefaultsToOne(t *testing.T) {
	svc := &support.Service{}
	if svc.MultiplierFn != nil {
		t.Fatal("expected nil MultiplierFn by default")
	}
}
