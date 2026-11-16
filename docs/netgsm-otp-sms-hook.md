# CC-20 — Netgsm OTP SMS hook

**Date:** 2026-11-16  
**Branch:** `cursor/netgsm-otp-sms-hook-1b1c`  
**Why:** Deliver Supabase Auth phone OTP via **Netgsm SMS API v3** from the existing Send SMS Hook. Keep dry-run/mock when keys are absent so local + staging stay safe.

**Depends on:** CC-19 Send SMS Hook seam (`POST /v1/auth/hooks/send-sms`) — this leaf bases on that PR branch until merged.

## Behavior

| Condition | Result |
|-----------|--------|
| `NETGSM_*` unset **or** `SMS_HOOK_DRY_RUN` ≠ `false` | **Dry-run** — OTP logged server-side, no vendor HTTP |
| `NETGSM_USERCODE` + `NETGSM_PASSWORD` + `NETGSM_MSGHEADER` + `SMS_HOOK_DRY_RUN=false` | **Live** — token → `POST /sms/v3/send/otp` |
| Live send fails | Hook returns **502** so Supabase can surface failure |

Flow:

```
Supabase Auth (phone OTP)
  → POST /v1/auth/hooks/send-sms  (SEND_SMS_HOOK_SECRETS)
      → dry-run log  OR  Netgsm auth/v3/token + sms/v3/send/otp
```

API: `apps/api/src/lib/netgsm.ts` + `apps/api/src/lib/sms-hook.ts`.  
`GET /v1/meta` → `auth.smsHook.netgsmDelivery`: `"live"` | `"dry-run"`.

## Configure Netgsm env vars

Set on the **API** host (Fly secrets / `.env`) — never in Expo:

| Variable | Required for live | Notes |
|----------|-------------------|--------|
| `SEND_SMS_HOOK_SECRETS` | Yes (hook auth) | Supabase Auth → Hooks → Send SMS secret (`v1,whsec_…`). Multiple: `secretA\|secretB` |
| `SMS_HOOK_DRY_RUN` | Set `false` for live | Default is dry-run even if Netgsm keys exist |
| `NETGSM_USERCODE` | Yes | Netgsm username (panel) |
| `NETGSM_PASSWORD` | Yes | Netgsm password |
| `NETGSM_MSGHEADER` | Yes | Approved OTP **başlık** / sender (alias: `NETGSM_SENDER`) |
| `NETGSM_SANDBOX` | Optional | `true` → `ext-sandbox.netgsm.com.tr` |
| `NETGSM_APP_NAME` | Optional | Defaults to `city-competition` |
| `NETGSM_OTP_TEMPLATE` | Optional | Default `City Competition code: {{otp}}` (Latin-only; Turkish letters transliterated) |

### Supabase Dashboard

1. Auth → Providers → **Phone** enabled.  
2. Auth → Hooks → **Send SMS** → HTTP → `https://<api>/v1/auth/hooks/send-sms`.  
3. Paste the same value into `SEND_SMS_HOOK_SECRETS`.  
4. Buy Netgsm **OTP SMS** package + approve başlık; set `SMS_HOOK_DRY_RUN=false` only after that.

### Fly example

```bash
fly secrets set \
  SEND_SMS_HOOK_SECRETS='v1,whsec_...' \
  SMS_HOOK_DRY_RUN=false \
  NETGSM_USERCODE='312XXXXXXX' \
  NETGSM_PASSWORD='...' \
  NETGSM_MSGHEADER='YOURHEADER'
```

## Real vs stub

| Piece | Real | Stub / fallback |
|-------|------|-----------------|
| Hook path + secret check | Yes | — |
| Netgsm token + OTP send | Yes when env live | Dry-run log when keys absent / dry-run on |
| İleti Merkezi | — | Not in this leaf |
| Standard Webhooks HMAC body verify | Bearer / header secret match | Full `webhook-signature` crypto can tighten later |

## Test

```bash
cd apps/api && npm run typecheck

# Dry-run (default)
SEND_SMS_HOOK_SECRETS=test-secret \
  node -e "
  import('./src/lib/sms-hook.ts').then(async (m) => {
    console.log(await m.deliverOtpSms({ phone: '+905061234567', otp: '123456' }));
  })
"

# Live shape (needs real Netgsm account — do not commit secrets)
# SMS_HOOK_DRY_RUN=false NETGSM_USERCODE=… NETGSM_PASSWORD=… NETGSM_MSGHEADER=…
curl -s http://localhost:8787/v1/meta | jq .auth.smsHook
```

## Explicit non-goals

- İleti Merkezi failover  
- Lost-SIM rebind UI  
- Other Auth leaves (admin OTP gate UI, etc.)
