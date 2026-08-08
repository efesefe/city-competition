-- Extensions for geospatial queries and fuzzy text search.
-- Collation: set ICU locale tr-TR-x-icu per text column later
-- (e.g. COLLATE "tr-TR-x-icu"), not a database-wide setting.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
