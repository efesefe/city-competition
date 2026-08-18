-- Admin extra-credits promotions and frozen web checkout quotes.

CREATE TABLE purchase_promos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bonus_percent   INTEGER NOT NULL CHECK (bonus_percent >= 1 AND bonus_percent <= 200),
  active          BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID NOT NULL REFERENCES users (id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at  TIMESTAMPTZ,
  deactivated_by  UUID REFERENCES users (id)
);

CREATE UNIQUE INDEX purchase_promos_one_active
  ON purchase_promos (active)
  WHERE active = true;

CREATE TABLE purchase_quotes (
  payment_intent_id UUID PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES users (id),
  product_id        TEXT NOT NULL CHECK (char_length(trim(product_id)) > 0),
  base_credits      BIGINT NOT NULL CHECK (base_credits > 0),
  bonus_percent     INTEGER NOT NULL DEFAULT 0 CHECK (bonus_percent >= 0 AND bonus_percent <= 200),
  credits           BIGINT NOT NULL CHECK (credits > 0),
  amount_kurus      BIGINT NOT NULL CHECK (amount_kurus > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX purchase_quotes_user_idx ON purchase_quotes (user_id, created_at DESC);
