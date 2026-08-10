package observability

// Canonical service name labels for slog and Prometheus.
const (
	ServiceAPI             = "api"
	ServicePayments        = "payments"
	ServiceWorkerSeason    = "worker-season"
	ServiceWorkerAnalytics = "worker-analytics"
	ServiceWorkerErasure   = "worker-erasure"
)
