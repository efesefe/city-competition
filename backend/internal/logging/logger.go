package logging

import (
	"context"
	"log/slog"
	"os"
)

type ctxKey struct{}

// New creates a slog logger: JSON in production, text otherwise.
func New(production bool) *slog.Logger {
	var handler slog.Handler
	opts := &slog.HandlerOptions{Level: slog.LevelInfo}
	if production {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		handler = slog.NewTextHandler(os.Stdout, opts)
	}
	return slog.New(handler)
}

// WithRequestID returns a child context carrying requestID for log enrichment.
func WithRequestID(ctx context.Context, requestID string) context.Context {
	return context.WithValue(ctx, ctxKey{}, requestID)
}

// RequestIDFromContext extracts the request ID, if present.
func RequestIDFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(ctxKey{}).(string)
	return v, ok
}

// FromContext returns a logger with request_id attr when available.
func FromContext(ctx context.Context, base *slog.Logger) *slog.Logger {
	if id, ok := RequestIDFromContext(ctx); ok {
		return base.With(slog.String("request_id", id))
	}
	return base
}
