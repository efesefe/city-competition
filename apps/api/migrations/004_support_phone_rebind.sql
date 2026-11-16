-- CC-22: Season 0 support-assisted lost-SIM phone rebind audit trail.
-- Rebind updates users.phone_e164 in place — never deletes the user row (progress preserved).

CREATE TABLE IF NOT EXISTS support_audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  old_phone_e164 TEXT,
  new_phone_e164 TEXT,
  reason TEXT NOT NULL,
  ticket_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS support_audit_log_user_idx ON support_audit_log (user_id);
CREATE INDEX IF NOT EXISTS support_audit_log_created_idx ON support_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS support_audit_log_action_idx ON support_audit_log (action);
