-- CC-33: subscription entitlement flag + idempotency date for TR midnight +50.
-- Payments leaf will flip sub_active from receipt/webhook; this leaf only reads it.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sub_active BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sub_grant_date TEXT;

INSERT INTO tunables (key, value)
VALUES ('sub_daily_bonus', '50')
ON CONFLICT (key) DO NOTHING;
