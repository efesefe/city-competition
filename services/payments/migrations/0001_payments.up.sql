-- Isolated payments schema (PCI boundary). No raw card data columns.
CREATE TABLE payment_intents (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL,
  provider             TEXT NOT NULL CHECK (provider IN ('iyzico', 'papara', 'bkm_express')),
  product_id           TEXT NOT NULL,
  credits              BIGINT NOT NULL CHECK (credits > 0),
  amount_kurus         BIGINT NOT NULL CHECK (amount_kurus > 0),
  currency             TEXT NOT NULL DEFAULT 'TRY' CHECK (currency = 'TRY'),
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  provider_payment_id  TEXT,
  checkout_url         TEXT,
  idempotency_key      TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key),
  UNIQUE (provider, provider_payment_id),
  CHECK (char_length(trim(product_id)) > 0),
  CHECK (char_length(trim(idempotency_key)) > 0)
);

CREATE INDEX payment_intents_user_idx ON payment_intents (user_id, created_at DESC);
CREATE INDEX payment_intents_status_idx ON payment_intents (status) WHERE status = 'pending';
