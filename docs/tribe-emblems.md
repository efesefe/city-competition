# Tribe mascot emblems

Seeded parody tribes show an original silhouette on every crest disc (header, picker, profile, derby, leaderboard, conquest toasts, map city markers) instead of a letter monogram.

## Why this shape

- Tribes parody popular Turkish football clubs with fiction names and colors only. The UI must **never** use official club names, crests, or trademarks.
- Emblems are original filled silhouettes, keyed by `tribe.slug` on the frontend. No `crest_asset_url`, no migration, no API change.
- Unknown slugs (admin-created tribes, e2e `test-tribe`) still use `tribeCrestInitial` (1–3 letters).

## Mapping

| Slug | Emblem |
| --- | --- |
| `kizil-ruzgar` | lion |
| `sari-dalga` | canary |
| `siyah-gelgit` | eagle |
| `bordo-firtina` | storm bolt |
| `turkuaz-ufuk` | wave |
| `kirmizi-pusula` | compass |
| `turuncu-sahil` | sun |
| `yesil-ovalar` | crocodile |
| `lacivert-zirve` | mountain |
| `mor-isik` | crescent |

Source of truth: `frontend/lib/tribeEmblem.ts` (`TRIBE_EMBLEM_BY_SLUG` + `EMBLEM_GLYPHS`). React renders `TribeEmblem`; MapLibre city crests rasterize the same paths in `frontend/lib/map/crestIcons.ts`.

## Mark color

`tribeMarkColor` paints the silhouette on the primary-color disc:

- White when contrast vs the fill is at least 3:1
- Otherwise the tribe secondary, if that contrasts
- Otherwise near-black (so Sarı Dalga’s canary is navy on yellow, not white on yellow)

## How to test

Automated:

```bash
cd frontend && npm test -- lib/tribeEmblem lib/tribeCrest lib/map/ownership
```

Manual QA:

1. Choose-tribe grid: each of the ten seeded tribes shows its mascot, not a three-letter code. Siyah Gelgit is an eagle.
2. After joining, the header crest and profile badge match the same emblem.
3. A held city on the Türkiye map shows the controlling tribe’s mascot in the crest layer (not letters).
4. An active derby banner shows both tribes’ emblems.
5. Switching to a non-seeded / mocked tribe still shows initials.
