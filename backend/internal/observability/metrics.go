package observability

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/redis/go-redis/v9"
)

// Metrics holds Prometheus collectors for a service process.
type Metrics struct {
	Service string

	HTTPDuration *prometheus.HistogramVec
	HTTPRequests *prometheus.CounterVec

	BreakerState prometheus.Gauge
	BreakerTrips prometheus.Counter

	PGAcquired *prometheus.GaugeVec
	PGIdle     *prometheus.GaugeVec
	PGMax      *prometheus.GaugeVec

	RedisTotalConns prometheus.Gauge
	RedisIdleConns  prometheus.Gauge
	RedisStaleConns prometheus.Gauge
}

// NewMetrics registers collectors on the default registry for service.
func NewMetrics(service string) *Metrics {
	m := &Metrics{
		Service: service,
		HTTPDuration: promauto.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "HTTP request latency by route group",
			Buckets: prometheus.DefBuckets,
		}, []string{"service", "route_group", "method", "code"}),
		HTTPRequests: promauto.NewCounterVec(prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total HTTP requests by route group and status",
		}, []string{"service", "route_group", "method", "code"}),
		BreakerState: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "db_circuit_breaker_state",
			Help: "Write-path circuit breaker state: 0=closed, 1=open, 2=half_open",
			ConstLabels: prometheus.Labels{"service": service},
		}),
		BreakerTrips: promauto.NewCounter(prometheus.CounterOpts{
			Name: "db_circuit_breaker_trips_total",
			Help: "Number of times the write-path circuit breaker opened",
			ConstLabels: prometheus.Labels{"service": service},
		}),
		PGAcquired: promauto.NewGaugeVec(prometheus.GaugeOpts{
			Name: "pgx_pool_acquired",
			Help: "Currently acquired Postgres pool connections",
			ConstLabels: prometheus.Labels{"service": service},
		}, []string{"pool"}),
		PGIdle: promauto.NewGaugeVec(prometheus.GaugeOpts{
			Name: "pgx_pool_idle",
			Help: "Idle Postgres pool connections",
			ConstLabels: prometheus.Labels{"service": service},
		}, []string{"pool"}),
		PGMax: promauto.NewGaugeVec(prometheus.GaugeOpts{
			Name: "pgx_pool_max",
			Help: "Max Postgres pool connections",
			ConstLabels: prometheus.Labels{"service": service},
		}, []string{"pool"}),
		RedisTotalConns: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "redis_pool_total_conns",
			Help: "Total Redis pool connections",
			ConstLabels: prometheus.Labels{"service": service},
		}),
		RedisIdleConns: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "redis_pool_idle_conns",
			Help: "Idle Redis pool connections",
			ConstLabels: prometheus.Labels{"service": service},
		}),
		RedisStaleConns: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "redis_pool_stale_conns",
			Help: "Stale Redis pool connections",
			ConstLabels: prometheus.Labels{"service": service},
		}),
	}
	return m
}

// ObserveBreaker implements db.BreakerObserver.
func (m *Metrics) ObserveBreaker(state string, tripped bool) {
	if m == nil {
		return
	}
	switch state {
	case "open":
		m.BreakerState.Set(1)
	case "half_open":
		m.BreakerState.Set(2)
	default:
		m.BreakerState.Set(0)
	}
	if tripped {
		m.BreakerTrips.Inc()
	}
}

// CollectPGPool updates Postgres pool gauges for the named pool.
func (m *Metrics) CollectPGPool(name string, pool *pgxpool.Pool) {
	if m == nil || pool == nil {
		return
	}
	stat := pool.Stat()
	m.PGAcquired.WithLabelValues(name).Set(float64(stat.AcquiredConns()))
	m.PGIdle.WithLabelValues(name).Set(float64(stat.IdleConns()))
	m.PGMax.WithLabelValues(name).Set(float64(stat.MaxConns()))
}

// CollectRedis updates Redis pool gauges when client is *redis.Client.
func (m *Metrics) CollectRedis(client redis.UniversalClient) {
	if m == nil || client == nil {
		return
	}
	c, ok := client.(*redis.Client)
	if !ok {
		return
	}
	stats := c.PoolStats()
	m.RedisTotalConns.Set(float64(stats.TotalConns))
	m.RedisIdleConns.Set(float64(stats.IdleConns))
	m.RedisStaleConns.Set(float64(stats.StaleConns))
}

// StartPoolCollector periodically refreshes pool gauges until ctx is done.
func (m *Metrics) StartPoolCollector(ctx context.Context, interval time.Duration, write, read *pgxpool.Pool, rdb redis.UniversalClient) {
	if m == nil {
		return
	}
	if interval <= 0 {
		interval = 15 * time.Second
	}
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		collect := func() {
			m.CollectPGPool("write", write)
			m.CollectPGPool("read", read)
			m.CollectRedis(rdb)
		}
		collect()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				collect()
			}
		}
	}()
}
