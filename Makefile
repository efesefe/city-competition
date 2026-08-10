# City Competition — common local tasks
#
# DATABASE_URL for Compose-from-host (port published):
#   postgres://citycomp:citycomp@localhost:5432/citycomp?sslmode=disable
# Inside the compose network use hostname "postgres" instead of localhost.

DATABASE_URL ?= postgres://citycomp:citycomp@localhost:5432/citycomp?sslmode=disable
BOUNDARIES_FILE ?= $(CURDIR)/data/turkiye-il.geojson

.PHONY: import-boundaries
import-boundaries:
	@test -f "$(BOUNDARIES_FILE)" || (echo "Missing $(BOUNDARIES_FILE). See data/README-boundaries.md" >&2; exit 1)
	cd backend && go run ./cmd/import-boundaries -database-url "$(DATABASE_URL)" -file "$(BOUNDARIES_FILE)"
