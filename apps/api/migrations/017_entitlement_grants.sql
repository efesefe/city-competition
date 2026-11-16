-- CC-47: One cross-platform entitlement ledger for store IAP + iyzico web.
-- Packs credit users.paid_energy; subscriptions flip users.sub_active.
-- Channel ledgers (iap_grants / iyzico_grants) remain for audit when those leaves merge; new grants write here.

CREATE TABLE IF NOT EXISTS entitlement_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL CHECK (channel IN ('app_store', 'play_store', 'web')),
  provider TEXT NOT NULL CHECK (provider IN ('revenuecat', 'iyzico')),
  product_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pack', 'subscription')),
  energy_granted DOUBLE PRECISION NOT NULL DEFAULT 0,
  provider_event_id TEXT,
  provider_transaction_id TEXT NOT NULL,
  checkout_id TEXT,
  environment TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (provider, provider_transaction_id)
);

CREATE INDEX IF NOT EXISTS entitlement_grants_user_idx ON entitlement_grants (user_id);
CREATE INDEX IF NOT EXISTS entitlement_grants_channel_idx ON entitlement_grants (channel);
CREATE UNIQUE INDEX IF NOT EXISTS entitlement_grants_event_uidx
  ON entitlement_grants (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

-- Backfill from channel ledgers when present (IAP / iyzico leaves may land before or after this).
DO $$
BEGIN
  IF to_regclass('public.iap_grants') IS NOT NULL THEN
    INSERT INTO entitlement_grants (
      id, user_id, channel, provider, product_id, kind, energy_granted,
      provider_event_id, provider_transaction_id, checkout_id, environment, created_at
    )
    SELECT
      id,
      user_id,
      CASE WHEN store = 'play_store' THEN 'play_store' ELSE 'app_store' END,
      CASE WHEN provider = 'iyzico' THEN 'iyzico' ELSE 'revenuecat' END,
      product_id,
      kind,
      energy_granted,
      provider_event_id,
      provider_transaction_id,
      NULL,
      environment,
      created_at
    FROM iap_grants
    ON CONFLICT (provider, provider_transaction_id) DO NOTHING;
  END IF;

  IF to_regclass('public.iyzico_grants') IS NOT NULL THEN
    INSERT INTO entitlement_grants (
      id, user_id, channel, provider, product_id, kind, energy_granted,
      provider_event_id, provider_transaction_id, checkout_id, environment, created_at
    )
    SELECT
      id,
      user_id,
      'web',
      'iyzico',
      product_id,
      kind,
      energy_granted,
      NULL,
      provider_payment_id,
      checkout_id,
      NULL,
      created_at
    FROM iyzico_grants
    ON CONFLICT (provider, provider_transaction_id) DO NOTHING;
  END IF;
END $$;
