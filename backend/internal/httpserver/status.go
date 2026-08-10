package httpserver

import (
	"encoding/json"
	"net/http"

	"github.com/city-competition-remastered/backend/internal/db"
)

type systemStatusResponse struct {
	WritePath      string `json:"write_path"`
	CircuitBreaker string `json:"circuit_breaker"`
}

// SystemStatus reports write-path circuit breaker state for a frontend read-only banner.
// Always returns 200 so clients can render degradation without treating status as down.
func SystemStatus(breaker *db.CircuitBreaker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		state := db.StateClosed
		if breaker != nil {
			state = breaker.State()
		}
		writePath := "ok"
		if state == db.StateOpen {
			writePath = "degraded"
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(systemStatusResponse{
			WritePath:      writePath,
			CircuitBreaker: string(state),
		})
	}
}
