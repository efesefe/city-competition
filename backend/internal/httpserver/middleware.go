package httpserver

import (
	"log/slog"
	"net/http"

	"github.com/city-competition-remastered/backend/internal/logging"
	"github.com/google/uuid"
)

const requestIDHeader = "X-Request-ID"

// RequestID injects a UUID request ID into the context and response headers,
// and ensures every log line from the request logger includes request_id.
func RequestID(base *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := r.Header.Get(requestIDHeader)
			if id == "" {
				id = uuid.NewString()
			}
			w.Header().Set(requestIDHeader, id)

			ctx := logging.WithRequestID(r.Context(), id)
			logger := logging.FromContext(ctx, base)
			logger.Info("request",
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
			)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
