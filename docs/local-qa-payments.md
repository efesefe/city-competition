# Local QA: login-as-user + Iyzico payment E2E

## Modes

| Mode | When | What happens |
|---|---|---|
| **Mock iyzico** (default) | `IYZICO_MOCK=true` or empty keys in development | Checkout opens a local Success/Fail page on the payments service; webhook + credit grant run in-process |
| **Sandbox iyzico** | Keys from [sandbox merchant panel](https://sandbox-merchant.iyzipay.com/auth/register), `IYZICO_MOCK=false` | Real Checkout Form at `https://sandbox-api.iyzipay.com`. If the webhook cannot reach localhost, use **Simulate success (local)** on `/profile/topup` after return |

Sandbox panel OTP is static `123456`. API keys are under Settings → Merchant Settings → API Keys (`sandbox-…` prefix).

### Test cards (sandbox only)

- Success: `5526080000000006` (credit), `5890040000000016` (debit) — any future expiry/CVV
- Insufficient funds: `4111111111111129`
- Docs: https://docs.iyzico.com/en/add-ons/test-cards

There is no official Go SDK; this repo’s Go Checkout Form client matches [iyzipay-node](https://github.com/iyzico/iyzipay-node).

## Seeded QA personas

Boot seeds (after parody tribes):

| Username | Phone | Role |
|---|---|---|
| `qa_admin` | `+905550000001` | Admin |
| `qa_<tribe_slug_with_underscores>` | `+905550000011` … | One player per tribe, consents + tribe already set |

Example: `qa_kizil_ruzgar`, `qa_sari_dalga`.

## Walkthrough

1. `docker compose up` (defaults: mock iyzico, QA panel, OTP reveal).
2. Open the app → **Local QA** → pick `qa_kizil_ruzgar` → **Login as persona** → map.
3. **Open top-up / pay** → choose a pack → Iyzico → mock **Success** → credits increase.
4. Support a province (map sheet or QA **Quick support**, e.g. il `34`).
5. Switch to `qa_sari_dalga` → support the same il → map/leaderboard show rivalry.
6. Optional sandbox: set `IYZICO_API_KEY` / `IYZICO_SECRET_KEY`, `IYZICO_MOCK=false`, pay with a test card, then **Simulate success (local)** if status stays pending.
7. Phone path: `/login` with a seeded phone → OTP response includes `dev_otp` → log in.
8. As `qa_admin` on `/moderation`, **Login as** on a flagged user; **Exit impersonation** in Local QA restores the admin session.

## Env flags

```
IYZICO_MOCK=true
IYZICO_API_KEY=
IYZICO_SECRET_KEY=
IYZICO_BASE_URL=https://sandbox-api.iyzipay.com
PAYMENTS_PUBLIC_BASE=http://localhost:8081
DEV_OTP_REVEAL=true
DEV_LOGIN_AS_ENABLED=true
NEXT_PUBLIC_DEV_QA_PANEL=true
CREDITS_STUB_ENABLED=true
```

Production forces mock/login-as/OTP reveal off.
