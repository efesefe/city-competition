package logging

import (
	"context"
	"log/slog"
	"os"
)

type ctxKey struct{}

// New creates a slog logger with service attr (JSON always for payments).
func New(service string) *slog.Logger {
	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	return slog.New(handler).With(slog.String("service", service))
}

// WithRequestID returns a child context carrying requestID.
func WithRequestID(ctx context.Context, requestID string) context.Context {
	return context.WithValue(ctx, ctxKey{}, requestID)
}

// RequestIDFromContext extracts the request ID, if present.
func RequestIDFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(ctxKey{}).(string)
	return v, ok
}

// FromContext returns a logger with request_id when available.
func FromContext(ctx context.Context, base *slog.Logger) *slog.Logger {
	if id, ok := RequestIDFromContext(ctx); ok {
		return base.With(slog.String("request_id", id))
	}
	return base
}
