# Logged-in static share cards (CC-59)

Season 0 Fastify + Expo slice: mint **static** share images for **support** and **team accomplishment** actions. **Guest generic map share = no** (product lock).

Product source: store `docs/notifications-and-share.md` (Template A / B; logged-in entry points only).

## Templates

| Kind | When | Copy (example) |
|------|------|----------------|
| **support** | After successful spend | “Baykuş Kabilesi İstanbul için destek verdi.” |
| **accomplishment** `took_city` | After own flip | “Sur Kabilesi Diyarbakır'ı aldı. Sezon 0.” |
| **accomplishment** `cities_owned` | Team scoreboard | “Dadaş Kabilesi — 12 şehir. Sezon 0.” |
| **accomplishment** `held_city` | War hold (API ready) | “{Alias} savaşta {City}'yi tuttu.” |

Brand **City Competition** is hero-level on the SVG. Colors use tribe primary hex when known. No official club names.

## Auth gates

`POST /v1/share/cards` requires session + `phone_verified` + `tribe_id`. Guests browsing the map/scoreboard never get a map-share CTA.

## API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `POST` | `/v1/share/cards` | Yes | Mint support or accomplishment card |
| `GET` | `/v1/share/cards/mine` | Yes | Recent cards for the user |
| `GET` | `/v1/share/:id` | No | Public metadata |
| `GET` | `/v1/share/:id/card.svg` | No | Static SVG image |

Schema: migration `013_share_cards.sql`.

## Client entry points

- City sheet after spend → **Paylaş — destek**
- City sheet after own flip → **Paylaş — aldık!**
- Scoreboard (logged-in + tribe) → **Paylaş — kabile skoru**

Uses React Native `Share` with the SVG URL. Soft-launch store/web CTA URL remains TBD (`PUBLIC_WEB_URL` / `APP_PUBLIC_URL` optional).

## How to test

```bash
cd apps/api
npm test
npm run typecheck
```

Manual: verify phone + pick tribe → spend → share support; flip → share accomplishment; open skor as guest → no share button; as logged-in → cities-owned share.
