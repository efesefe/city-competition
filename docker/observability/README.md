# Observability stack (10.4)

Compose services: **Loki** (logs), **Promtail** (ship Docker logs), **Prometheus** (metrics scrape), **Grafana** (dashboards + alert rule visibility).

## URLs

| Service    | URL |
|------------|-----|
| Grafana    | http://localhost:3001 (admin / admin) |
| Prometheus | http://localhost:9090 |
| Loki       | http://localhost:3100 |
| API metrics | http://localhost:8080/metrics |
| Payments metrics | http://localhost:8081/metrics |

## Manual check: circuit-breaker alert

1. Start the stack: `docker compose up -d`
2. Open Grafana → dashboard **City Competition Observability** → panel **Circuit breaker state**.
3. Trip the write-path breaker (5 consecutive write failures; existing integration tests in `backend/internal/db` document the threshold, or force DB write errors against a degraded primary).
4. Confirm `db_circuit_breaker_state == 1` (open) and Prometheus alert `WritePathCircuitBreakerOpen` fires after 30s (`docker/observability/alerts.yml`).
5. After cooldown, a successful half-open trial returns state to closed (0).

## Log schema

JSON slog fields: `service`, `request_id`, `level`, `msg`, plus contextual attrs (`job_id`, `route_group`, `error`, …).
