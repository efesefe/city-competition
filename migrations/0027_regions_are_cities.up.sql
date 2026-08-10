-- Cities (il provinces) are the supportable region unit.
--
-- Data strategy: reset/backfill N/A — support was never tile-UUID keyed;
-- supports / tribe_province_scores / province_control_summary already store il_code.
-- No hex-grid regions/tiles table exists in this codebase to deprecate.
-- GPS tile/supply-line gameplay remains superseded; region_adjacency is a static
-- neighbor graph only (loaded via backend/cmd/import-adjacency).

CREATE VIEW regions AS
SELECT
  il_code AS id,
  name_tr AS name,
  geom,
  ST_PointOnSurface(geom)::geometry(Point, 4326) AS centroid
FROM admin_boundaries;

CREATE TABLE region_adjacency (
  il_code_a TEXT NOT NULL REFERENCES admin_boundaries (il_code) ON DELETE CASCADE,
  il_code_b TEXT NOT NULL REFERENCES admin_boundaries (il_code) ON DELETE CASCADE,
  PRIMARY KEY (il_code_a, il_code_b),
  CONSTRAINT region_adjacency_ordered CHECK (il_code_a < il_code_b)
);

CREATE INDEX region_adjacency_b_idx ON region_adjacency (il_code_b);
