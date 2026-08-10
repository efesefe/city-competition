# i18n follow-ups (Sprint 10 / Epic 09)

## Feed UI

- `GET /v1/feed` returns backend-rendered `message` (via `feed.Render` + `i18n.Locative`).
- When a feed surface is built, display `message` as-is. Do **not** concatenate province stems with Turkish suffixes on the client.

## Admin surfaces

- Moderation and admin derby pages still use hardcoded Turkish copy (out of scope for this rollout).

## Other

- Maplibre Turkish glyph coverage (09.4) and low-end performance mode (09.5) are separate prompts.
- Prefer ICU placeholders in message catalogs over template-literal UI copy when touching remaining screens.
