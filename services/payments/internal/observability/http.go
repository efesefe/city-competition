package observability

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/city-competition-remastered/payments/internal/logging"
)

const ServicePayments = "payments"

const requestIDHeader = "X-Request-ID"

// Metrics holds Prometheus collectors.
type Metrics struct {
	Service      string
	HTTPDuration *prometheus.HistogramVec
	HTTPRequests *prometheus.CounterVec
	PGAcquired   prometheus.Gauge
	PGIdle       prometheus.Gauge
	PGMax        prometheus.Gauge
}

// NewMetrics registers collectors for the payments service.
func NewMetrics() *Metrics {
	return &Metrics{
		Service: ServicePayments,
		HTTPDuration: promauto.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "HTTP request latency by route group",
			Buckets: prometheus.DefBuckets,
		}, []string{"service", "route_group", "method", "code"}),
		HTTPRequests: promauto.NewCounterVec(prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total HTTP requests",
		}, []string{"service", "route_group", "method", "code"}),
		PGAcquired: promauto.NewGauge(prometheus.GaugeOpts{
			Name:        "pgx_pool_acquired",
			Help:        "Acquired Postgres connections",
			ConstLabels: prometheus.Labels{"service": ServicePayments, "pool": "write"},
		}),
		PGIdle: promauto.NewGauge(prometheus.GaugeOpts{
			Name:        "pgx_pool_idle",
			Help:        "Idle Postgres connections",
			ConstLabels: prometheus.Labels{"service": ServicePayments, "pool": "write"},
		}),
		PGMax: promauto.NewGauge(prometheus.GaugeOpts{
			Name:        "pgx_pool_max",
			Help:        "Max Postgres connections",
			ConstLabels: prometheus.Labels{"service": ServicePayments, "pool": "write"},
		}),
	}
}

// CollectPG updates pool gauges.
func (m *Metrics) CollectPG(pool *pgxpool.Pool) {
	if m == nil || pool == nil {
		return
	}
	stat := pool.Stat()
	m.PGAcquired.Set(float64(stat.AcquiredConns()))
	m.PGIdle.Set(float64(stat.IdleConns()))
	m.PGMax.Set(float64(stat.MaxConns()))
}

// StartPoolCollector refreshes pool gauges until ctx done.
func (m *Metrics) StartPoolCollector(ctx context.Context, pool *pgxpool.Pool) {
	if m == nil {
		return
	}
	go func() {
		t := time.NewTicker(15 * time.Second)
		defer t.Stop()
		m.CollectPG(pool)
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				m.CollectPG(pool)
			}
		}
	}()
}

type statusRecorder struct {
	http.ResponseWriter
	code int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.code = code
	r.ResponseWriter.WriteHeader(code)
}

// Middleware injects request_id, records metrics, and logs access lines.
func Middleware(base *slog.Logger, m *Metrics) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := r.Header.Get(requestIDHeader)
			if id == "" {
				id = uuid.NewString()
			}
			w.Header().Set(requestIDHeader, id)
			ctx := logging.WithRequestID(r.Context(), id)

			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, code: http.StatusOK}
			next.ServeHTTP(rec, r.WithContext(ctx))

			group := routeGroup(r.URL.Path)
			code := strconv.Itoa(rec.code)
			elapsed := time.Since(start).Seconds()
			if m != nil {
				m.HTTPDuration.WithLabelValues(m.Service, group, r.Method, code).Observe(elapsed)
				m.HTTPRequests.WithLabelValues(m.Service, group, r.Method, code).Inc()
			}
			logging.FromContext(ctx, base).Info("request",
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.String("route_group", group),
				slog.Int("status", rec.code),
				slog.Float64("duration_seconds", elapsed),
			)
		})
	}
}

func routeGroup(path string) string {
	switch {
	case path == "/healthz" || path == "/metrics":
		return "system"
	case strings.HasPrefix(path, "/v1/charges"), strings.HasPrefix(path, "/v1/refunds"),
		strings.HasPrefix(path, "/v1/webhooks"):
		return "payments"
	default:
		return "other"
	}
}

// MetricsHandler returns Prometheus scrape handler.
func MetricsHandler() http.Handler {
	return promhttp.Handler()
}
