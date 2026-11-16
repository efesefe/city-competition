-- CC-46: Web checkout via iyzico (Checkout Form / 3DS) for packs + monthly sub.
-- sub_active may already exist from CC-33 / CC-44; IF NOT EXISTS keeps merge orderings safe.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sub_active BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sub_grant_date TEXT;

INSERT INTO tunables (key, value)
VALUES ('sub_daily_bonus', '50')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS iyzico_checkouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('pack', 'subscription')),
  product_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  energy_grant DOUBLE PRECISION NOT NULL DEFAULT 0,
  amount_kurus INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'TRY',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed')),
  provider_token TEXT,
  provider_payment_id TEXT,
  checkout_url TEXT,
  return_url TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS iyzico_checkouts_user_idx ON iyzico_checkouts (user_id);
CREATE INDEX IF NOT EXISTS iyzico_checkouts_token_idx ON iyzico_checkouts (provider_token)
  WHERE provider_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS iyzico_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  checkout_id TEXT NOT NULL REFERENCES iyzico_checkouts(id),
  kind TEXT NOT NULL CHECK (kind IN ('pack', 'subscription')),
  product_id TEXT NOT NULL,
  energy_granted DOUBLE PRECISION NOT NULL DEFAULT 0,
  provider_payment_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (provider_payment_id)
);

CREATE INDEX IF NOT EXISTS iyzico_grants_user_idx ON iyzico_grants (user_id);
