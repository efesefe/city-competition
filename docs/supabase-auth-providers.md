# CC-19 — Supabase Auth providers (phone + Google + Apple)

**Date:** 2026-11-16  
**Branch:** `cursor/supabase-auth-providers-7719`  
**Why:** Wire Season 0 Auth stack (locked: Supabase Auth, not Firebase) onto the Expo + Fastify slice, with a local mock fallback when no live project is configured. Netgsm SMS delivery is **CC-20** — this leaf only leaves the Send SMS Hook seam.

## Modes

| Mode | When | Phone OTP | Google / Apple |
|------|------|-----------|----------------|
| **mock** (default local) | `SUPABASE_URL` + `SUPABASE_JWT_SECRET` unset on API | Local `otp_codes` + `MOCK_OTP_CODE` (`123456`) | Stub `POST /v1/auth/oauth/:provider` → still needs phone bind |
| **supabase** | Both set on API; client has `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Expo `@supabase/supabase-js` `signInWithOtp` / `verifyOtp` | `signInWithOAuth`; then exchange session |

API advertises mode on `GET /v1/meta` → `auth.mode` / `auth.oauthMode` / `auth.smsHook`.

## Env (API — `apps/api/.env.example`)

| Variable | Role |
|----------|------|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | Advertised / client-aligned |
| `SUPABASE_JWT_SECRET` | Verify access tokens (HS256); JWKS fallback if asymmetric |
| `SEND_SMS_HOOK_SECRETS` | Hook auth for `POST /v1/auth/hooks/send-sms` |
| `SMS_HOOK_DRY_RUN` | Default dry-run logs OTP server-side (no Netgsm) |
| `NETGSM_*` | Present but **not** used for send until CC-20 |
| `MOCK_OTP_CODE` | Mock-only |
| `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` | Optional flags for `/v1/meta` when live |

## Env (client)

| Variable | Role |
|----------|------|
| `EXPO_PUBLIC_SUPABASE_URL` | Same project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Anon key |
| `EXPO_PUBLIC_API_URL` | Fastify base |

## Integration shape

```
Client (Supabase SDK) ──phone OTP / OAuth──► Supabase Auth
        │
        └── Bearer access_token ──► POST /v1/auth/supabase/session
                                    GET  /v1/me  (JWT accepted)
                                         │
                                         ▼
                              local users.supabase_user_id
                              phone_verified from JWT phone claim
```

Migration: `apps/api/migrations/003_supabase_auth.sql` adds `users.supabase_user_id`.

## SMS Hook seam (ready for CC-20)

- Path: `POST /v1/auth/hooks/send-sms`
- Point Supabase Dashboard → Auth → Hooks → Send SMS here (tunnel for local).
- Verifies `SEND_SMS_HOOK_SECRETS` (Bearer / `x-supabase-hook-secret`).
- `deliverOtpSms()` logs OTP in dry-run; **does not** call Netgsm yet.
- CC-20: implement vendor send inside `deliverOtpSms` and tighten Standard Webhooks verify.

## Real vs stub

| Piece | Real | Stub / fallback |
|-------|------|-----------------|
| JWT verify + User upsert | Yes when Supabase env set | — |
| Phone OTP via Supabase SDK | Yes when client+API env set | Local mock OTP |
| Google / Apple | Yes via Supabase providers | Local stub buttons |
| SMS delivery (Netgsm) | Seam only | Dry-run log / CC-20 |
| Session for spend gates | Bearer JWT or local session token | Mock sessions table |

## Test

```bash
# Mock (no Supabase)
cd apps/api && docker compose up -d && npm run dev
cd apps/client && EXPO_PUBLIC_API_URL=http://localhost:8787 npm run web
# Auth → mock OTP 123456; Google/Apple → stub → bind phone

# Live shape (needs real project + redirect URLs + providers enabled)
# API: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET, SEND_SMS_HOOK_SECRETS
# Client: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY
curl -s http://localhost:8787/v1/meta | jq .auth
```

## Explicit non-goals (this leaf)

- Netgsm / İleti Merkezi API send (CC-20)
- Lost-SIM support rebind UI
- Fighting map-only TurkiyeMap PRs
