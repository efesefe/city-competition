-- CC-65/66: season-window player board queries filter support_ledger by created_at.
CREATE INDEX IF NOT EXISTS support_ledger_created_idx ON support_ledger (created_at);
CREATE INDEX IF NOT EXISTS support_ledger_user_created_idx ON support_ledger (user_id, created_at);
