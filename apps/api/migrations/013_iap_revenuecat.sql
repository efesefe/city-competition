-- CC-44: App Store IAP via RevenueCat — purchase ledger + sub entitlement flag.
-- sub_active may already exist from CC-33 (midnight sub bonus); IF NOT EXISTS keeps both orderings safe.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sub_active BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sub_grant_date TEXT;

INSERT INTO tunables (key, value)
VALUES ('sub_daily_bonus', '50')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS iap_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL DEFAULT 'revenuecat',
  store TEXT NOT NULL DEFAULT 'app_store',
  product_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pack', 'subscription')),
  energy_granted DOUBLE PRECISION NOT NULL DEFAULT 0,
  provider_event_id TEXT,
  provider_transaction_id TEXT NOT NULL,
  environment TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (provider_transaction_id)
);

CREATE INDEX IF NOT EXISTS iap_grants_user_idx ON iap_grants (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS iap_grants_event_uidx
  ON iap_grants (provider_event_id)
  WHERE provider_event_id IS NOT NULL;
