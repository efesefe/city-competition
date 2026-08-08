package httpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/city-competition-remastered/backend/internal/cache"
	"github.com/city-competition-remastered/backend/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type healthResponse struct {
	Status  string   `json:"status"`
	Reasons []string `json:"reasons,omitempty"`
}

// Health returns a handler that verifies DB and Redis connectivity.
// Returns 503 with explicit reasons when either dependency fails — never a silent 200.
func Health(pool *pgxpool.Pool, rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		var reasons []string

		if err := db.Ping(ctx, pool); err != nil {
			reasons = append(reasons, "database: "+err.Error())
		}
		if err := cache.Ping(ctx, rdb); err != nil {
			reasons = append(reasons, "redis: "+err.Error())
		}

		w.Header().Set("Content-Type", "application/json")
		if len(reasons) > 0 {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(healthResponse{
				Status:  "unavailable",
				Reasons: reasons,
			})
			return
		}

		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(healthResponse{Status: "ok"})
	}
}
