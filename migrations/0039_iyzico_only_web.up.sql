-- Web checkout is iyzico-only. Keep papara/bkm_express rows for historical
-- web_purchases / refunds; do not drop CHECK constraints.

UPDATE credit_packs
SET active = false
WHERE provider IN ('papara', 'bkm_express');
