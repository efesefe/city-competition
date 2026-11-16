-- CC-27/CC-32: personal boost expiry on users + match-day team boost windows.
-- Personal +50%/1h applies at spend with real timing; purchase stays Payments-stub.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS personal_boost_expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS team_boost_windows (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(internal_id),
  boost_pct DOUBLE PRECISION NOT NULL DEFAULT 1.25,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS team_boost_windows_active_idx
  ON team_boost_windows (team_id, starts_at, ends_at);

COMMENT ON COLUMN users.personal_boost_expires_at IS
  'UTC expiry for personal +50% support boost (NULL = inactive)';
COMMENT ON TABLE team_boost_windows IS
  'Ops/match-day team boost windows (+25% default); sim endpoint seeds for UI until admin leaf';
