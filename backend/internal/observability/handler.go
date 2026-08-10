package observability

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// MetricsHandler returns the Prometheus scrape endpoint.
func MetricsHandler() http.Handler {
	return promhttp.Handler()
}
