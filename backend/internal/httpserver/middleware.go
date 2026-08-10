package httpserver

import (
	"net/http"

	"github.com/city-competition-remastered/backend/internal/logging"
	"github.com/google/uuid"
)

const requestIDHeader = "X-Request-ID"

// RequestID injects a UUID request ID into the context and response headers.
// Access logging and latency metrics are handled by observability.Middleware.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(requestIDHeader)
		if id == "" {
			id = uuid.NewString()
		}
		w.Header().Set(requestIDHeader, id)
		ctx := logging.WithRequestID(r.Context(), id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
