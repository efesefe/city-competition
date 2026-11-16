-- CC-50 / CC-51: admin-scheduled match-day team boosts + derby timed city wars.
-- Compatible with CC-28 chrome cols (spotlight_plate / label) via IF NOT EXISTS.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'player';

ALTER TABLE team_boost_windows
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE team_boost_windows
  ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;

ALTER TABLE team_boost_windows
  ADD COLUMN IF NOT EXISTS created_by TEXT;

ALTER TABLE team_boost_windows
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'team_boost';

ALTER TABLE team_boost_windows
  ADD COLUMN IF NOT EXISTS spotlight_plate TEXT;

ALTER TABLE team_boost_windows
  ADD COLUMN IF NOT EXISTS label TEXT;

ALTER TABLE team_boost_windows
  ADD COLUMN IF NOT EXISTS involved_aliases TEXT;

CREATE INDEX IF NOT EXISTS team_boost_windows_spotlight_active_idx
  ON team_boost_windows (spotlight_plate, starts_at, ends_at)
  WHERE spotlight_plate IS NOT NULL AND canceled_at IS NULL;

CREATE INDEX IF NOT EXISTS team_boost_windows_kind_idx
  ON team_boost_windows (kind, starts_at, ends_at)
  WHERE canceled_at IS NULL;

COMMENT ON COLUMN users.role IS
  'player | admin — gates /v1/admin/* match-day scheduling';
COMMENT ON COLUMN team_boost_windows.kind IS
  'team_boost (+25% tribe window) | derby_war (city spotlight timed war)';
COMMENT ON COLUMN team_boost_windows.spotlight_plate IS
  'Derby/timed-war city plate for map spotlight (NULL = team boost only)';
COMMENT ON COLUMN team_boost_windows.label IS
  'Ops/fixture label (e.g. Aslan home, İstanbul derby)';
COMMENT ON COLUMN team_boost_windows.notes IS
  'Ops notes / fixture archive label';
COMMENT ON COLUMN team_boost_windows.involved_aliases IS
  'Derby ops note: involved public aliases (e.g. Aslan, Kartal)';
COMMENT ON COLUMN team_boost_windows.canceled_at IS
  'Soft-cancel; excluded from active boost + chrome queries';
