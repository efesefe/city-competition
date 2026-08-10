DROP TABLE IF EXISTS web_purchases;

ALTER TABLE credit_packs DROP COLUMN IF EXISTS amount_kurus;

DELETE FROM credit_packs WHERE provider IN ('iyzico', 'papara', 'bkm_express');

ALTER TABLE credit_packs DROP CONSTRAINT IF EXISTS credit_packs_provider_check;
ALTER TABLE credit_packs
  ADD CONSTRAINT credit_packs_provider_check
  CHECK (provider IN ('apple', 'google'));
