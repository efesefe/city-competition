package middleware

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/ratelimit"
)

type errorBody struct {
	Error string `json:"error"`
}

// RateLimit returns middleware that enforces a per-user token bucket for routeGroup.
// Stack inside auth.RequireSession so the user id is present.
func RateLimit(logger *slog.Logger, bucket *ratelimit.Bucket, routeGroup string, lim ratelimit.Limit) func(http.Handler) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, ok := auth.UserIDFromContext(r.Context())
			if !ok {
				writeJSON(w, http.StatusUnauthorized, errorBody{Error: auth.ErrUnauthorized.Error()})
				return
			}

			res, err := bucket.Allow(r.Context(), userID.String(), routeGroup, lim)
			if err != nil {
				logger.Error("rate limit check failed", "error", err, "user_id", userID.String(), "route_group", routeGroup)
				writeJSON(w, http.StatusServiceUnavailable, errorBody{Error: "error_internal"})
				return
			}
			if !res.Allowed {
				logger.Warn("rate limit exceeded", "user_id", userID.String(), "route_group", routeGroup)
				sec := int(res.RetryAfter.Seconds())
				if sec < 1 {
					sec = 1
				}
				w.Header().Set("Retry-After", strconv.Itoa(sec))
				writeJSON(w, http.StatusTooManyRequests, errorBody{Error: "rate_limit_exceeded"})
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
