# WebSocket city digest (CC-36)

**Date:** 2026-11-16  
**Branch:** `cursor/websocket-city-digest-c04a`  
**Tracker:** CC-36 (Wave 2 — Ship WebSocket city digest)  
**Why:** Guests and logged-in players get a live 81-city ownership/**support** digest over first-party WebSocket (architecture lock: not poll/SSE-until-login). Extends Redis bus from CC-40 / ledger fan-out from CC-35.

## Protocol

| Step | Direction | Payload |
|------|-----------|---------|
| Connect | client → `GET /v1/ws` | WebSocket upgrade |
| Hello | ← server | `{ type: "hello", channels: ["digest"], authRequired: false }` |
| Subscribe | → server | `{ type: "subscribe", channel: "digest" }` |
| Ack | ← server | `{ type: "subscribed", channel: "digest" }` |
| Snapshot | ← server | `{ type: "digest", cities: […81] }` |
| Live | ← server | `support` (every spend — **delta only**), `flip` + full `digest` on ownership change, `ping`. Full `digest` also on subscribe/reconnect (not after every spend). |
| Unsubscribe | → server | `{ type: "unsubscribe", channel: "digest" }` |
| Client ping | → / ← | `{ type: "ping" }` → `{ type: "pong" }` |

**Auth:** none for the digest channel. Guests and fighters share the same feed.

### Digest city shape

```json
{
  "plate": "34",
  "ownerTeamId": "gs",
  "ownerAlias": "Cim Bom",
  "ownerColor": "#E74C3C",
  "leadSupport": 120,
  "rivalSupport": 95,
  "leadMargin": 25
}
```

### Support tick (spend, whether or not flipped)

```json
{
  "type": "support",
  "plate": "34",
  "ownerTeamId": "gs",
  "ownerAlias": "Cim Bom",
  "ownerColor": "#E74C3C",
  "leadSupport": 135,
  "rivalSupport": 95,
  "leadMargin": 40,
  "spentTeamId": "gs",
  "supportCredited": 15
}
```

Fan-out path (W3 delta-first):

| Spend outcome | Publishes |
|---------------|-----------|
| Support only (no flip) | `support` tick; Redis digest cache patched for that plate — **no** full `digest` broadcast |
| Ownership flip | `flip` + `support` + full `digest`; Redis cache replaced |

HTTP spend response still returns a full `digest` array for the spender (cache patch or rebuild) so the confirm path can refresh without waiting on WS.

Reconnect: subscribe again; snapshot prefers Redis `cc:digest:cache` (TTL 60s, warmed at boot). See [ws-delta-support-fanout.md](ws-delta-support-fanout.md).

## Verify locally

```bash
# Postgres + Redis (docker compose in apps/api, or local services)
cd apps/api
export DATABASE_URL=postgres://city:city@127.0.0.1:5432/city_competition
export REDIS_URL=redis://127.0.0.1:6379
npm install && npm run dev
```

### 1. Guest connect + subscribe (no token)

```bash
# Node one-liner (or websocat / wscat)
node --input-type=module -e '
import WebSocket from "ws";
const ws = new WebSocket("ws://127.0.0.1:8787/v1/ws");
const seen = [];
ws.on("message", (d) => {
  const m = JSON.parse(String(d));
  seen.push(m.type);
  console.log(m.type, m.channel ?? m.cities?.length ?? m.plate ?? "");
  if (m.type === "hello") ws.send(JSON.stringify({ type: "subscribe", channel: "digest" }));
  if (m.type === "digest") { console.log("cities", m.cities.length, "sample", m.cities[0]); ws.close(); }
});
ws.on("close", () => { console.log("seen:", seen.join(",")); process.exit(0); });
setTimeout(() => process.exit(1), 8000);
'
```

Expect: `hello` → `subscribed` → `digest` with **81** cities including `leadSupport` / `rivalSupport` / `leadMargin`.

### 2. Live update on spend / flip

Terminal A: keep a subscribed WS open (log every message).  
Terminal B:

```bash
# OTP → tribe → spend (mock OTP 123456 unless NETGSM set)
PHONE=5551234567
curl -s -X POST http://127.0.0.1:8787/v1/auth/phone/start -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}"
TOKEN=$(curl -s -X POST http://127.0.0.1:8787/v1/auth/phone/verify -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"code\":\"123456\"}" | node -pe 'JSON.parse(fs.readFileSync(0)).token')
curl -s -X POST http://127.0.0.1:8787/v1/tribe/pick -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"tribeId":"fb"}'
curl -s -X POST http://127.0.0.1:8787/v1/cities/34/spend -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"confirmed\":true,\"idempotencyKey\":\"ws-digest-$(date +%s)\"}"
```

Expect on Terminal A: `support` for plate `34`. Full `digest` (and `flip`) only if ownership changed; otherwise guests stay in sync via the support tick alone.

### 3. Health

```bash
curl -s http://127.0.0.1:8787/health
# → redis: "PONG", digestSubscribers ≥ 1 while a client is subscribed
```

### 4. Expo guest map

```bash
cd apps/client && EXPO_PUBLIC_API_URL=http://localhost:8787 npm run web
```

Open as guest (Misafir) — map colors from WS digest; spend from a second logged-in session should update the guest map without refresh.

## Real vs stub

| Piece | Status |
|-------|--------|
| `/v1/ws` connect + subscribe + snapshot | **Real** |
| 81-city ownership + support tallies in digest | **Real** (Postgres + Redis cache) |
| Live `support` / `flip` / `digest` on spend | **Real** (via Redis `cc:ownership`) |
| Guests + logged-in same digest channel | **Real** (no auth on subscribe) |
| Expo client subscribe + reconnect | **Real** (light; does not touch TurkiyeMap) |
| Per-city dense support channel (city sheet) | **Later** (architecture optional escalate) |
| Contested heat visual chrome on map | **Later** (map UX leaves; fields already in digest) |

## Files

| Path | Role |
|------|------|
| `apps/api/src/lib/bus.ts` | Digest channel membership + fan-out filter |
| `apps/api/src/lib/game.ts` | Enriched digest SQL, cache read/warm, support publish |
| `apps/api/src/index.ts` | WS hello / subscribe / snapshot protocol |
| `apps/client/app/index.tsx` | Subscribe on open; apply digest + support ticks |
| `apps/client/lib/api.ts` | Optional support fields on `DigestCity` |
