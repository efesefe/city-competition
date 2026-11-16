-- CC-28: match-day map chrome — team boost windows + spotlight city/label.
-- Extends CC-27 team_boost_windows (005) with spotlight/label; CREATE/ALTER IF NOT EXISTS is idempotent.

CREATE TABLE IF NOT EXISTS team_boost_windows (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(internal_id),
  boost_pct DOUBLE PRECISION NOT NULL DEFAULT 1.25,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  spotlight_plate TEXT,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS team_boost_windows_active_idx
  ON team_boost_windows (team_id, starts_at, ends_at);

ALTER TABLE team_boost_windows
  ADD COLUMN IF NOT EXISTS spotlight_plate TEXT;

ALTER TABLE team_boost_windows
  ADD COLUMN IF NOT EXISTS label TEXT;

CREATE INDEX IF NOT EXISTS team_boost_windows_spotlight_active_idx
  ON team_boost_windows (spotlight_plate, starts_at, ends_at)
  WHERE spotlight_plate IS NOT NULL;

COMMENT ON TABLE team_boost_windows IS
  'Match-day / team boost windows (+25% default); fixture stub seeds chrome until Admin ops';
COMMENT ON COLUMN team_boost_windows.spotlight_plate IS
  'Optional derby/timed-war city plate for map spotlight (NULL = team boost only)';
COMMENT ON COLUMN team_boost_windows.label IS
  'Ops/fixture label for banner copy (e.g. Aslan home)';
