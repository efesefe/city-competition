-- CC-52..55: admin OTP gates, team-add tickets, seed confirm, ops metrics.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS admin_phone_enrolled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS admin_otp_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_otp_challenges_user_purpose_idx
  ON admin_otp_challenges (user_id, purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_key TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx
  ON admin_audit_log (created_at DESC);

CREATE TABLE IF NOT EXISTS team_add_tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  requested_club TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  admin_note TEXT,
  created_public_alias TEXT,
  created_team_id TEXT REFERENCES teams(internal_id),
  triaged_by TEXT REFERENCES users(id),
  triaged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT team_add_tickets_status_chk
    CHECK (status IN ('open', 'accepted', 'rejected', 'deferred'))
);

CREATE INDEX IF NOT EXISTS team_add_tickets_status_idx
  ON team_add_tickets (status, created_at DESC);

CREATE TABLE IF NOT EXISTS ownership_flips (
  id TEXT PRIMARY KEY,
  city_plate TEXT NOT NULL REFERENCES cities(plate),
  from_team_id TEXT REFERENCES teams(internal_id),
  to_team_id TEXT NOT NULL REFERENCES teams(internal_id),
  caused_by_user_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ownership_flips_created_idx
  ON ownership_flips (created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  sku TEXT NOT NULL,
  amount_try DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS purchase_events_created_idx
  ON purchase_events (created_at DESC);

CREATE TABLE IF NOT EXISTS concurrent_peaks (
  id TEXT PRIMARY KEY,
  sampled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concurrent INTEGER NOT NULL,
  in_match_window BOOLEAN NOT NULL DEFAULT FALSE,
  window_id TEXT
);

CREATE INDEX IF NOT EXISTS concurrent_peaks_sampled_idx
  ON concurrent_peaks (sampled_at DESC);

COMMENT ON TABLE admin_otp_challenges IS
  'CC-52: purpose-scoped OTP for pack prices, economy tunables, season bounds, seed writes';
COMMENT ON TABLE team_add_tickets IS
  'CC-53: player add-team requests; admin triage accept/reject/defer';
COMMENT ON TABLE ownership_flips IS
  'CC-55: ownership lead changes for flips metric';
COMMENT ON TABLE purchase_events IS
  'CC-55: pack/sub/boost revenue events (stub until payments ledger)';
COMMENT ON COLUMN users.admin_phone_enrolled IS
  'CC-52: ops admin enrolled phone for gated OTP (uses users.phone_e164)';
