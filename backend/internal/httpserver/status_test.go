package httpserver_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/city-competition-remastered/backend/internal/db"
	"github.com/city-competition-remastered/backend/internal/httpserver"
)

func TestSystemStatus_ReportsBreakerState(t *testing.T) {
	cb := db.NewCircuitBreaker(1, time.Minute)
	h := httpserver.SystemStatus(cb)

	req := httptest.NewRequest(http.MethodGet, "/v1/system/status", nil)
	rec := httptest.NewRecorder()
	h(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200", rec.Code)
	}
	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["write_path"] != "ok" || body["circuit_breaker"] != "closed" {
		t.Fatalf("body=%v", body)
	}

	cb.RecordFailure()
	rec = httptest.NewRecorder()
	h(rec, req)
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["write_path"] != "degraded" || body["circuit_breaker"] != "open" {
		t.Fatalf("open body=%v", body)
	}
}
