-- Türkiye il (province) polygons. Rows are loaded via backend/cmd/import-boundaries, not seeded here.

CREATE TABLE admin_boundaries (
  il_code  TEXT PRIMARY KEY,
  name_tr  TEXT NOT NULL,
  name_en  TEXT NOT NULL,
  geom     geometry(MultiPolygon, 4326) NOT NULL,
  CONSTRAINT admin_boundaries_il_code_format CHECK (il_code ~ '^[0-9]{2}$'),
  CONSTRAINT admin_boundaries_name_tr_nonempty CHECK (char_length(trim(name_tr)) > 0),
  CONSTRAINT admin_boundaries_name_en_nonempty CHECK (char_length(trim(name_en)) > 0)
);

CREATE INDEX admin_boundaries_geom_idx ON admin_boundaries USING GIST (geom);
