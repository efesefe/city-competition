-- Materialized leading-tribe control snapshot per il (refreshed by Go worker).
-- Reads must not recompute ST_Area or scan supports live per request.

CREATE TABLE province_control_summary (
  il_code               TEXT PRIMARY KEY REFERENCES admin_boundaries (il_code),
  tribe_id              UUID REFERENCES tribes (id),
  effective_support_sum NUMERIC NOT NULL DEFAULT 0 CHECK (effective_support_sum >= 0),
  control_pct           NUMERIC NOT NULL DEFAULT 0 CHECK (control_pct >= 0 AND control_pct <= 100),
  refreshed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
