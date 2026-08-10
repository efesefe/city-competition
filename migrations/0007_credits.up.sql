-- Credit wallet (balance) + append-only ledger. Application code never UPDATE/DELETE ledger rows.

CREATE TYPE credit_ledger_reason AS ENUM (
  'purchase',
  'stub_grant',
  'support_spend',
  'refund',
  'referral',
  'admin_adjust'
);

CREATE TABLE credit_accounts (
  user_id    UUID PRIMARY KEY REFERENCES users (id),
  balance    BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE credit_ledger (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users (id),
  delta            BIGINT NOT NULL,
  balance_after    BIGINT NOT NULL CHECK (balance_after >= 0),
  reason           credit_ledger_reason NOT NULL,
  ref_type         TEXT,
  ref_id           TEXT,
  idempotency_key  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT credit_ledger_idempotency_key_key UNIQUE (idempotency_key)
);

CREATE INDEX credit_ledger_user_created_idx ON credit_ledger (user_id, created_at DESC);
