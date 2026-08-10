# Türkiye il (ADM1) boundaries for MapLibre

The map’s city polygons come from Postgres table `admin_boundaries`, served by
`GET /v1/provinces/geojson`. Migrations create the table but **do not** load
geometry. You must import once (or after a fresh DB volume).

## Dataset

Use a WGS84 GeoJSON FeatureCollection of 81 provinces with properties:

| Property   | Required | Notes                                      |
|------------|----------|--------------------------------------------|
| `il_code`  | yes*     | Zero-padded `"01"`…`"81"`                  |
| `name_tr`  | yes      | Turkish display name                       |
| `name_en`  | no       | Falls back to `name_tr`                    |

\*Also accepted: `plate`, `PCODE`, `shapeISO` (e.g. `TR-34`).

Recommended source: [geoBoundaries TUR ADM1](https://www.geoboundaries.org/)
(simplified GeoJSON is enough for city-granularity fills). License: see the
provider (typically CC BY / ODbL for OSM-derived releases).

Do **not** commit `data/turkiye-il.geojson` (gitignored). Keep adjacency data
in `data/turkiye-il-adjacency.json` separate — that is `import-adjacency`.

## Import

From the repo root (Postgres reachable; for Docker Compose on the host use
`localhost` instead of the service hostname `postgres`):

```bash
# Place or generate data/turkiye-il.geojson first, then:
make import-boundaries
# or:
make import-boundaries DATABASE_URL='postgres://citycomp:citycomp@localhost:5432/citycomp?sslmode=disable'
```

Equivalent:

```bash
cd backend
go run ./cmd/import-boundaries \
  -database-url "$DATABASE_URL" \
  -file ../data/turkiye-il.geojson
```

Verify:

```sql
SELECT count(*) FROM admin_boundaries;  -- expect 81
```

Then reload `/map`. An empty table yields the frontend banner
“İl sınırları yüklenemedi…” / empty GeoJSON features.
