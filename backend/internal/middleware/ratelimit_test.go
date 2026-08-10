package middleware_test

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/middleware"
	"github.com/city-competition-remastered/backend/internal/ratelimit"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestRateLimit_Returns429WithRetryAfter(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	sessions := &auth.SessionService{RDB: rdb}
	userID := uuid.New()
	token, err := sessions.Create(t.Context(), userID)
	if err != nil {
		t.Fatal(err)
	}

	bucket := &ratelimit.Bucket{RDB: rdb}
	lim := ratelimit.Limit{Rate: 1, Burst: 2}
	okHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	h := auth.RequireSession(sessions, middleware.RateLimit(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		bucket,
		ratelimit.GroupCreditWrite,
		lim,
	)(okHandler))

	doReq := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/credits/stub-grant", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	for i := 0; i < 2; i++ {
		rec := doReq()
		if rec.Code != http.StatusNoContent {
			t.Fatalf("request %d: status %d, body %s", i+1, rec.Code, rec.Body.String())
		}
	}

	rec := doReq()
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d body %s", rec.Code, rec.Body.String())
	}

	retryAfter := rec.Header().Get("Retry-After")
	if retryAfter == "" {
		t.Fatal("missing Retry-After header")
	}
	sec, err := strconv.Atoi(retryAfter)
	if err != nil || sec < 1 {
		t.Fatalf("invalid Retry-After %q: %v", retryAfter, err)
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["error"] != "rate_limit_exceeded" {
		t.Fatalf("error body: %#v", body)
	}
}
