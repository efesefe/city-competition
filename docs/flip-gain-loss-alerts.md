# Flip gain / loss alerts (CC-58)

Season 0 Fastify path (`apps/api`): when ownership flips, notify verified members of the **gaining** and **losing** tribes over **push + in-app**, with a **5-minute** per-user coalesce.

Product source: store `docs/notifications-and-share.md` (soft-launch flip gain **and** loss; coalesce 5 min). Builds on the attack alert pipeline (`docs/attack-alert-pipeline.md`).

## Who gets an alert

| Kind | Audience | Copy |
|------|----------|------|
| **Gain** | Verified members of the new owner tribe | `{City} sizin` — your alias took the lead; hold it |
| **Loss** | Verified members of the previous owner tribe (skipped on first claim) | `{City} el değiştirdi` — new owner took the lead; take it back |

Audience is **tribe-only**. Last-24h spenders who are not in the gain/loss tribes stay on attack/fight alerts — that is the attack∩flip dedupe (no flip spillover to fight-only interest).

Guests never receive flip alerts. Same-tribe re-claim (no owner change) is a non-trigger.

## Coalesce

Redis `SET NX EX 300` on `coalesce:flip_gain|flip_loss:{plate}:{userId}` plus buffer hash. First flip event in the window dual-writes inbox + `notif_queue`; later flips in the same window only bump the buffer.

Separate windows from `attack` — a defender may see both “under attack” and “flipped” when the spend that flipped also triggered an owned attack alert (soft-launch **extra** flip push).

## Channels

| Channel | Mechanism |
|---------|-----------|
| **In-app** | Postgres `user_notifications` (`type` = `flip_gain` / `flip_loss`) |
| **Push** | Same `notif_queue` worker + `device_push_tokens` as attack alerts |

Deep link: `/map?il={plate}` (city sheet / spend CTA).

## Spend hook

After commit, when `flipped === true`, `dispatchFlipAlerts` runs best-effort (after `dispatchAttackAlerts`). Failures are logged and never roll back the spend.

## How to test

```bash
cd apps/api
npm test
npm run typecheck
```

Manual: rival spend that flips ownership → gaining tribe inbox shows `{City} sizin`; losing tribe shows `{City} el değiştirdi`. Second flip on the same city within 5 min for the same user coalesces.
