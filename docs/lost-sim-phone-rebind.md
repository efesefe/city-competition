# CC-22 — Support lost-SIM phone rebind (Season 0)

**Date:** 2026-11-16  
**Branch:** `cursor/support-lost-sim-rebind-44f1`  
**Stacked on:** #44 (CC-23) → #43 → #41 → #40  
**Why:** Product lock — Lost SIM → **support-assisted** phone rebind in Season 0 (manual ops, not self-serve). Restores login without wiping tribe, energy, or ledger progress.

## Docs read (store + repo)

- Store `docs/auth-verification-flow.md` — Unlink/change phone; Lost SIM Season 0 = support-assisted rebind  
- Store `docs/architecture.md` — Lost-SIM locked as support-assisted  
- Repo Auth stack: `docs/supabase-auth-providers.md`, `docs/phone-verify-before-play.md`, `docs/gate-guest-actions.md`

## Principle

Rebind **updates `users.phone_e164` in place** on the same account row.  
It does **not** delete the user, reset energy, clear `support_ledger`, or change Kabile/`tribe_id`.

| Field | After rebind |
|-------|----------------|
| `users.id` / handle | Unchanged |
| `tribe_id`, energy buckets | Unchanged |
| `support_ledger` rows | Unchanged (still keyed by `user_id`) |
| `phone_e164` | New E.164 |
| `phone_verified` | `TRUE` |
| Old number | Freed for future signup |
| Audit | `support_audit_log` row (`phone_rebind`) |

## Env

| Variable | Role |
|----------|------|
| `SUPPORT_OPS_KEY` | **Required** for live ops. Bearer token for support endpoints (min 16 chars). Fly secret. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional. When set with `SUPABASE_URL`, rebind also updates the linked Supabase Auth user phone (`phone_confirm: true`) so OTP login on the new SIM maps to the same account. |
| `SUPABASE_URL` | Used with service role for Admin phone update |

Without `SUPPORT_OPS_KEY`, lookup/rebind return `503 support_ops_not_configured`.  
`GET /v1/meta` → `support.opsKeyConfigured` shows whether the key is loaded.

## API

Auth on both routes: `Authorization: Bearer <SUPPORT_OPS_KEY>`.

### Lookup (identity check)

```http
GET /v1/support/users/lookup?phone=+905551112233
GET /v1/support/users/lookup?userId=<id>
GET /v1/support/users/lookup?handle=oyuncu_abc123
```

Returns handle, phone (and last4), tribe, energy totals, `supabaseUserId`, `createdAt` — enough for Season 0 identity confirmation without a full admin console.

### Rebind

```http
POST /v1/support/phone/rebind
Content-Type: application/json
Authorization: Bearer <SUPPORT_OPS_KEY>

{
  "userId": "<local users.id>",
  "newPhone": "+905559998877",
  "reason": "lost_sim",
  "actor": "ops@citycompetition.example",
  "ticketId": "S0-412",
  "syncSupabase": true
}
```

Success includes `progressPreserved: true`, energy snapshot, `auditId`, and `supabaseUpdated`.

| Error | When |
|-------|------|
| `401 unauthorized_support` | Bad/missing ops key |
| `404 user_not_found` | Unknown `userId` |
| `400 invalid_tr_phone` | New number not normalizable to +90… |
| `400 phone_unchanged` | Same number already on account |
| `409 phone_taken` | New phone already on **another** playable account (no Season 0 merge) |

## Season 0 ops procedure (how support performs a rebind)

1. **Intake** — Player reports lost SIM / unreachable old number. Collect: handle (or old phone last digits), Kabile alias, approximate cities supported / energy feel, and any linked Google/Apple email if they remember it. Open an internal ticket id.
2. **Lookup** — Call `GET /v1/support/users/lookup` with old phone, handle, or `userId`. Confirm tribe + energy + createdAt match the player’s story. If mismatch → stop (do not rebind).
3. **Conflict check** — Ensure the **new** number is not already bound (`409` on rebind if taken). If taken by a different progress account, escalate — Season 0 has **no** account merge.
4. **Rebind** — `POST /v1/support/phone/rebind` with `userId`, `newPhone` (E.164 or TR local form), `reason` (e.g. `lost_sim`), `actor` (ops email), `ticketId`.
5. **Tell the player** — Sign in with phone OTP on the **new** SIM (or Google/Apple if already linked). Progress and Kabile are unchanged.
6. **If `supabaseUpdated: false` but account has `supabaseUserId`** — Local row is rebound; finish Supabase Admin phone update manually (Dashboard → Auth → user → phone) or re-run with `SUPABASE_SERVICE_ROLE_KEY` set, so OTP on the new SIM does not create a second Auth user.
7. **Audit** — Keep the ticket id; `support_audit_log` stores actor, old/new phone, reason, energy snapshot.

### curl example (mock / staging)

```bash
export API=https://api.example.com   # or http://localhost:8787
export SUPPORT_OPS_KEY='your-long-ops-secret'

curl -s "$API/v1/support/users/lookup?phone=05551112233" \
  -H "Authorization: Bearer $SUPPORT_OPS_KEY" | jq

curl -s -X POST "$API/v1/support/phone/rebind" \
  -H "Authorization: Bearer $SUPPORT_OPS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "USER_ID_FROM_LOOKUP",
    "newPhone": "05559998877",
    "reason": "lost_sim",
    "actor": "ops@example.com",
    "ticketId": "S0-412"
  }' | jq
```

## Explicit non-goals

- Self-serve in-app “change phone” without support  
- Multi-account merge tooling  
- Full admin console UI (API + ops doc for Season 0)  
- İleti Merkezi failover  

## Test

```bash
cd apps/api && npm run typecheck
# With docker Postgres + SUPPORT_OPS_KEY set:
# lookup → rebind → SELECT phone_e164, free_energy, tribe_id FROM users WHERE id = …
# energy/tribe unchanged; support_audit_log has phone_rebind
```

## Schema

Migration `apps/api/migrations/004_support_phone_rebind.sql` → `support_audit_log`.
