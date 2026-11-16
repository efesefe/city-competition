-- CC-61: first-session tutorial flags (server account state).
-- Beats: claim daily energy → capture mid-seed city → join live fight.
-- Skip clears remaining coach without blocking play.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tutorial_claimed_energy BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tutorial_capture BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tutorial_live_fight BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tutorial_skipped BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tutorial_complete BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tutorial_capture_plate TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tutorial_fight_plate TEXT;
