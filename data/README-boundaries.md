# Türkiye province geometry (historical note)

Season 0 uses an **SVG province atlas** shipped with `apps/client` (`assets/turkiye-provinces.json`). There is no PostGIS `admin_boundaries` import path in the active stack.

The former Go importer (`backend/cmd/import-boundaries`, `make import-boundaries`) and root PostGIS compose were **deleted** with decision **D1**.

`data/turkiye-il-adjacency.json` remains as a static reference dataset only; it is not loaded by `apps/api` or `apps/client` today. Large GeoJSON dumps (`turkiye-il.geojson`, geoBoundaries extracts) stay gitignored if present locally.
