ALTER TABLE web_purchases DROP CONSTRAINT IF EXISTS web_purchases_status_check;
ALTER TABLE web_purchases
  ADD CONSTRAINT web_purchases_status_check
  CHECK (status IN ('verified'));

DROP TABLE IF EXISTS invoices;
