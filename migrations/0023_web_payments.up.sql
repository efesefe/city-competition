-- Web / Turkish payment packs + purchase audit (06.3).
-- Extend credit_packs providers; add price for checkout; web_purchases ledger audit.

ALTER TABLE credit_packs DROP CONSTRAINT IF EXISTS credit_packs_provider_check;
ALTER TABLE credit_packs
  ADD CONSTRAINT credit_packs_provider_check
  CHECK (provider IN ('apple', 'google', 'iyzico', 'papara', 'bkm_express'));

ALTER TABLE credit_packs
  ADD COLUMN IF NOT EXISTS amount_kurus BIGINT
  CHECK (amount_kurus IS NULL OR amount_kurus > 0);

CREATE TABLE web_purchases (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users (id),
  provider                 TEXT NOT NULL CHECK (provider IN ('iyzico', 'papara', 'bkm_express')),
  product_id               TEXT NOT NULL,
  provider_payment_id      TEXT NOT NULL,
  payment_intent_id        UUID NOT NULL,
  credits_granted          BIGINT NOT NULL CHECK (credits_granted > 0),
  amount_kurus             BIGINT NOT NULL CHECK (amount_kurus > 0),
  status                   TEXT NOT NULL DEFAULT 'verified'
                             CHECK (status IN ('verified')),
  verified_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_payment_id),
  CHECK (char_length(trim(product_id)) > 0),
  CHECK (char_length(trim(provider_payment_id)) > 0)
);

CREATE INDEX web_purchases_user_idx ON web_purchases (user_id, created_at DESC);

UPDATE credit_packs SET amount_kurus = 999 WHERE product_id = 'credits_100' AND amount_kurus IS NULL;
UPDATE credit_packs SET amount_kurus = 4499 WHERE product_id = 'credits_500' AND amount_kurus IS NULL;
UPDATE credit_packs SET amount_kurus = 9999 WHERE product_id = 'credits_1200' AND amount_kurus IS NULL;

INSERT INTO credit_packs (provider, product_id, credits, amount_kurus, active) VALUES
  ('iyzico',      'credits_100',  100,  999,  true),
  ('iyzico',      'credits_500',  500,  4499, true),
  ('iyzico',      'credits_1200', 1200, 9999, true),
  ('papara',      'credits_100',  100,  999,  true),
  ('papara',      'credits_500',  500,  4499, true),
  ('papara',      'credits_1200', 1200, 9999, true),
  ('bkm_express', 'credits_100',  100,  999,  true),
  ('bkm_express', 'credits_500',  500,  4499, true),
  ('bkm_express', 'credits_1200', 1200, 9999, true)
ON CONFLICT (provider, product_id) DO NOTHING;
