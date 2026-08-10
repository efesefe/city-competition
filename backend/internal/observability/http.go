package observability

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/city-competition-remastered/backend/internal/logging"
)

// statusRecorder captures the response status code.
type statusRecorder struct {
	http.ResponseWriter
	code int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.code = code
	r.ResponseWriter.WriteHeader(code)
}

// Middleware records latency/error metrics and emits a structured access log.
func Middleware(base *slog.Logger, m *Metrics) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, code: http.StatusOK}
			next.ServeHTTP(rec, r)

			group := RouteGroup(r.URL.Path)
			code := strconv.Itoa(rec.code)
			elapsed := time.Since(start).Seconds()

			if m != nil {
				m.HTTPDuration.WithLabelValues(m.Service, group, r.Method, code).Observe(elapsed)
				m.HTTPRequests.WithLabelValues(m.Service, group, r.Method, code).Inc()
			}

			log := logging.FromContext(r.Context(), base)
			log.Info("request",
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.String("route_group", group),
				slog.Int("status", rec.code),
				slog.Float64("duration_seconds", elapsed),
			)
		})
	}
}

// RouteGroup maps a URL path to a coarse dashboard grouping label.
func RouteGroup(path string) string {
	path = strings.TrimSuffix(path, "/")
	if path == "" {
		path = "/"
	}
	switch {
	case path == "/healthz" || path == "/metrics":
		return "system"
	case path == "/v1/system/status":
		return "system"
	case strings.HasPrefix(path, "/v1/auth"):
		return "auth"
	case strings.HasPrefix(path, "/v1/consent"):
		return "consent"
	case strings.HasPrefix(path, "/v1/account"):
		return "account"
	case strings.HasPrefix(path, "/v1/credits"):
		return "credits"
	case strings.HasPrefix(path, "/v1/support"):
		return "support"
	case strings.HasPrefix(path, "/v1/admin"):
		return "admin"
	case strings.HasPrefix(path, "/v1/derbies"):
		return "derbies"
	case strings.HasPrefix(path, "/v1/leaderboards"):
		return "leaderboards"
	case strings.HasPrefix(path, "/v1/tribes") || strings.HasPrefix(path, "/v1/clan"):
		return "tribes"
	case strings.HasPrefix(path, "/v1/provinces"):
		return "provinces"
	case strings.HasPrefix(path, "/v1/payments") || strings.HasPrefix(path, "/internal/payments"):
		return "payments"
	case strings.HasPrefix(path, "/v1/analytics"):
		return "analytics"
	case strings.HasPrefix(path, "/v1/moderation") || strings.HasPrefix(path, "/v1/appeals"):
		return "moderation"
	case strings.HasPrefix(path, "/v1/dms") || strings.HasPrefix(path, "/v1/friends") ||
		strings.HasPrefix(path, "/v1/blocks") || strings.HasPrefix(path, "/v1/mutes") ||
		strings.HasPrefix(path, "/v1/reports") || strings.HasPrefix(path, "/v1/feed") ||
		strings.HasPrefix(path, "/v1/referrals") || strings.HasPrefix(path, "/v1/me/referral"):
		return "social"
	case strings.HasPrefix(path, "/v1/ws"):
		return "realtime"
	case strings.HasPrefix(path, "/v1/charges") || strings.HasPrefix(path, "/v1/refunds") ||
		strings.HasPrefix(path, "/v1/webhooks"):
		return "payments"
	default:
		if strings.HasPrefix(path, "/v1/") {
			return "other_v1"
		}
		return "other"
	}
}
