-- CC-35: boost snapshot columns on support_ledger (personal × team at spend time).
-- Defaults 1.0 keep existing rows / slice math unchanged until shop + match-day land.

ALTER TABLE support_ledger
  ADD COLUMN IF NOT EXISTS personal_boost_pct DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS team_boost_pct DOUBLE PRECISION NOT NULL DEFAULT 1.0;

COMMENT ON COLUMN support_ledger.personal_boost_pct IS 'Personal boost multiplier snapshot at spend (1.0 = none)';
COMMENT ON COLUMN support_ledger.team_boost_pct IS 'Team/match-day boost multiplier snapshot at spend (1.0 = none)';
