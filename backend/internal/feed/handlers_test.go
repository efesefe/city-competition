package feed_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/city-competition-remastered/backend/internal/feed"
)

func TestList_Unauthorized(t *testing.T) {
	h := &feed.Handler{Store: &feed.PostgresStore{}}
	req := httptest.NewRequest(http.MethodGet, "/v1/feed", nil)
	rr := httptest.NewRecorder()
	h.List(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
}
