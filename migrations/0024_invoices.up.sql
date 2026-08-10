-- KDV invoices (06.4) + refundable web purchase status (06.5).

CREATE TABLE invoices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users (id),
  source_type  TEXT NOT NULL CHECK (source_type IN ('iap_purchase', 'web_purchase')),
  source_id    UUID NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'TRY',
  kdv_rate_bps INT NOT NULL CHECK (kdv_rate_bps >= 0),
  net_kurus    BIGINT NOT NULL CHECK (net_kurus >= 0),
  tax_kurus    BIGINT NOT NULL CHECK (tax_kurus >= 0),
  gross_kurus  BIGINT NOT NULL CHECK (gross_kurus > 0),
  status       TEXT NOT NULL DEFAULT 'issued'
                 CHECK (status IN ('issued', 'refunded')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id),
  CHECK (net_kurus + tax_kurus = gross_kurus)
);

CREATE INDEX invoices_user_idx ON invoices (user_id, created_at DESC);

ALTER TABLE web_purchases DROP CONSTRAINT IF EXISTS web_purchases_status_check;
ALTER TABLE web_purchases
  ADD CONSTRAINT web_purchases_status_check
  CHECK (status IN ('verified', 'refunded'));
