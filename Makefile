# City Competition — local DX for apps/ (Expo + Fastify)
#
# Canonical Postgres/Redis: apps/api/docker-compose.yml
#   cd apps/api && docker compose up -d
# Defaults match that compose file (not the legacy root Go/Next compose).

DATABASE_URL ?= postgres://city:city@127.0.0.1:5432/city_competition
REDIS_URL ?= redis://127.0.0.1:6379
API_URL ?= http://localhost:8787

.PHONY: api-up api-down api-dev api-test client-web help

help:
	@echo "Targets (apps/ only):"
	@echo "  make api-up     — docker compose up -d in apps/api (Postgres + Redis)"
	@echo "  make api-down   — docker compose down in apps/api"
	@echo "  make api-dev    — Fastify API (loads apps/api/.env)"
	@echo "  make api-test   — apps/api unit tests"
	@echo "  make client-web — Expo web against $(API_URL)"

api-up:
	cd apps/api && docker compose up -d

api-down:
	cd apps/api && docker compose down

api-dev:
	cd apps/api && npm run dev

api-test:
	cd apps/api && npm test

client-web:
	cd apps/client && EXPO_PUBLIC_API_URL=$(API_URL) npm run web
